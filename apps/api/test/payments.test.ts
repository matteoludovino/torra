import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderView, PaymentStart } from "@torra/shared";
import Stripe from "stripe";
import { Stock } from "../src/catalog/stock.service.ts";
import { AddressLookup } from "../src/checkout/address-lookup.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { FAKE_WEBHOOK_SECRET } from "../src/env.ts";
import { FakeGateway } from "../src/payments/fake.gateway.ts";
import { PaymentGateway } from "../src/payments/gateway.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, customer, emailsTo, resetDb, testApp } from "./support.ts";

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
const EBOOK = seedId("variant:EBOOK-GELADO"); // digital, R$ 29,00
const HOME = {
  recipient: "Ana Souza",
  cep: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  district: "Bela Vista",
  city: "São Paulo",
  uf: "SP",
};

const add = (who: Browser, variantId: string, quantity = 1) => {
  clock.advance(1000);
  return who.post("/api/cart/items", { variantId, quantity });
};
async function place(who: Browser, input: object = {}): Promise<OrderView> {
  const response = await who.post("/api/orders", input);
  if (response.statusCode !== 201) throw new Error(`placing failed: ${response.body}`);
  return response.json();
}
async function pay(who: Browser, orderId: string): Promise<PaymentStart> {
  const response = await who.post(`/api/orders/${orderId}/payment`);
  if (response.statusCode !== 200) throw new Error(`payment failed: ${response.body}`);
  return response.json();
}
const view = async (who: Browser, id: string) => (await who.get(`/api/orders/${id}`)).json() as OrderView;
const stored = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const left = async (variantId: string, sandboxId: string) =>
  (await app.get(Stock).available(db, [variantId], sandboxId)).get(variantId);
/** A coffee and an e-book, ordered to São Paulo: R$ 78,00 + R$ 19,90. */
async function anOrder(email?: string) {
  const ana = await customer(app, "Ana Souza", email);
  await add(ana.browser, COFFEE);
  await add(ana.browser, EBOOK);
  return { ana, order: await place(ana.browser, { address: HOME }) };
}

/** Stripe's webhook, as Stripe would call it: a signed event about a PaymentIntent. */
function webhook(
  type: string,
  object: object,
  {
    id = `evt_${uuidv7()}`,
    secret = FAKE_WEBHOOK_SECRET,
    timestamp = Math.floor(Date.now() / 1000),
    livemode = false,
  } = {},
) {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    livemode,
    data: { object },
    api_version: "2026-10-28.endive",
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
  return app.inject({
    method: "POST",
    url: "/api/payments/webhook",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    payload,
  });
}

