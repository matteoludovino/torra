import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AdminCoupon,
  AdminDashboard,
  AdminOrderPage,
  AdminOrderView,
  AdminProduct,
  AuditEntryView,
  OrderView,
  ProductDetail,
} from "@torra/shared";
import { Stock } from "../src/catalog/stock.service.ts";
import { AddressLookup } from "../src/checkout/address-lookup.ts";
import { FakeGateway } from "../src/payments/fake.gateway.ts";
import { PaymentGateway } from "../src/payments/gateway.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { DEMO_LIFETIME_MS, Sandboxes } from "../src/sandbox/sandboxes.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, admin, bareOrder, customer, directUser, emailsTo, resetDb, testApp } from "./support.ts";

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
const DRIPPER = seedId("variant:COAD-02-PT"); // 2 in stock
const EBOOK = seedId("variant:EBOOK-GELADO");
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
/** A customer's order, placed and (unless told otherwise) paid through the fake gateway. */
async function order(who: Browser, variants: string[] = [COFFEE], { pay = true } = {}): Promise<OrderView> {
  for (const variantId of variants) {
    clock.advance(1000);
    await who.post("/api/cart/items", { variantId, quantity: 1 });
  }
  const placed = await ok<OrderView>(await who.post("/api/orders", { address: HOME }), 201);
  if (!pay) return placed;
  await ok(await who.post(`/api/orders/${placed.id}/payment`));
  await ok(await who.post(`/api/orders/${placed.id}/payment/simulate`, { outcome: "succeed" }));
  await scheduler.runOnce();
  return placed;
}
const demoSandbox = () => db.$transaction((tx) => app.get(Sandboxes).create(tx, DEMO_LIFETIME_MS));

describe("the admin panel", () => {
  it("is for admins only", async () => {
    const ana = await customer(app);
    expect((await ana.browser.get("/api/admin/dashboard")).statusCode).toBe(403);
    expect((await ana.browser.get("/api/admin/orders")).json().error.code).toBe("admins_only");
    expect((await new Browser(app).get("/api/admin/dashboard")).statusCode).toBe(401);
  });

  it("shows the store's admins every order, and a demo's admin only the demo's", async () => {
    const store = await admin(app);
    const ana = await customer(app, "Ana Souza", "ana@exemplo.com");
    const mine = await order(ana.browser);
    const demo = await demoSandbox();
    const visitor = await directUser(app, { sandboxId: demo, name: "Visitante da demo" });
    const theirs = await order(visitor.browser, [EBOOK]);
    const demoAdmin = await admin(app, demo);

    const all = await ok<AdminOrderPage>(await store.browser.get("/api/admin/orders"));
    expect(all.orders.map((o) => [o.number, o.origin, o.customer.name, o.status, o.ships])).toEqual([
      [theirs.number, "demo", "Visitante da demo", "paid", false],
      [mine.number, "account", "Ana Souza", "paid", true],
    ]);
    const own = await ok<AdminOrderPage>(await demoAdmin.browser.get("/api/admin/orders"));
    expect(own.orders.map((o) => o.id)).toEqual([theirs.id]);
    expect((await demoAdmin.browser.get(`/api/admin/orders/${mine.id}`)).statusCode).toBe(404);
    expect((await demoAdmin.browser.post(`/api/admin/orders/${mine.id}/prepare`)).statusCode).toBe(404);

    // Search by number, by email or name; filter by status.
    const find = async (query: string) =>
      (await ok<AdminOrderPage>(await store.browser.get(`/api/admin/orders?${query}`))).orders.map(
        (o) => o.id,
      );
    expect(await find(`q=%23${mine.number}`)).toEqual([mine.id]);
    expect(await find("q=ANA@exemplo")).toEqual([mine.id]);
    expect(await find("q=visitante")).toEqual([theirs.id]);
    expect(await find("status=expired")).toEqual([]);
  });

  it("pages through orders, newest first", async () => {
    const store = await admin(app);
    const ana = await customer(app);
    for (let n = 0; n < 31; n++) await bareOrder(app, ana.sandboxId, ana.me.id);
    const first = await ok<AdminOrderPage>(await store.browser.get("/api/admin/orders"));
    expect(first.orders).toHaveLength(30);
    expect(first.next).toBe(first.orders.at(-1)!.id);
    const second = await ok<AdminOrderPage>(
      await store.browser.get(`/api/admin/orders?before=${first.next}`),
    );
    expect(second).toMatchObject({ next: null });
    expect(second.orders).toHaveLength(1);
    expect(second.orders[0]!.number).toBeLessThan(first.orders.at(-1)!.number);
  });
});

