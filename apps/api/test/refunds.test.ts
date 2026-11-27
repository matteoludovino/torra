import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminDashboard, AdminOrderView, OrderView } from "@torra/shared";
import Stripe from "stripe";
import { Stock } from "../src/catalog/stock.service.ts";
import { AddressLookup } from "../src/checkout/address-lookup.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { FAKE_WEBHOOK_SECRET } from "../src/env.ts";
import { FakeGateway } from "../src/payments/fake.gateway.ts";
import { PaymentGateway } from "../src/payments/gateway.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { DEMO_LIFETIME_MS, Sandboxes } from "../src/sandbox/sandboxes.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, admin, customer, emailsTo, resetDb, testApp } from "./support.ts";

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

const COFFEE = seedId("variant:MANT-250-G"); // R$ 49,00, 20 in stock
const EBOOK = seedId("variant:EBOOK-GELADO"); // R$ 29,00, digital
const HOME = {
  recipient: "Ana Souza",
  cep: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  district: "Bela Vista",
  city: "São Paulo",
  uf: "SP",
};

async function ok<T>(
  response: { statusCode: number; body: string; json: () => unknown },
  status = 200,
): Promise<T> {
  if (response.statusCode !== status) throw new Error(`${response.statusCode}: ${response.body}`);
  return response.json() as T;
}
/**
 * Three coffees and an e-book with TORRA20, paid: R$ 176,00 − R$ 20,00 + R$ 19,90 = R$ 175,90. The
 * discount's shares: R$ 16,70 on the coffees (net R$ 130,30), R$ 3,30 on the e-book (net R$ 25,70).
 */
async function paidOrder(email?: string) {
  const ana = await customer(app, "Ana Souza", email);
  clock.advance(1000);
  await ana.browser.post("/api/cart/items", { variantId: COFFEE, quantity: 3 });
  clock.advance(1000);
  await ana.browser.post("/api/cart/items", { variantId: EBOOK, quantity: 1 });
  const order = await ok<OrderView>(
    await ana.browser.post("/api/orders", { address: HOME, couponCode: "TORRA20" }),
    201,
  );
  await ok(await ana.browser.post(`/api/orders/${order.id}/payment`));
  await ok(await ana.browser.post(`/api/orders/${order.id}/payment/simulate`, { outcome: "succeed" }));
  await scheduler.runOnce();
  const lines = Object.fromEntries(order.lines.map((line) => [line.variantId, line.id])) as Record<
    string,
    string
  >;
  return { ana, order, coffee: lines[COFFEE]!, ebook: lines[EBOOK]! };
}
const stored = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const left = async (sandboxId: string) =>
  (await app.get(Stock).available(db, [COFFEE], sandboxId)).get(COFFEE);
const intentOf = async (orderId: string) => (await stored(orderId)).paymentIntentId!;

function webhook(type: string, object: object) {
  const payload = JSON.stringify({
    id: `evt_${uuidv7()}`,
    object: "event",
    type,
    livemode: false,
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: FAKE_WEBHOOK_SECRET });
  return app.inject({
    method: "POST",
    url: "/api/payments/webhook",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    payload,
  });
}