describe("paying", () => {
  it("by card: one PaymentIntent for the order, then paid, with the cart emptied and a receipt", async () => {
    const { ana, order } = await anOrder("ana@exemplo.com");
    const first = await pay(ana.browser, order.id);
    expect(first).toMatchObject({ kind: "fake", amountCents: 9790, publishableKey: null });
    // Again (a reload): the same PaymentIntent, made once.
    const again = await pay(ana.browser, order.id);
    expect(again).toEqual(first);
    expect(gateway.intents.size).toBe(1);
    const intent = [...gateway.intents.values()][0]!;
    expect(intent.metadata).toMatchObject({ orderId: order.id, orderNumber: "1001", env: "local" });
    expect((await stored(order.id)).paymentIntentId).toBe(intent.id);

    // Declined, then paid with another card: the same PaymentIntent.
    const declined = await ana.browser.post(`/api/orders/${order.id}/payment/simulate`, {
      outcome: "decline",
    });
    expect(declined.json()).toEqual({ error: "Seu cartão foi recusado." });
    await scheduler.runOnce();
    expect((await view(ana.browser, order.id)).status).toBe("pending_payment");
    await ana.browser.post(`/api/orders/${order.id}/payment/simulate`, { outcome: "succeed" });
    await scheduler.runOnce();

    const paid = await view(ana.browser, order.id);
    expect(paid).toMatchObject({ status: "paid", paidAt: clock.now().toISOString(), expiresAt: null });
    expect(paid.events.map((e) => [e.type, e.data])).toEqual([
      ["placed", {}],
      ["paid", { method: "card" }],
    ]);
    expect(await stored(order.id)).toMatchObject({
      amountPaidCents: 9790,
      latestChargeId: expect.stringMatching(/^ch_fake_/),
    });
    // The coffee is sold (its reservation stays), the cart is empty, a receipt went out.
    expect(await left(COFFEE, ana.sandboxId)).toBe(19);
    expect((await ana.browser.get("/api/cart")).json().lines).toEqual([]);
    const subjects = (await emailsTo(app, "ana@exemplo.com")).map((email) => email.subject);
    expect(subjects).toContain("Pagamento confirmado: pedido #1001");
    // Nothing more to pay.
    expect((await ana.browser.post(`/api/orders/${order.id}/payment`)).json().error.code).toBe("not_pending");
  });

  it("settles a free order at once, with no PaymentIntent", async () => {
    const ana = await customer(app);
    await db.coupon.create({
      data: { id: uuidv7(), sandboxId: ana.sandboxId, code: "PRESENTE", kind: "percent", value: 100 },
    });
    await add(ana.browser, EBOOK);
    const order = await place(ana.browser, { couponCode: "PRESENTE" });
    expect(order.totalCents).toBe(0);
    expect(await pay(ana.browser, order.id)).toEqual({ kind: "free" });
    expect(await view(ana.browser, order.id)).toMatchObject({ status: "paid" });
    expect((await stored(order.id)).paymentIntentId).toBeNull();
    expect(gateway.calls.create).toBe(0);
  });

  it("is for the order's customer, while it waits", async () => {
    const { order } = await anOrder();
    const bia = await customer(app);
    expect((await bia.browser.post(`/api/orders/${order.id}/payment`)).statusCode).toBe(404);
    expect((await bia.browser.post(`/api/orders/${order.id}/payment/sync`)).statusCode).toBe(404);
    expect((await new Browser(app).post(`/api/orders/${order.id}/payment`)).statusCode).toBe(401);
  });

  it("makes one PaymentIntent when two pages start paying at once", async () => {
    const { ana, order } = await anOrder();
    const answers = await Promise.all(
      Array.from({ length: 4 }, () => ana.browser.post(`/api/orders/${order.id}/payment`)),
    );
    expect(answers.map((a) => a.statusCode)).toEqual([200, 200, 200, 200]);
    expect(new Set(answers.map((a) => a.json().clientSecret)).size).toBe(1);
    expect(gateway.intents.size).toBe(1);
  });
});

describe("the webhook", () => {
  async function started() {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    return { ana, order, intentId: (await stored(order.id)).paymentIntentId! };
  }

  it("is checked, kept once, and only makes the order ask Stripe", async () => {
    const { order, intentId } = await started();
    // An event that says "succeeded" about a PaymentIntent that hasn't: nothing changes.
    const lying = await webhook("payment_intent.succeeded", { id: intentId, status: "succeeded" });
    expect(lying.statusCode).toBe(200);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("pending_payment");

    gateway.settle(intentId, "succeed");
    const event = { id: "evt_repeated" };
    expect((await webhook("payment_intent.succeeded", { id: intentId }, event)).statusCode).toBe(200);
    expect((await webhook("payment_intent.succeeded", { id: intentId }, event)).statusCode).toBe(200);
    expect(await db.paymentEvent.count()).toBe(2);
    expect(await db.outboxEvent.count({ where: { type: "payment.event" } })).toBe(2);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("paid");
  });

  it("refuses bad signatures, old ones, and live mode; ignores what it doesn't know", async () => {
    const { intentId } = await started();
    expect(
      (await webhook("payment_intent.succeeded", { id: intentId }, { secret: "whsec_other" })).statusCode,
    ).toBe(400);
    const old = Math.floor(Date.now() / 1000) - 10 * 60;
    expect((await webhook("payment_intent.succeeded", { id: intentId }, { timestamp: old })).statusCode).toBe(
      400,
    );
    expect((await webhook("payment_intent.succeeded", { id: intentId }, { livemode: true })).statusCode).toBe(
      400,
    );
    const unsigned = await app.inject({
      method: "POST",
      url: "/api/payments/webhook",
      payload: { id: "evt_x" },
    });
    expect(unsigned.statusCode).toBe(400);
    expect(await db.paymentEvent.count()).toBe(0);

    // Another deployment's payment, and an event this stage doesn't handle: accepted, nothing done.
    expect((await webhook("payment_intent.succeeded", { id: "pi_someone_else" })).statusCode).toBe(200);
    expect((await webhook("charge.refunded", { id: "ch_x" })).statusCode).toBe(200);
    await scheduler.runOnce();
    expect(await db.outboxEvent.count({ where: { failedAt: { not: null } } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { lastError: { not: null } } })).toBe(0);
  });

  it("isn't needed: a lost event is caught by the page, or by a sweep a little later", async () => {
    const { ana, order, intentId } = await started();
    gateway.settle(intentId, "succeed");
    clock.advance(60_000);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("pending_payment"); // not due yet
    clock.advance(61_000);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("paid");

    const other = await anOrder();
    await pay(other.ana.browser, other.order.id);
    gateway.settle((await stored(other.order.id)).paymentIntentId!, "succeed");
    const synced = (await other.ana.browser.post(`/api/orders/${other.order.id}/payment/sync`)).json();
    expect(synced.status).toBe("paid");
    void ana;
  });
});