describe("fulfillment", () => {
  it("moves a paid order through preparing, shipped (with tracking) and delivered, telling the customer", async () => {
    const store = await admin(app);
    const ana = await customer(app, "Ana Souza", "ana@exemplo.com");
    const placed = await order(ana.browser);
    const step = (path: string, body?: object) =>
      store.browser.post(`/api/admin/orders/${placed.id}/${path}`, body);

    // Steps only in their order.
    expect((await step("ship", { trackingCode: "BR123" })).json().error.code).toBe("wrong_status");
    expect((await ok<AdminOrderView>(await step("prepare"))).status).toBe("preparing");
    expect((await step("prepare")).statusCode).toBe(409);
    expect((await step("ship", { trackingCode: "x" })).statusCode).toBe(400);
    const shipped = await ok<AdminOrderView>(await step("ship", { trackingCode: " qb 123 456 789 br " }));
    expect(shipped).toMatchObject({
      status: "shipped",
      trackingCode: "QB123456789BR",
      shippedAt: clock.now().toISOString(),
    });
    const delivered = await ok<AdminOrderView>(await step("deliver"));
    expect(delivered).toMatchObject({ status: "delivered", deliveredAt: clock.now().toISOString() });

    // The customer sees it, and was told.
    const view = (await ana.browser.get(`/api/orders/${placed.id}`)).json() as OrderView;
    expect(view).toMatchObject({ status: "delivered", trackingCode: "QB123456789BR" });
    expect(view.events.map((e) => e.type)).toEqual(["placed", "paid", "preparing", "shipped", "delivered"]);
    const subjects = (await emailsTo(app, "ana@exemplo.com")).map((e) => e.subject);
    expect(subjects).toEqual(
      expect.arrayContaining([
        `Seu pedido #${placed.number} foi enviado`,
        `Pedido #${placed.number} entregue`,
      ]),
    );
    // And the audit log has it, newest first.
    const audit = await ok<AuditEntryView[]>(await store.browser.get("/api/admin/audit"));
    expect(audit.map((entry) => [entry.action, entry.details])).toEqual([
      ["order.deliver", { number: placed.number }],
      ["order.ship", { number: placed.number, trackingCode: "QB123456789BR" }],
      ["order.prepare", { number: placed.number }],
    ]);
  });

  it("has nothing to ship for digital-only orders; cancels only orders waiting for payment", async () => {
    const store = await admin(app);
    const ana = await customer(app);
    const digital = await order(ana.browser, [EBOOK]);
    expect((await store.browser.post(`/api/admin/orders/${digital.id}/prepare`)).json().error.code).toBe(
      "nothing_to_ship",
    );
    expect((await store.browser.post(`/api/admin/orders/${digital.id}/cancel`)).json().error.code).toBe(
      "not_pending",
    );

    const waiting = await order(ana.browser, [DRIPPER], { pay: false });
    await ok(await ana.browser.post(`/api/orders/${waiting.id}/payment`));
    const canceled = await ok<AdminOrderView>(
      await store.browser.post(`/api/admin/orders/${waiting.id}/cancel`),
    );
    expect(canceled.status).toBe("canceled");
    expect(canceled.events.at(-1)).toMatchObject({ type: "canceled", data: { reason: "admin" } });
    expect([...gateway.intents.values()].at(-1)!.status).toBe("canceled");
    expect((await app.get(Stock).available(db, [DRIPPER], ana.sandboxId)).get(DRIPPER)).toBe(2);
  });

  it("shows what Stripe has, and asks again on request", async () => {
    const store = await admin(app);
    const ana = await customer(app);
    const placed = await order(ana.browser, [COFFEE], { pay: false });
    await ok(await ana.browser.post(`/api/orders/${placed.id}/payment`));
    const intentId = (await db.order.findUniqueOrThrow({ where: { id: placed.id } })).paymentIntentId!;
    gateway.settle(intentId, "succeed"); // no event: only asking finds out
    const view = await ok<AdminOrderView>(
      await store.browser.post(`/api/admin/orders/${placed.id}/reconcile`),
    );
    expect(view).toMatchObject({
      status: "paid",
      payment: {
        paymentIntentId: intentId,
        attempt: 0,
        amountPaidCents: placed.totalCents,
        dashboardUrl: null,
      },
    });
  });
});