describe("refunding", () => {
  it("gives back units (exact shares of the discount, in any steps), shipping once, and goods to stock", async () => {
    const store = await admin(app);
    const { ana, order, coffee, ebook } = await paidOrder("ana@exemplo.com");
    expect(order.totalCents).toBe(17590);
    const refund = (body: object) => store.browser.post(`/api/admin/orders/${order.id}/refunds`, body);

    const first = await ok<AdminOrderView>(
      await refund({
        items: [{ orderItemId: coffee, quantity: 1, restock: true }],
        shipping: true,
        reason: "Chegou amassado",
      }),
    );
    expect(first).toMatchObject({ status: "paid", refundedCents: 4343 + 1990 });
    expect(first.refunds).toEqual([
      expect.objectContaining({
        amountCents: 6333,
        shippingCents: 1990,
        status: "succeeded",
        origin: "panel",
        items: [
          { orderItemId: coffee, title: expect.any(String), quantity: 1, amountCents: 4343, restock: 1 },
        ],
      }),
    ]);
    expect(first.lines.find((line) => line.id === coffee)!.refundedQuantity).toBe(1);
    expect(await left(ana.sandboxId)).toBe(18); // 20 − 3 sold + 1 back
    expect(gateway.refunds.map((r) => [r.amountCents, r.metadata["refundId"]])).toEqual([
      [6333, first.refunds[0]!.id],
    ]);

    expect((await refund({ shipping: true, reason: "De novo" })).json().error.code).toBe("shipping_refunded");
    expect(
      (await refund({ items: [{ orderItemId: coffee, quantity: 3 }], reason: "Demais" })).json().error,
    ).toMatchObject({
      code: "over_refund",
      message: expect.stringContaining("Só 2 unidade(s)"),
    });
    // The other two coffees, without restocking, and the e-book: all of it back, to the cent.
    await ok(
      await refund({
        items: [
          { orderItemId: coffee, quantity: 2 },
          { orderItemId: ebook, quantity: 1 },
        ],
        reason: "Desistiu",
      }),
    );
    const all = (await ana.browser.get(`/api/orders/${order.id}`)).json() as OrderView;
    expect(all.refundedCents).toBe(17590);
    expect(await left(ana.sandboxId)).toBe(18);
    expect(all.downloads).toEqual([]);
    expect((await refund({ amountCents: 1, reason: "Mais um" })).json().error.message).toBe(
      "Só resta R$ 0,00 para reembolsar neste pedido.".replace(" 0", " 0"),
    );

    const subjects = (await emailsTo(app, "ana@exemplo.com")).map((e) => e.subject.replace(/\s/g, " "));
    expect(subjects).toEqual(
      expect.arrayContaining([
        "Reembolso de R$ 63,33 do pedido #1001",
        "Reembolso de R$ 112,57 do pedido #1001",
      ]),
    );
    expect(all.events.filter((e) => e.type === "refunded")).toHaveLength(2);
  });

  it("revokes a refunded e-book's download, even by a link already handed out", async () => {
    const store = await admin(app);
    const { ana, order, ebook } = await paidOrder();
    const [download] = ((await ana.browser.get(`/api/orders/${order.id}`)).json() as OrderView).downloads;
    expect((await app.inject({ method: "GET", url: download!.url })).statusCode).toBe(200);
    await ok(
      await store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
        items: [{ orderItemId: ebook, quantity: 1 }],
        reason: "Não abriu",
      }),
    );
    expect((await app.inject({ method: "GET", url: download!.url })).statusCode).toBe(410);
  });

  it("cancels a paid order not yet shipped: everything back, goods to stock, order closed", async () => {
    const store = await admin(app);
    const { ana, order } = await paidOrder();
    await ok(await store.browser.post(`/api/admin/orders/${order.id}/prepare`));
    const canceled = await ok<AdminOrderView>(
      await store.browser.post(`/api/admin/orders/${order.id}/cancel`),
    );
    expect(canceled).toMatchObject({ status: "canceled", refundedCents: 17590 });
    expect(canceled.refunds[0]).toMatchObject({ origin: "cancellation", shippingCents: 1990 });
    expect(canceled.events.at(-1)).toMatchObject({ type: "refunded" });
    expect(canceled.events.map((e) => e.type)).toContain("canceled");
    expect(await left(ana.sandboxId)).toBe(20);
    expect((await stored(order.id)).closedAt).not.toBeNull();

    const shipped = await paidOrder();
    for (const step of ["prepare", "ship"]) {
      await ok(
        await store.browser.post(
          `/api/admin/orders/${shipped.order.id}/${step}`,
          step === "ship" ? { trackingCode: "QB1234BR" } : undefined,
        ),
      );
    }
    expect((await store.browser.post(`/api/admin/orders/${shipped.order.id}/cancel`)).json().error.code).toBe(
      "not_cancelable",
    );
  });

  it("is for the admin's own corner, and paid orders", async () => {
    const { ana, order, coffee } = await paidOrder();
    const body = { items: [{ orderItemId: coffee, quantity: 1 }], reason: "Teste" };
    expect((await ana.browser.post(`/api/admin/orders/${order.id}/refunds`, body)).statusCode).toBe(403);
    const demo = await db.$transaction((tx) => app.get(Sandboxes).create(tx, DEMO_LIFETIME_MS));
    expect(
      (await (await admin(app, demo)).browser.post(`/api/admin/orders/${order.id}/refunds`, body)).statusCode,
    ).toBe(404);
    expect(
      (await (await admin(app)).browser.post(`/api/admin/orders/${order.id}/refunds`, { reason: "Nada" }))
        .statusCode,
    ).toBe(400);
  });

  it("decides one refund at a time: two at once can't give back more than was paid", async () => {
    const store = await admin(app);
    const { order } = await paidOrder();
    const answers = await Promise.all(
      Array.from({ length: 4 }, () =>
        store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
          amountCents: 10000,
          reason: "Ao mesmo tempo",
        }),
      ),
    );
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409, 409, 409]);
    expect((await stored(order.id)).amountRefundedCents).toBe(10000);
    expect(gateway.refunds).toHaveLength(1);
  });
});

