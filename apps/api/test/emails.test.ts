import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EmailPreferences } from "@torra/shared";
import { Mailer } from "../src/mail/mailer.service.ts";
import { update, verifyEmail } from "../src/mail/templates.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, ORIGIN, customer, emailsTo, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
afterAll(() => app.close());
beforeEach(() => resetDb(db));

type Someone = Awaited<ReturnType<typeof customer>>;

const kinds = async (who: Someone) => (await emailsTo(app, who.email)).map((email) => email.kind);
const preferences = async (who: Someone) =>
  (await who.browser.get("/api/me/email-preferences")).json() as EmailPreferences;

/** One optional email (an order's progress) and one account email (address confirmation). */
async function sendBoth(who: Someone) {
  const mailer = app.get(Mailer);
  // Kept as a real customer's would be without SMTP: no sandbox on the recipient, so it isn't a demo's.
  const to = { userId: who.me.id, email: who.email, sandboxId: null };
  await mailer.send(
    to,
    "order_progress_shipped",
    update("Ana", "Seu pedido foi enviado", ["Rastreio: AB1."]),
  );
  await mailer.send(to, "verify_email", verifyEmail("Ana", "http://x/v#t=abc"));
}

/** A customer whose sign-up confirmation is already out of the way, so only the test's emails count. */
async function quietCustomer() {
  const someone = await customer(app);
  await emailsTo(app, someone.email);
  await db.sentEmail.deleteMany();
  return someone;
}

function unsubscribeToken(text: string): string {
  const match = text.match(/\/descadastro#t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no unsubscribe link");
  return match[1]!;
}

describe("email preferences", () => {
  it("turn a category off; account email always goes", async () => {
    const someone = await quietCustomer();
    expect(await preferences(someone)).toEqual({ orders: true });
    const turned = await someone.browser.put("/api/me/email-preferences", { orders: false });
    expect(turned.json()).toEqual({ orders: false });
    await sendBoth(someone);
    expect(await kinds(someone)).toEqual(["verify_email"]);
    expect((await someone.browser.put("/api/me/email-preferences", {})).statusCode).toBe(400);
  });

  it("every optional email carries a signed link that unsubscribes without signing in", async () => {
    const someone = await quietCustomer();
    await sendBoth(someone);
    const [progress, account] = await emailsTo(app, someone.email);
    expect(account!.text).not.toContain("Descadastrar");
    expect(account!.html).not.toContain("<!--unsubscribe-->");
    expect(progress!.html).toContain("Preferências de e-mail");
    const token = unsubscribeToken(progress!.text);

    const anyone = new Browser(app);
    expect((await anyone.post("/api/email/unsubscribe", { token })).json()).toEqual({ category: "orders" });
    expect((await anyone.post("/api/email/unsubscribe", { token })).statusCode).toBe(200); // twice: same
    expect((await preferences(someone)).orders).toBe(false);
    expect((await anyone.post("/api/email/resubscribe", { token })).statusCode).toBe(200);
    expect((await preferences(someone)).orders).toBe(true);

    // A forged or altered link does nothing.
    const [body, mac] = token.split(".");
    const forged = Buffer.from(`${someone.me.id}:promotions`).toString("base64url");
    for (const bad of [`${forged}.${mac}`, `${body}.${"A".repeat(mac!.length)}`, `${body}`, `${token}.x`])
      expect((await anyone.post("/api/email/unsubscribe", { token: bad })).json().error.code).toBe(
        "invalid_link",
      );
    expect((await preferences(someone)).orders).toBe(true);
  });

  it("one-click unsubscribe works from an email client (no Origin), and only that endpoint does", async () => {
    const someone = await quietCustomer();
    await sendBoth(someone);
    const token = unsubscribeToken((await emailsTo(app, someone.email))[0]!.text);
    const post = (url: string, headers: Record<string, string> = {}) =>
      app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        payload: "List-Unsubscribe=One-Click",
      });

    expect((await post(`/api/email/unsubscribe/one-click?token=${token}`)).statusCode).toBe(200);
    expect((await preferences(someone)).orders).toBe(false);
    expect((await post("/api/email/unsubscribe/one-click?token=nope.nope")).statusCode).toBe(400);
    // Everything else still demands the web app's Origin.
    expect((await post("/api/email/resubscribe")).statusCode).toBe(403);
    expect((await post("/api/email/resubscribe", { origin: ORIGIN })).statusCode).toBe(400);
  });
});