describe("the catalog", () => {
  const product = (overrides: object = {}) => ({
    kind: "physical",
    category: "utensilios",
    title: "Jarra de vidro térmica",
    subtitle: "Para servir o café coado.",
    description: "Uma jarra de vidro de parede dupla, que mantém o café quente por mais tempo.",
    art: "kettle",
    optionNames: ["Tamanho"],
    variants: [
      { sku: "jarra-600", optionValues: ["600 ml"], priceCents: 8900, weightGrams: 520, initialStock: 8 },
      { sku: "JARRA-1L", optionValues: ["1 litro"], priceCents: 11900, weightGrams: 780 },
    ],
    ...overrides,
  });

  it("gets new products from the store's admins, for everyone, with their starting stock", async () => {
    const store = await admin(app);
    const created = await ok<AdminProduct>(await store.browser.post("/api/admin/products", product()), 201);
    expect(created).toMatchObject({ slug: "jarra-de-vidro-termica", editable: true, own: false });
    expect(created.variants.map((v) => [v.sku, v.available])).toEqual([
      ["JARRA-600", 8],
      ["JARRA-1L", 0],
    ]);
    const shown = (await new Browser(app).get("/api/catalog/jarra-de-vidro-termica")).json() as ProductDetail;
    expect(shown.variants.map((v) => v.available)).toEqual([8, 0]);
    // Same title again: a slug of its own.
    const again = await ok<AdminProduct>(
      await store.browser.post(
        "/api/admin/products",
        product({ variants: [{ sku: "J2", priceCents: 100, weightGrams: 1, optionValues: ["2"] }] }),
      ),
      201,
    );
    expect(again.slug).toBe("jarra-de-vidro-termica-2");

    expect((await store.browser.post("/api/admin/products", product())).json().error.code).toBe("sku_taken");
    const wrongOptions = product({
      variants: [{ sku: "X1", optionValues: [], priceCents: 100, weightGrams: 10 }],
    });
    expect((await store.browser.post("/api/admin/products", wrongOptions)).json().error.code).toBe(
      "option_values",
    );
    const digitalWeight = product({
      kind: "digital",
      optionNames: [],
      variants: [{ sku: "D1", priceCents: 100, weightGrams: 10 }],
    });
    expect((await store.browser.post("/api/admin/products", digitalWeight)).json().error.code).toBe("weight");
  });

  it("lets a demo's admin add products seen only in the demo, and never change the shared ones", async () => {
    const demo = await demoSandbox();
    const demoAdmin = await admin(app, demo);
    const created = await ok<AdminProduct>(
      await demoAdmin.browser.post("/api/admin/products", product()),
      201,
    );
    expect(created).toMatchObject({ own: true, editable: true });
    const visitorInDemo = await directUser(app, { sandboxId: demo });
    expect((await visitorInDemo.browser.get("/api/catalog/jarra-de-vidro-termica")).statusCode).toBe(200);
    expect((await new Browser(app).get("/api/catalog/jarra-de-vidro-termica")).statusCode).toBe(404);

    const shared = seedId("product:mantiqueira-bourbon-amarelo");
    const list = await ok<AdminProduct[]>(await demoAdmin.browser.get("/api/admin/products"));
    expect(list.find((p) => p.id === shared)).toMatchObject({ editable: false, own: false });
    expect(
      (await demoAdmin.browser.patch(`/api/admin/products/${shared}`, { active: false })).statusCode,
    ).toBe(404);
    expect(
      (await demoAdmin.browser.patch(`/api/admin/variants/${COFFEE}`, { priceCents: 100 })).statusCode,
    ).toBe(404);
    expect((await db.variant.findUniqueOrThrow({ where: { id: COFFEE } })).priceCents).toBe(4900);
  });

  it("edits products and prices, and keeps the price “de” above the price", async () => {
    const store = await admin(app);
    const shared = seedId("product:mantiqueira-bourbon-amarelo");
    const updated = await ok<AdminProduct>(
      await store.browser.patch(`/api/admin/products/${shared}`, { subtitle: "Caramelo e laranja." }),
    );
    expect(updated.subtitle).toBe("Caramelo e laranja.");
    expect(
      (await store.browser.patch(`/api/admin/variants/${COFFEE}`, { compareAtCents: 4000 })).json().error
        .code,
    ).toBe("compare_at");
    const priced = await ok<AdminProduct>(
      await store.browser.patch(`/api/admin/variants/${COFFEE}`, { priceCents: 5200, compareAtCents: 5900 }),
    );
    expect(priced.variants.find((v) => v.id === COFFEE)).toMatchObject({
      priceCents: 5200,
      compareAtCents: 5900,
    });
    expect(
      (await store.browser.patch(`/api/admin/variants/${EBOOK}`, { weightGrams: 10 })).json().error.code,
    ).toBe("digital_weight");
  });

  it("corrects stock in the admin's own corner, with a reason, never below zero", async () => {
    const store = await admin(app);
    const adjust = (who: Browser, variantId: string, quantity: number, reason = "Contagem do estoque") =>
      who.post(`/api/admin/variants/${variantId}/stock`, { quantity, reason });
    const left = async (sandboxId: string | null) =>
      (await app.get(Stock).available(db, [DRIPPER], sandboxId)).get(DRIPPER);

    await ok(await adjust(store.browser, DRIPPER, 5, "Chegou um lote"));
    expect(await left(null)).toBe(7);
    expect((await adjust(store.browser, DRIPPER, -8)).json().error.code).toBe("below_zero");
    expect((await adjust(store.browser, DRIPPER, 1, "")).statusCode).toBe(400);
    expect((await adjust(store.browser, EBOOK, 1)).json().error.code).toBe("digital_stock");

    // A demo's admin corrects the demo's own copy; the shared stock doesn't move.
    const demo = await demoSandbox();
    const demoAdmin = await admin(app, demo);
    await ok(await adjust(demoAdmin.browser, DRIPPER, -3, "Quebraram na demo"));
    expect(await left(demo)).toBe(4);
    expect(await left(null)).toBe(7);

    const movement = await db.stockMovement.findFirstOrThrow({ where: { kind: "adjust", sandboxId: null } });
    expect(movement).toMatchObject({ quantity: 5, reason: "Chegou um lote", actorId: store.id });
    await expect(
      db.$transaction((tx) =>
        app.get(Stock).move(tx, { variantId: DRIPPER, sandboxId: null, kind: "adjust", quantity: 1 }),
      ),
    ).rejects.toThrow(/stock_movements_adjust_reason/);
  });
});