describe("closing an order with a PaymentIntent", () => {
  it("cancels the PaymentIntent before expiring the order", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    const intentId = (await stored(order.id)).paymentIntentId!;
    gateway.settle(intentId, "require_action"); // 3-D Secure, never finished
    clock.advance(30 * 60_000);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("expired");
    expect(gateway.intents.get(intentId)!.status).toBe("canceled");
    expect(await left(COFFEE, ana.sandboxId)).toBe(20);
  });

  it("marks it paid instead, if it was paid just before", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    gateway.settle((await stored(order.id)).paymentIntentId!, "succeed");
    clock.advance(30 * 60_000);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("paid");
    expect(await left(COFFEE, ana.sandboxId)).toBe(19);
  });

  it("waits while the payment is processing, without asking Stripe every second", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    const intentId = (await stored(order.id)).paymentIntentId!;
    gateway.settle(intentId, "process");
    clock.advance(30 * 60_000);
    await scheduler.runOnce();
    const asked = gateway.calls.retrieve;
    await scheduler.runOnce();
    expect(gateway.calls.retrieve).toBe(asked);
    expect((await view(ana.browser, order.id)).events.map((e) => e.type)).toContain("payment_processing");
    expect((await stored(order.id)).status).toBe("pending_payment");
    gateway.settle(intentId, "succeed");
    clock.advance(2 * 60_000);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("paid");
  });

  it("cancels it when the customer gives up, or replaces the order", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    const first = (await stored(order.id)).paymentIntentId!;
    clock.advance(1000);
    const replacing = await place(ana.browser, { address: HOME, shippingService: "expresso" });
    expect(gateway.intents.get(first)!.status).toBe("canceled");
    expect((await stored(order.id)).status).toBe("canceled");

    await pay(ana.browser, replacing.id);
    const second = (await stored(replacing.id)).paymentIntentId!;
    expect((await ana.browser.post(`/api/orders/${replacing.id}/cancel`)).json().status).toBe("canceled");
    expect(gateway.intents.get(second)!.status).toBe("canceled");
  });

  it("refuses to replace an order paid a moment ago", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    gateway.settle((await stored(order.id)).paymentIntentId!, "succeed");
    await add(ana.browser, COFFEE); // the cart changes, so placing again would replace it
    const answer = await ana.browser.post("/api/orders", { address: HOME });
    expect(answer.statusCode).toBe(409);
    expect(answer.json().error).toMatchObject({
      code: "already_paid",
      message: expect.stringContaining("#1001"),
    });
    expect((await stored(order.id)).status).toBe("paid");
  });

  it("refunds a payment that arrives for an order already closed, once", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    const intentId = (await stored(order.id)).paymentIntentId!;
    // A closed order whose PaymentIntent got paid anyway (what the rules above prevent; the backstop).
    await db.order.update({ where: { id: order.id }, data: { status: "canceled", closedAt: clock.now() } });
    gateway.settle(intentId, "succeed");
    await webhook("payment_intent.succeeded", { id: intentId });
    await scheduler.runOnce();
    await ana.browser.post(`/api/orders/${order.id}/payment/sync`);
    expect(gateway.refunds.map((r) => [r.paymentIntentId, r.amountCents])).toEqual([[intentId, 9790]]);
    const events = (await view(ana.browser, order.id)).events.map((e) => e.type);
    expect(events.filter((type) => type === "late_payment_refunded")).toHaveLength(1);
  });

  it("never marks paid a PaymentIntent that doesn't match the order", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    const intentId = (await stored(order.id)).paymentIntentId!;
    gateway.intents.get(intentId)!.amountCents = 100;
    gateway.settle(intentId, "succeed");
    const synced = (await ana.browser.post(`/api/orders/${order.id}/payment/sync`)).json() as OrderView;
    expect(synced).toMatchObject({ status: "pending_payment", paymentReview: true });
    expect((await stored(order.id)).paymentProblem).toBe("valor 100 ≠ 9790");

    // A PaymentIntent of another deployment sharing the Stripe sandbox.
    const other = await anOrder();
    await pay(other.ana.browser, other.order.id);
    const theirs = (await stored(other.order.id)).paymentIntentId!;
    gateway.intents.get(theirs)!.metadata["env"] = "ci";
    gateway.settle(theirs, "succeed");
    await other.ana.browser.post(`/api/orders/${other.order.id}/payment/sync`);
    expect(await stored(other.order.id)).toMatchObject({
      status: "pending_payment",
      paymentProblem: "o pagamento é de outro ambiente",
    });
  });
});