describe("when Stripe doesn't answer as hoped", () => {
  it("finds a refund whose answer was lost, instead of making another (even after its key expired)", async () => {
    const store = await admin(app);
    const { order } = await paidOrder();
    gateway.loseNextRefundResponse = true;
    const view = await ok<AdminOrderView>(
      await store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
        amountCents: 5000,
        reason: "Perdido",
      }),
    );
    expect(view.refunds[0]).toMatchObject({ status: "pending" });
    expect(view.refundedCents).toBe(5000); // still held against the payment
    gateway.forgetKeys(); // a day later, Stripe no longer knows the key
    clock.advance(3 * 60_000);
    await scheduler.runOnce();
    expect(gateway.refunds).toHaveLength(1);
    const row = await db.refund.findFirstOrThrow();
    expect(row).toMatchObject({ status: "succeeded", stripeRefundId: gateway.refunds[0]!.id });
  });

  it("sends again later when the network failed, and fails for good when Stripe refuses", async () => {
    const store = await admin(app);
    const { ana, order, coffee } = await paidOrder();
    gateway.failNextRefund = "network";
    await ok(
      await store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
        amountCents: 1000,
        reason: "Rede",
      }),
    );
    expect(gateway.refunds).toHaveLength(0);
    clock.advance(60_000);
    await scheduler.runOnce();
    expect(gateway.refunds).toHaveLength(0); // waits its interval
    clock.advance(2 * 60_000);
    await scheduler.runOnce();
    expect(gateway.refunds).toHaveLength(1);

    gateway.failNextRefund = "This charge is disputed.";
    const refused = await ok<AdminOrderView>(
      await store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
        items: [{ orderItemId: coffee, quantity: 1, restock: true }],
        reason: "Recusado",
      }),
    );
    expect(refused.refunds.at(-1)).toMatchObject({
      status: "failed",
      failureReason: "This charge is disputed.",
    });
    expect(refused.refundedCents).toBe(1000);
    expect(refused.events.at(-1)).toMatchObject({ type: "refund_failed" });
    expect(await left(ana.sandboxId)).toBe(17); // nothing restocked
  });

  it("follows a refund that settles later, or fails later, by webhook or by sweep", async () => {
    const store = await admin(app);
    const { ana, order, coffee } = await paidOrder();
    gateway.refundsSettle = false;
    await ok(
      await store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
        items: [{ orderItemId: coffee, quantity: 1, restock: true }],
        reason: "Devolvido",
      }),
    );
    expect((await db.refund.findFirstOrThrow()).status).toBe("pending");
    expect(await left(ana.sandboxId)).toBe(18); // Stripe has it: the goods are back

    // It fails at the bank: the money stays with the store, and Stripe says so.
    const [stripeRefund] = gateway.refunds;
    gateway.settleRefund(stripeRefund!.id, "failed");
    await webhook("refund.failed", { id: stripeRefund!.id, payment_intent: await intentOf(order.id) });
    await scheduler.runOnce();
    expect(await db.refund.findFirstOrThrow()).toMatchObject({
      status: "failed",
      failureReason: "expired_or_canceled_card",
    });
    expect((await stored(order.id)).amountRefundedCents).toBe(0);

    // Another settles, and nobody tells us: the sweep finds out.
    await ok(
      await store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
        amountCents: 2000,
        reason: "Gentileza",
      }),
    );
    gateway.settleRefund(gateway.refunds[0]!.id, "succeeded");
    clock.advance(3 * 60_000);
    await scheduler.runOnce();
    expect((await db.refund.findMany({ orderBy: { createdAt: "asc" } })).map((r) => r.status)).toEqual([
      "failed",
      "succeeded",
    ]);
    expect((await stored(order.id)).amountRefundedCents).toBe(2000);
  });

  it("takes in refunds made in Stripe's Dashboard", async () => {
    const { ana, order } = await paidOrder("ana@exemplo.com");
    gateway.refundInDashboard(await intentOf(order.id), 1500);
    await webhook("charge.refunded", { id: "ch_x", payment_intent: await intentOf(order.id) });
    await scheduler.runOnce();
    const view = (await ana.browser.get(`/api/orders/${order.id}`)).json() as OrderView;
    expect(view).toMatchObject({ refundedCents: 1500 });
    expect(view.refunds).toEqual([
      expect.objectContaining({ origin: "stripe", amountCents: 1500, status: "succeeded" }),
    ]);
    expect((await emailsTo(app, "ana@exemplo.com")).map((e) => e.subject.replace(/\s/g, " "))).toContain(
      "Reembolso de R$ 15,00 do pedido #1001",
    );
    // Told twice, taken in once.
    await webhook("charge.refunded", { id: "ch_x", payment_intent: await intentOf(order.id) });
    await scheduler.runOnce();
    expect(await db.refund.count()).toBe(1);
  });

  it("marks disputes, refuses refunds while one is open, and shows them on the overview", async () => {
    const store = await admin(app);
    const { order } = await paidOrder();
    clock.advance(60_000);
    gateway.dispute(await intentOf(order.id), "needs_response");
    await webhook("charge.dispute.created", { id: "dp_x", payment_intent: await intentOf(order.id) });
    await scheduler.runOnce();
    const view = await ok<AdminOrderView>(await store.browser.get(`/api/admin/orders/${order.id}`));
    expect(view).toMatchObject({ disputeStatus: "needs_response" });
    expect(view.events.at(-1)).toMatchObject({
      type: "dispute_opened",
      data: { status: "needs_response", reason: "fraudulent" },
    });
    expect((await ok<AdminDashboard>(await store.browser.get("/api/admin/dashboard"))).disputesOpen).toBe(1);
    expect(
      (
        await store.browser.post(`/api/admin/orders/${order.id}/refunds`, {
          amountCents: 100,
          reason: "Teste",
        })
      ).json().error.code,
    ).toBe("disputed");

    clock.advance(60_000);
    gateway.dispute(await intentOf(order.id), "won");
    await webhook("charge.dispute.closed", { id: "dp_x", payment_intent: await intentOf(order.id) });
    await scheduler.runOnce();
    const closed = await ok<AdminOrderView>(await store.browser.get(`/api/admin/orders/${order.id}`));
    expect(closed).toMatchObject({ disputeStatus: "won" });
    expect(closed.events.at(-1)).toMatchObject({ type: "dispute_closed", data: { status: "won" } });
  });
});