describe("coupons", () => {
  it("are created, switched off and counted in the admin's view", async () => {
    const store = await admin(app);
    const coupon = {
      code: "natal 15",
      kind: "percent",
      value: 15,
      minSubtotalCents: 10000,
      endsAt: "2027-01-01T03:00:00.000Z",
      oncePerCustomer: true,
    };
    const created = await ok<AdminCoupon>(await store.browser.post("/api/admin/coupons", coupon), 201);
    expect(created).toMatchObject({ code: "NATAL15", uses: 0, editable: true });
    // (Currency puts a non-breaking space after "R$".)
    expect(created.description.replace(/\s/g, " ")).toBe("15% de desconto em compras a partir de R$ 100,00");
    expect((await store.browser.post("/api/admin/coupons", coupon)).json().error.code).toBe("code_taken");
    expect(
      (await store.browser.post("/api/admin/coupons", { ...coupon, code: "X150", value: 150 })).statusCode,
    ).toBe(400);

    const ana = await customer(app);
    clock.advance(1000);
    await ana.browser.post("/api/cart/items", { variantId: COFFEE, quantity: 3 });
    await ok(await ana.browser.post("/api/orders", { address: HOME, couponCode: "NATAL15" }), 201);
    const listed = await ok<AdminCoupon[]>(await store.browser.get("/api/admin/coupons"));
    expect(listed.find((c) => c.code === "NATAL15")!.uses).toBe(1);

    await ok(await store.browser.patch(`/api/admin/coupons/${created.id}`, { active: false }));
    const quote = (await ana.browser.post("/api/checkout/quote", { couponCode: "NATAL15" })).json();
    expect(quote.couponProblem).toBe("Cupom não encontrado.");
  });

  it("of a demo can't take a shared coupon's code, nor change the shared ones", async () => {
    const demoAdmin = await admin(app, await demoSandbox());
    const mine = await ok<AdminCoupon>(
      await demoAdmin.browser.post("/api/admin/coupons", { code: "SODEMO", kind: "fixed", value: 500 }),
      201,
    );
    expect(mine.editable).toBe(true);
    expect(
      (
        await demoAdmin.browser.post("/api/admin/coupons", { code: "TORRA20", kind: "fixed", value: 500 })
      ).json().error.code,
    ).toBe("code_taken");
    const shared = seedId("coupon:TORRA20");
    expect(
      (await demoAdmin.browser.patch(`/api/admin/coupons/${shared}`, { active: false })).statusCode,
    ).toBe(404);

    // A use of a shared coupon by a customer of the store: the store's admins count it, the demo's don't.
    const ana = await customer(app);
    clock.advance(1000);
    await ana.browser.post("/api/cart/items", { variantId: COFFEE, quantity: 4 });
    await ok(await ana.browser.post("/api/orders", { address: HOME, couponCode: "TORRA20" }), 201);
    const uses = async (who: Browser) =>
      (await ok<AdminCoupon[]>(await who.get("/api/admin/coupons"))).find((c) => c.code === "TORRA20")!.uses;
    expect(await uses((await admin(app)).browser)).toBe(1);
    expect(await uses(demoAdmin.browser)).toBe(0);
  });
});