describe("when the gateway fails", () => {
  it("treats a PaymentIntent it lost as unpayable: the order expires, and paying again starts a new one", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    const first = (await stored(order.id)).paymentIntentId!;
    gateway.reset(); // the fake gateway restarted, or the keys moved to another Stripe account
    expect((await ana.browser.post(`/api/orders/${order.id}/payment/sync`)).statusCode).toBe(200);
    const again = await pay(ana.browser, order.id);
    expect(again).toMatchObject({ kind: "fake" });
    expect(await stored(order.id)).toMatchObject({ paymentAttempt: 1 });
    expect((await stored(order.id)).paymentIntentId).not.toBe(first);

    gateway.reset();
    clock.advance(30 * 60_000);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("expired");
  });

  it("doesn't keep asking every second while Stripe is down", async () => {
    const { ana, order } = await anOrder();
    await pay(ana.browser, order.id);
    const down = () => Promise.reject(new Error("connect ETIMEDOUT"));
    const realRetrieve = gateway.retrieveIntent.bind(gateway);
    const realCancel = gateway.cancelIntent.bind(gateway);
    let asked = 0;
    gateway.retrieveIntent = () => (asked++, down());
    gateway.cancelIntent = () => (asked++, down());
    try {
      // The payment check: one try, then the interval.
      clock.advance(2 * 60_000);
      await scheduler.runOnce();
      await scheduler.runOnce();
      expect(asked).toBe(1);
      // The expiry: one try, then the interval.
      clock.advance(30 * 60_000);
      await scheduler.runOnce();
      await scheduler.runOnce();
      expect(asked).toBe(2);
      clock.advance(2 * 60_000);
      await scheduler.runOnce();
      expect(asked).toBe(3);
    } finally {
      gateway.retrieveIntent = realRetrieve;
      gateway.cancelIntent = realCancel;
    }
    clock.advance(2 * 60_000);
    await scheduler.runOnce();
    expect((await stored(order.id)).status).toBe("expired");
  });
});

describe("downloads", () => {
  it("are a paid order's digital items, by short-lived signed links, counted", async () => {
    const { ana, order } = await anOrder();
    expect((await view(ana.browser, order.id)).downloads).toEqual([]);
    await pay(ana.browser, order.id);
    await ana.browser.post(`/api/orders/${order.id}/payment/simulate`, { outcome: "succeed" });
    await scheduler.runOnce();
    const [download] = (await view(ana.browser, order.id)).downloads;
    expect(download).toMatchObject({ variantId: EBOOK, title: "E-book 30 receitas de café gelado" });

    // A plain link: no session needed.
    const file = await app.inject({ method: "GET", url: download!.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["content-disposition"]).toMatch(/^attachment; filename=".+\.pdf"$/);
    expect(file.rawPayload.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(file.rawPayload.toString("latin1")).toContain("Licenciado para Ana Souza");
    expect(await db.download.count()).toBe(1);

    const tampered = download!.url.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await app.inject({ method: "GET", url: tampered })).statusCode).toBe(404);
    clock.advance(61 * 60_000);
    expect((await app.inject({ method: "GET", url: download!.url })).statusCode).toBe(410);
  });
});

describe("the database", () => {
  it("keeps a paid order's money tied to its PaymentIntent", async () => {
    const { ana, order } = await anOrder();
    await expect(
      db.order.update({
        where: { id: order.id },
        data: { status: "paid", paidAt: new Date(), amountPaidCents: order.totalCents },
      }),
    ).rejects.toThrow(/orders_paid_through_stripe/);
    await pay(ana.browser, order.id);
    await ana.browser.post(`/api/orders/${order.id}/payment/simulate`, { outcome: "succeed" });
    await scheduler.runOnce();
    await expect(
      db.order.update({ where: { id: order.id }, data: { paymentIntentId: "pi_other" } }),
    ).rejects.toThrow(/its PaymentIntent stays/);
    const coffee = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, kind: "physical" } });
    await expect(
      db.download.create({ data: { id: uuidv7(), orderItemId: coffee.id, createdAt: new Date() } }),
    ).rejects.toThrow(/digital items/);
  });
});
