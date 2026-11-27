import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminDashboard, AdminOrderPage, DemoEmail, Me, OrderSummary, OrderView } from "@torra/shared";
import { Stock } from "../src/catalog/stock.service.ts";
import { AddressLookup } from "../src/checkout/address-lookup.ts";
import { FakeGateway } from "../src/payments/fake.gateway.ts";
import { PaymentGateway } from "../src/payments/gateway.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, customer, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
const gateway = app.get(PaymentGateway) as FakeGateway;
const scheduler = app.get(Scheduler);
afterAll(() => app.close());
app.get(AddressLookup).fetch = async () =>
  new Response(
    JSON.stringify({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    }),
  );
beforeEach(async () => {
  await resetDb(db);
  await seedCatalog(db);
  gateway.reset();
});

async function enter(who: Browser, persona: "customer" | "admin"): Promise<Me> {
  const response = await who.post("/api/demo", { persona });
  if (response.statusCode !== 201 && response.statusCode !== 200)
    throw new Error(`${response.statusCode}: ${response.body}`);
  return response.json();
}

describe("the one-click demo", () => {
  it("opens at once, then tells its story in the background: delivered, paid, waiting", async () => {
    const visitor = new Browser(app);
    const me = await enter(visitor, "customer");
    expect(me).toMatchObject({ name: "Marina Costa", role: "customer", demo: true });
    expect((await visitor.get("/api/demo/status")).json()).toEqual({ ready: false });

    await scheduler.runOnce();
    expect((await visitor.get("/api/demo/status")).json()).toEqual({ ready: true });
    const orders = (await visitor.get("/api/orders")).json() as OrderSummary[];
    expect(orders.map((o) => o.status)).toEqual(["pending_payment", "paid", "delivered"]);
    const delivered = (await visitor.get(`/api/orders/${orders[2]!.id}`)).json() as OrderView;
    expect(delivered).toMatchObject({ couponCode: "BEMVINDO10", trackingCode: "QB123456789BR" });
    expect(gateway.intents.size).toBe(2); // two real (test) payments

    // Its emails stay in the demo, for the visitor to read.
    const inbox = (await visitor.get("/api/demo/emails")).json() as DemoEmail[];
    expect(inbox.map((email) => email.subject)).toEqual(
      expect.arrayContaining([
        "Recebemos seu pedido #1001",
        "Pagamento confirmado: pedido #1001",
        "Seu pedido #1001 foi enviado",
      ]),
    );
    expect(inbox.every((email) => email.to === "Marina Costa")).toBe(true);

    // Told once, even if its event comes again.
    const { sandboxId } = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    await db.outboxEvent.create({
      data: { type: "demo.seed", payload: { sandboxId }, sandboxId, dueAt: clock.now() },
    });
    await scheduler.runOnce();
    expect(await db.order.count({ where: { sandboxId: sandboxId! } })).toBe(3);

    // The waiting order is the cart's: checking out again gives it back, to pay with a test card.
    const again = (await visitor.post("/api/orders", {})).json() as OrderView;
    expect(again.id).toBe(orders[0]!.id);
  });

  it("switches persona inside the same demo, the admin seeing only the demo's corner", async () => {
    const real = await customer(app);
    clock.advance(1000);
    await real.browser.post("/api/cart/items", { variantId: seedId("variant:EBOOK-GELADO"), quantity: 1 });
    await real.browser.post("/api/orders", {});

    const visitor = new Browser(app);
    await enter(visitor, "customer");
    await scheduler.runOnce();
    const cookie = visitor.cookie;
    const admin = await enter(visitor, "admin");
    expect(admin).toMatchObject({ role: "admin", demo: true, name: "Equipe da demo" });
    expect(visitor.cookie).not.toBe(cookie); // a new session; the customer's ended
    const page = (await visitor.get("/api/admin/orders")).json() as AdminOrderPage;
    expect(page.orders).toHaveLength(3);
    expect(page.orders.every((order) => order.origin === "demo")).toBe(true);
    expect(((await visitor.get("/api/admin/dashboard")).json() as AdminDashboard).scope).toBe("demo");
    // The demo's own coupon, editable; and back to the customer, same demo.
    const coupons = (await visitor.get("/api/admin/coupons")).json() as { code: string; editable: boolean }[];
    expect(coupons.find((c) => c.code === "DEMO15")).toMatchObject({ editable: true });
    await enter(visitor, "customer");
    expect(((await visitor.get("/api/orders")).json() as OrderSummary[]).length).toBe(3);
    expect(await db.sandbox.count({ where: { expiresAt: { not: null } } })).toBe(1);
  });

  it("isn't started on top of a real account", async () => {
    const real = await customer(app);
    const answer = await real.browser.post("/api/demo", { persona: "customer" });
    expect(answer.statusCode).toBe(409);
    expect(answer.json().error.code).toBe("signed_in");
  });

  it("has limits: per address, for everyone at once, and for its payments", async () => {
    const sameAddress = (): Browser => {
      const browser = new Browser(app);
      Object.defineProperty(browser, "ip", { value: "10.9.9.9" });
      return browser;
    };
    for (let n = 0; n < 5; n++) await enter(sameAddress(), "customer");
    expect((await sameAddress().post("/api/demo", { persona: "customer" })).statusCode).toBe(429);

    const small = await testApp({ DEMO_MAX_SANDBOXES: "5" }, { clock });
    try {
      const full = await new Browser(small).post("/api/demo", { persona: "customer" });
      expect(full.statusCode).toBe(503);
      expect(full.json().error.code).toBe("demo_full");
    } finally {
      await small.close();
    }

    // A demo makes at most 20 PaymentIntents a day.
    const visitor = new Browser(app);
    await enter(visitor, "customer");
    await scheduler.runOnce(); // its story used 2
    const waiting = ((await visitor.get("/api/orders")).json() as OrderSummary[])[0]!;
    let order = waiting.id;
    let answer = await visitor.post(`/api/orders/${order}/payment`);
    for (let n = 0; n < 17; n++) {
      clock.advance(1000);
      order = (
        (await visitor.post("/api/orders", { couponCode: n % 2 ? undefined : "DEMO15" })).json() as OrderView
      ).id;
      answer = await visitor.post(`/api/orders/${order}/payment`);
      expect(answer.statusCode, answer.body).toBe(200);
    }
    clock.advance(1000);
    order = ((await visitor.post("/api/orders", {})).json() as OrderView).id; // a change: a new order
    expect((await visitor.post(`/api/orders/${order}/payment`)).statusCode).toBe(429);
  });

  it("goes after a day, with everything in it, refunds and all; the shared store untouched", async () => {
    const visitor = new Browser(app);
    await enter(visitor, "admin");
    await scheduler.runOnce();
    const [, , delivered] = ((await visitor.get("/api/admin/orders")).json() as AdminOrderPage).orders;
    expect(
      (
        await visitor.post(`/api/admin/orders/${delivered!.id}/refunds`, {
          amountCents: 1000,
          reason: "Demo",
        })
      ).statusCode,
    ).toBe(200);
    const shared = await app.get(Stock).available(db, [seedId("variant:MANT-250-G")], null);

    clock.advance(24 * 60 * 60_000 + 1000);
    await scheduler.runOnce();
    expect(await db.sandbox.count()).toBe(0);
    expect(await db.order.count()).toBe(0);
    expect(await db.refund.count()).toBe(0);
    expect(await db.stockMovement.count({ where: { sandboxId: { not: null } } })).toBe(0);
    expect(await db.coupon.count({ where: { sandboxId: { not: null } } })).toBe(0);
    expect(await app.get(Stock).available(db, [seedId("variant:MANT-250-G")], null)).toEqual(shared);
    expect((await visitor.get("/api/me")).statusCode).toBe(401);
  });
});