describe("the overview", () => {
  it("counts sales, orders by status, what's to ship, low stock, and stuck work", async () => {
    const store = await admin(app);
    const ana = await customer(app);
    const paid = await order(ana.browser);
    await order(ana.browser, [EBOOK]);
    clock.advance(1000);
    await ana.browser.post("/api/cart/items", { variantId: DRIPPER, quantity: 1 });
    await ana.browser.post("/api/orders", { address: HOME });

    // A webhook event that gave up.
    await db.outboxEvent.create({
      data: {
        type: "payment.event",
        payload: { type: "payment_intent.succeeded", objectId: "pi_x" },
        dueAt: clock.now(),
        failedAt: clock.now(),
        attempts: 8,
        lastError: "Stripe down",
      },
    });
    const dashboard = await ok<AdminDashboard>(await store.browser.get("/api/admin/dashboard"));
    expect(dashboard).toMatchObject({
      scope: "store",
      sales7: { orders: 2, totalCents: paid.totalCents + 2900 },
      toShip: 1,
      inReview: 0,
    });
    expect(dashboard.byStatus).toMatchObject({ paid: 2, pending_payment: 1, expired: 0 });
    // Low stock in the store's corner (the shared one): the scale is sold out, two drippers left.
    const low = dashboard.lowStock.map((line) => [line.sku, line.available]);
    expect(low).toEqual(
      expect.arrayContaining([
        ["BAL-2K", 0],
        ["COAD-02-PT", 2],
      ]),
    );
    expect(low.every(([, available]) => (available as number) <= 5)).toBe(true);
    expect(low.map(([, available]) => available)).toEqual(
      [...low.map(([, a]) => a)].sort((a, b) => (a as number) - (b as number)),
    );
    expect(dashboard.stuck).toEqual([
      expect.objectContaining({ type: "payment.event", lastError: "Stripe down" }),
    ]);

    await store.browser.post(`/api/admin/events/${dashboard.stuck[0]!.id}/retry`);
    await scheduler.runOnce();
    expect((await ok<AdminDashboard>(await store.browser.get("/api/admin/dashboard"))).stuck).toEqual([]);
    expect(
      await db.outboxEvent.count({ where: { processedAt: { not: null }, type: "payment.event" } }),
    ).toBeGreaterThan(0);
  });

  it("lists customers with their orders and spending", async () => {
    const store = await admin(app);
    const ana = await customer(app, "Ana Souza", "ana@exemplo.com");
    const paid = await order(ana.browser);
    await customer(app, "Bia Lima", "bia@exemplo.com");
    const demo = await demoSandbox();
    await directUser(app, { sandboxId: demo, name: "Visitante" });

    const all = (await store.browser.get("/api/admin/customers")).json() as {
      name: string;
      orders: number;
      spentCents: number;
      origin: string;
    }[];
    expect(all.map((c) => [c.name, c.origin, c.orders, c.spentCents])).toEqual([
      ["Visitante", "demo", 0, 0],
      ["Bia Lima", "account", 0, 0],
      ["Ana Souza", "account", 1, paid.totalCents],
    ]);
    const found = (await store.browser.get("/api/admin/customers?q=ANA@")).json() as { name: string }[];
    expect(found.map((c) => c.name)).toEqual(["Ana Souza"]);
    const demoAdmin = await admin(app, demo);
    const theirs = (await demoAdmin.browser.get("/api/admin/customers")).json() as { name: string }[];
    expect(theirs.map((c) => c.name)).toEqual(["Visitante"]);
  });
});