describe("the database", () => {
  it("caps refunds at what was paid, and lines at what was bought", async () => {
    const { order, coffee } = await paidOrder();
    const now = new Date();
    const refund = (
      amountCents: number,
      items: { quantity: number; amountCents: number }[] = [],
      shippingCents = 0,
    ) =>
      db.refund.create({
        data: {
          id: uuidv7(),
          orderId: order.id,
          amountCents,
          shippingCents,
          status: "succeeded",
          origin: "panel",
          createdAt: now,
          items: { create: items.map((item) => ({ id: uuidv7(), orderItemId: coffee, ...item })) },
        },
      });
    await expect(refund(17591)).rejects.toThrow(/orders_refund_within_paid/);
    await expect(refund(1000, [{ quantity: 4, amountCents: 1000 }])).rejects.toThrow(
      /refund_items_quantity|more refunded/,
    );
    await expect(refund(13031, [{ quantity: 3, amountCents: 13031 }])).rejects.toThrow(
      /more refunded than bought/,
    );
    await expect(refund(5000, [{ quantity: 1, amountCents: 4000 }])).rejects.toThrow(/does not add up/);
    await expect(refund(4000, [], 3000)).rejects.toThrow(/more shipping refunded/);
    await expect(refund(4000, [], 1990)).resolves.toBeTruthy();
    await expect(refund(100, [], 100)).rejects.toThrow(/more shipping refunded/);

    const done = await db.refund.findFirstOrThrow();
    await expect(db.refund.update({ where: { id: done.id }, data: { amountCents: 1 } })).rejects.toThrow(
      /never changes/,
    );
    await expect(db.refund.update({ where: { id: done.id }, data: { status: "pending" } })).rejects.toThrow(
      /cannot go from succeeded/,
    );
    // A refund that fails stops counting.
    await db.refund.update({ where: { id: done.id }, data: { status: "failed" } });
    expect((await stored(order.id)).amountRefundedCents).toBe(0);
  });
});

void Browser;
