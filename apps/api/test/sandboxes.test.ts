import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/common/ids.ts";
import { Mailer } from "../src/mail/mailer.service.ts";
import { update } from "../src/mail/templates.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { DEMO_LIFETIME_MS, Sandboxes } from "../src/sandbox/sandboxes.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { FakeClock } from "../src/time/clock.ts";
import { admin, customer, directUser, emailsTo, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
// An SMTP server nobody listens on: a real send fails (the outbox would retry it); a kept one never tries.
const smtpApp = await testApp({ SMTP_URL: "smtp://127.0.0.1:9" }, { clock });
afterAll(async () => {
  await app.close();
  await smtpApp.close();
});
beforeEach(() => resetDb(db));

/** A demo's sandbox (one that expires) with one person in it. */
async function demoPerson() {
  const sandboxId = await db.$transaction((tx) => app.get(Sandboxes).create(tx, DEMO_LIFETIME_MS));
  return directUser(app, { sandboxId, name: "Renata Alves" });
}

describe("sandboxes", () => {
  it("a demo's goes after a day with everything in it; a customer's stays", async () => {
    const kept = await customer(app);
    const demo = await demoPerson();
    await db.auditEntry.create({
      data: { id: uuidv7(), actorId: demo.id, action: "test", targetType: "user", sandboxId: demo.sandboxId },
    });
    await emailsTo(app, kept.email); // the customer's confirmation email, sent (kept: no SMTP here)
    await app
      .get(Mailer)
      .send(
        { userId: demo.id, email: "renata@demo.torra.invalid", sandboxId: demo.sandboxId },
        "order_received",
        update("Renata", "Pedido recebido", ["Obrigado!"]),
      );

    clock.advance(DEMO_LIFETIME_MS - 1000);
    await app.get(Scheduler).runOnce();
    expect(await db.sandbox.count()).toBe(2);
    clock.advance(2000);
    await app.get(Scheduler).runOnce();

    expect(await db.sandbox.findMany({ select: { id: true } })).toEqual([{ id: kept.sandboxId }]);
    expect(await db.user.count({ where: { id: demo.id } })).toBe(0);
    expect(await db.auditEntry.count()).toBe(0);
    expect(await db.sentEmail.count({ where: { sandboxId: demo.sandboxId } })).toBe(0);
    expect((await kept.browser.get("/api/me")).statusCode).toBe(200);
    expect((await demo.browser.get("/api/me")).statusCode).toBe(401);
  });

  it("customers always live in one; the store's admins may not", async () => {
    await expect(
      db.user.create({
        data: { id: uuidv7(), email: "sem@sandbox.com", name: "Sem Sandbox", role: "customer" },
      }),
    ).rejects.toThrow(/users_customers_in_a_sandbox/);
    const storeAdmin = await admin(app);
    expect((await db.user.findUniqueOrThrow({ where: { id: storeAdmin.id } })).sandboxId).toBeNull();
  });

  it("each allow sixty writes a minute, however many people share one", async () => {
    const someone = await customer(app);
    for (let n = 0; n < 59; n++)
      expect((await someone.browser.patch("/api/me", { name: `Ana ${n}` })).statusCode).toBe(200);
    const sameSandbox = await directUser(app, { sandboxId: someone.sandboxId });
    expect((await sameSandbox.browser.patch("/api/me", { name: "Bia" })).statusCode).toBe(200);
    expect((await someone.browser.patch("/api/me", { name: "Ana" })).statusCode).toBe(429);
    expect((await someone.browser.get("/api/me")).statusCode).toBe(200); // reading is free
    const other = await customer(app);
    expect((await other.browser.patch("/api/me", { name: "Caio" })).statusCode).toBe(200);
    clock.advance(61_000);
    expect((await someone.browser.patch("/api/me", { name: "Ana" })).statusCode).toBe(200);
  });
});

describe("the audit log", () => {
  it("refuses changes", async () => {
    const storeAdmin = await admin(app);
    await db.auditEntry.create({
      data: { id: uuidv7(), actorId: storeAdmin.id, action: "test", targetType: "user" },
    });
    await expect(db.$executeRaw`UPDATE audit_entries SET action = 'nothing'`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM audit_entries`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`TRUNCATE audit_entries`).rejects.toThrow(/append-only/);
    expect(await db.auditEntry.count()).toBe(1);
  });
});

describe("email delivery", () => {
  it("sends a customer's email for real, and keeps a demo's for its inbox", async () => {
    const mailer = smtpApp.get(Mailer);
    const someone = await customer(app);
    const demo = await demoPerson();
    const email = update("Ana", "Pedido recebido", ["Obrigado!"]);
    await expect(
      mailer.send(
        { userId: someone.me.id, email: someone.email, sandboxId: someone.sandboxId },
        "order_received",
        email,
      ),
    ).rejects.toThrow();
    await mailer.send(
      { userId: demo.id, email: "renata@demo.torra.invalid", sandboxId: demo.sandboxId },
      "order_received",
      email,
    );
    expect(await db.sentEmail.count({ where: { sandboxId: demo.sandboxId } })).toBe(1);
    expect(await db.sentEmail.count({ where: { userId: someone.me.id, kind: "order_received" } })).toBe(0);
  });
});
