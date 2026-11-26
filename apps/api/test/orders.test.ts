import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderView } from "@torra/shared";
import { Stock } from "../src/catalog/stock.service.ts";
import { AddressLookup } from "../src/checkout/address-lookup.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, admin, customer, directUser, emailsTo, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
/** The postal directory, as these tests know it: São Paulo's Paulista, an unknown CEP, and one that fails. */
app.get(AddressLookup).fetch = async (input) => {
  const cep = String(input).match(/ws\/(\d{8})\//)![1]!;
  if (cep === "99999999") throw new Error("connect ETIMEDOUT");
  const known = { logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" };
  return new Response(JSON.stringify(cep === "01310100" ? known : { erro: "true" }), { status: 200 });
};
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(db);
  await seedCatalog(db);
});

const COFFEE = seedId("variant:MANT-250-G"); // R$ 49,00, 290 g, 20 in stock
const DRIPPER = seedId("variant:COAD-02-PT"); // R$ 129,00, 420 g, 2 in stock
const COURSE = seedId("variant:CURSO-COADO"); // digital, R$ 97,00
const EBOOK = seedId("variant:EBOOK-GELADO"); // digital, R$ 29,00

const HOME = {
  recipient: "Ana Souza",
  cep: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "Apto 42",
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
/** What a sandbox has left of a variant (its own copy, or the shared level if it never touched it). */
const left = async (variantId: string, sandboxId: string | null) =>
  (await app.get(Stock).available(db, [variantId], sandboxId)).get(variantId);

describe("placing an order", () => {
  it("freezes the cart at today's prices, holds the stock and the coupon for 30 minutes", async () => {
    const ana = await customer(app, "Ana Souza", "ana@exemplo.com");
    await add(ana.browser, COFFEE, 2);
    await add(ana.browser, COURSE);
    const order = await place(ana.browser, { address: HOME, couponCode: "torra20" });

    // R$ 195,00 in products, R$ 20,00 off (shared out by line), economy to SP for the first kilo.
    expect(order).toMatchObject({
      number: 1001,
      status: "pending_payment",
      subtotalCents: 19500,
      discountCents: 2000,
      shippingCents: 1990,
      totalCents: 19500 - 2000 + 1990,
      couponCode: "TORRA20",
      shipping: { service: "economico", daysMin: 4, daysMax: 6 },
      address: { ...HOME, cep: "01310-100" },
      expiresAt: new Date(clock.now().getTime() + 30 * 60_000).toISOString(),
      items: 2,
    });
    expect(
      order.lines.map((l) => [l.title, l.options, l.quantity, l.lineTotalCents, l.discountCents]),
    ).toEqual([
      ["Mantiqueira de Minas · Bourbon Amarelo", "250 g · Em grãos", 2, 9800, 1005],
      ["Curso Café Coado em Casa", "", 1, 9700, 995],
    ]);
    expect(order.events.map((e) => e.type)).toEqual(["placed"]);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).cep).toBe("01310100");

    // Held: two bags in Ana's corner, the coupon counted, nothing else touched.
    expect(await left(COFFEE, ana.sandboxId)).toBe(18);
    expect(await left(COFFEE, null)).toBe(20);
    expect(await db.couponRedemption.count({ where: { orderId: order.id, releasedAt: null } })).toBe(1);

    // The order doesn't change with the catalog; the cart still counts its own held units as hers.
    await db.variant.update({ where: { id: COFFEE }, data: { priceCents: 5900 } });
    expect((await ana.browser.get(`/api/orders/${order.id}`)).json().totalCents).toBe(order.totalCents);
    const cart = (await ana.browser.get("/api/cart")).json();
    expect(cart.lines[0]).toMatchObject({ available: 20, issue: "price_changed" });

    // A receipt, always sent.
    const [receipt] = await emailsTo(app, "ana@exemplo.com").then((all) =>
      all.filter((email) => email.kind === "order_placed"),
    );
    expect(receipt!.subject).toBe("Recebemos seu pedido #1001");
    expect(receipt!.text).toContain(`/pedidos/${order.id}`);
  });

  it("needs no address for digital products, and lists the customer's orders, newest first", async () => {
    const ana = await customer(app);
    await add(ana.browser, EBOOK);
    const first = await place(ana.browser, { address: HOME, shippingService: "expresso" });
    expect(first).toMatchObject({ shippingCents: 0, shipping: null, address: null, totalCents: 2900 });
    await ana.browser.post(`/api/orders/${first.id}/cancel`);
    clock.advance(1000);
    const second = await place(ana.browser);
    const list = (await ana.browser.get("/api/orders")).json();
    expect(list.map((o: { number: number; status: string }) => [o.number, o.status])).toEqual([
      [second.number, "pending_payment"],
      [first.number, "canceled"],
    ]);
  });

  it("is for signed-in customers, each seeing only their own", async () => {
    const visitor = new Browser(app);
    await add(visitor, EBOOK);
    expect((await visitor.post("/api/orders", {})).statusCode).toBe(401);

    const storeAdmin = await admin(app);
    const refused = await storeAdmin.browser.post("/api/orders", {});
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("admins_dont_shop");

    const ana = await customer(app);
    await add(ana.browser, EBOOK);
    const order = await place(ana.browser);
    const bia = await customer(app);
    expect((await bia.browser.get(`/api/orders/${order.id}`)).statusCode).toBe(404);
    expect((await bia.browser.post(`/api/orders/${order.id}/cancel`)).statusCode).toBe(404);
    expect((await bia.browser.get("/api/orders")).json()).toEqual([]);
    expect((await ana.browser.get("/api/orders/123")).statusCode).toBe(404);
  });

  it("refuses an empty cart, a cart that changed, a missing address, a bad coupon, a total too small", async () => {
    const ana = await customer(app);
    const code = async (input: object = {}) =>
      (await ana.browser.post("/api/orders", input)).json().error.code;
    expect(await code()).toBe("empty_cart");

    await add(ana.browser, COFFEE);
    expect(await code()).toBe("needs_address");
    expect((await ana.browser.post("/api/orders", { address: { ...HOME, cep: "123" } })).statusCode).toBe(
      400,
    );
    expect(await code({ address: HOME, couponCode: "NAOEXISTE" })).toBe("coupon_problem");
    // Shipping is priced by the CEP's state: a different one typed in is refused, an unknown CEP too.
    const elsewhere = await ana.browser.post("/api/orders", { address: { ...HOME, uf: "AM" } });
    expect(elsewhere.json().error).toMatchObject({
      code: "state_mismatch",
      message: "Este CEP é de SP: confira o estado.",
    });
    expect(await code({ address: { ...HOME, cep: "00000-000" } })).toBe("unknown_cep");
    // If the directory doesn't answer, the state typed in stands (as it does for the quote).
    const typed = await place(ana.browser, { address: { ...HOME, cep: "99999-999", uf: "RS" } });
    expect(typed).toMatchObject({ shippingCents: 2490, address: { uf: "RS" } });
    await ana.browser.post(`/api/orders/${typed.id}/cancel`);

    await db.variant.update({ where: { id: COFFEE }, data: { priceCents: 5400 } });
    expect(await code({ address: HOME })).toBe("cart_not_ready");
    await ana.browser.delete(`/api/cart/items/${COFFEE}`);

    await add(ana.browser, EBOOK);
    await db.coupon.create({
      data: { id: uuidv7(), sandboxId: ana.sandboxId, code: "QUASE", kind: "fixed", value: 2880 },
    });
    expect(await code({ couponCode: "QUASE" })).toBe("below_minimum");
    expect(await db.order.count({ where: { status: "pending_payment" } })).toBe(0);
  });
});

describe("placing again", () => {
  it("gives the same order for the same cart (a double click), however many at once", async () => {
    const ana = await customer(app);
    await add(ana.browser, DRIPPER, 2);
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => ana.browser.post("/api/orders", { address: HOME })),
    );
    expect(answers.map((a) => a.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(answers.map((a) => a.json().id)).size).toBe(1);
    expect(await db.order.count()).toBe(1);
    expect(await left(DRIPPER, ana.sandboxId)).toBe(0);
  });

  it("replaces the waiting order when anything changed, handing its stock and coupon to the new one", async () => {
    const ana = await customer(app);
    await add(ana.browser, DRIPPER, 2);
    const first = await place(ana.browser, { address: HOME, couponCode: "BEMVINDO10" });
    // Both drippers are held by her own order: the cart still says she can have them, and the quote
    // doesn't count her order's coupon use against her (placing again gives it back first).
    expect((await ana.browser.get("/api/cart")).json()).toMatchObject({ ready: true });
    const requote = (await ana.browser.post("/api/checkout/quote", { couponCode: "BEMVINDO10" })).json();
    expect(requote).toMatchObject({ couponProblem: null, discountCents: 2580 });

    clock.advance(60_000);
    const second = await place(ana.browser, {
      address: HOME,
      couponCode: "BEMVINDO10",
      shippingService: "expresso",
    });
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ shippingCents: 3490, discountCents: 2580 });
    const replaced = (await ana.browser.get(`/api/orders/${first.id}`)).json() as OrderView;
    expect(replaced.status).toBe("canceled");
    expect(replaced.events.map((e) => [e.type, e.data])).toEqual([
      ["placed", {}],
      ["canceled", { reason: "replaced" }],
    ]);
    // One order holds the stock, one holds the "once per customer" coupon (marked so for the index).
    expect(await left(DRIPPER, ana.sandboxId)).toBe(0);
    const live = await db.couponRedemption.findMany({ where: { releasedAt: null } });
    expect(live.map((r) => [r.orderId, r.exclusive])).toEqual([[second.id, true]]);

    // A new address alone is a change too.
    const moved = {
      address: { ...HOME, number: "1001" },
      couponCode: "BEMVINDO10",
      shippingService: "expresso",
    };
    clock.advance(1000);
    const third = await place(ana.browser, moved);
    expect(third.id).not.toBe(second.id);
    expect((await place(ana.browser, moved)).id).toBe(third.id);
    // So is a cart line.
    await ana.browser.put(`/api/cart/items/${DRIPPER}`, { quantity: 1 });
    clock.advance(1000);
    const fourth = await place(ana.browser, moved);
    expect(fourth).toMatchObject({ couponCode: "BEMVINDO10", discountCents: 1290 });
    expect(fourth.id).not.toBe(third.id);
    expect(await left(DRIPPER, ana.sandboxId)).toBe(1);
    // And a coupon taken away (or added).
    clock.advance(1000);
    const fifth = await place(ana.browser, { ...moved, couponCode: undefined });
    expect(fifth).toMatchObject({ couponCode: null, discountCents: 0 });
    expect(fifth.id).not.toBe(fourth.id);
    expect(await db.order.count({ where: { status: "pending_payment" } })).toBe(1);
    expect(await db.couponRedemption.count({ where: { releasedAt: null } })).toBe(0);
  });
});

describe("going back from a waiting order", () => {
  it("doesn't count its coupon against the customer: not its total limit, not once per customer", async () => {
    const ana = await customer(app);
    await db.coupon.create({
      data: {
        id: uuidv7(),
        sandboxId: ana.sandboxId,
        code: "SOUM",
        kind: "fixed",
        value: 500,
        maxRedemptions: 1,
      },
    });
    await add(ana.browser, EBOOK);
    for (const couponCode of ["SOUM", "BEMVINDO10"]) {
      clock.advance(1000);
      await place(ana.browser, { couponCode });
      const quote = (await ana.browser.post("/api/checkout/quote", { couponCode })).json();
      expect(quote.couponProblem, couponCode).toBeNull();
    }
    // Another customer of the same corner still finds SOUM's one place taken.
    const bia = await directUser(app, { sandboxId: ana.sandboxId });
    await add(bia.browser, EBOOK);
    clock.advance(1000);
    await place(ana.browser, { couponCode: "SOUM" });
    expect((await bia.browser.post("/api/checkout/quote", { couponCode: "SOUM" })).json().couponProblem).toBe(
      "Este cupom esgotou.",
    );
  });
});

describe("races", { timeout: 30_000 }, () => {
  it("sells the last units once, in a corner of the store with two buyers", async () => {
    for (let round = 0; round < 5; round++) {
      await resetDb(db);
      await seedCatalog(db);
      const one = await directUser(app);
      const two = await directUser(app, { sandboxId: one.sandboxId });
      for (const who of [one, two]) await add(who.browser, DRIPPER, 2);
      const answers = await Promise.all(
        [one, two].map((who) => who.browser.post("/api/orders", { address: HOME })),
      );
      const codes = answers.map((a) => a.statusCode).sort();
      expect(codes).toEqual([201, 409]);
      const refused = answers.find((a) => a.statusCode === 409)!.json().error;
      // Either the stock said no under its lock, or the cart already showed them gone.
      expect(["out_of_stock", "cart_not_ready"]).toContain(refused.code);
      if (refused.code === "out_of_stock") expect(refused.message).toContain("Coador");
      expect(await left(DRIPPER, one.sandboxId)).toBe(0);
      expect(await db.order.count()).toBe(1);
    }
    // Another customer's corner still has its two.
    const other = await customer(app);
    await add(other.browser, DRIPPER, 2);
    expect((await place(other.browser, { address: HOME })).status).toBe("pending_payment");
  });

  it("uses a coupon's last place once", async () => {
    for (let round = 0; round < 8; round++) {
      const buyers = [await directUser(app)];
      for (let n = 0; n < 3; n++) buyers.push(await directUser(app, { sandboxId: buyers[0]!.sandboxId }));
      const couponId = uuidv7();
      await db.coupon.create({
        data: {
          id: couponId,
          sandboxId: buyers[0]!.sandboxId,
          code: "ULTIMO",
          kind: "fixed",
          value: 500,
          maxRedemptions: 1,
        },
      });
      for (const who of buyers) await add(who.browser, EBOOK);
      const answers = await Promise.all(
        buyers.map((who) => who.browser.post("/api/orders", { couponCode: "ULTIMO" })),
      );
      expect(answers.map((a) => a.statusCode).sort()).toEqual([201, 409, 409, 409]);
      for (const refused of answers.filter((a) => a.statusCode === 409)) {
        expect(refused.json().error).toMatchObject({
          code: "coupon_problem",
          message: "Este cupom esgotou.",
        });
      }
      expect(await db.couponRedemption.count({ where: { couponId } })).toBe(1);
    }
  });
});

describe("an order not paid", () => {
  it("expires after 30 minutes: stock and coupon go back, once, and the customer hears of it", async () => {
    const ana = await customer(app, "Ana Souza", "ana@exemplo.com");
    await add(ana.browser, COFFEE, 3);
    const order = await place(ana.browser, { address: HOME, couponCode: "BEMVINDO10" });
    expect(await left(COFFEE, ana.sandboxId)).toBe(17);

    clock.advance(30 * 60_000);
    // Shown as expired at once; the sweep is what gives things back.
    const shown = (await ana.browser.get(`/api/orders/${order.id}`)).json() as OrderView;
    expect(shown).toMatchObject({ status: "expired", expiresAt: null });
    await app.get(Scheduler).runOnce();
    const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ status: "expired", closedAt: clock.now() });
    expect(await left(COFFEE, ana.sandboxId)).toBe(20);
    expect(await db.couponRedemption.count({ where: { releasedAt: null } })).toBe(0);
    const notices = (await emailsTo(app, "ana@exemplo.com")).filter(
      (e) => e.kind === "order_progress_expired",
    );
    expect(notices.map((e) => e.subject)).toEqual(["Seu pedido #1001 expirou"]);

    // Once only: another sweep and a late cancel change nothing.
    await app.get(Scheduler).runOnce();
    expect(await db.stockMovement.count({ where: { orderId: order.id } })).toBe(2);
    expect((await ana.browser.post(`/api/orders/${order.id}/cancel`)).json().error.code).toBe("not_pending");

    // The cart is as it was: placing again works, coupon included.
    expect((await place(ana.browser, { address: HOME, couponCode: "BEMVINDO10" })).number).toBe(1002);
  });

  it("can be cancelled by the customer, giving everything back", async () => {
    const ana = await customer(app);
    await add(ana.browser, DRIPPER);
    const order = await place(ana.browser, { address: HOME, couponCode: "BEMVINDO10" });
    const canceled = (await ana.browser.post(`/api/orders/${order.id}/cancel`)).json() as OrderView;
    expect(canceled).toMatchObject({ status: "canceled", expiresAt: null });
    expect(canceled.events.map((e) => [e.type, e.data])).toEqual([
      ["placed", {}],
      ["canceled", { reason: "customer" }],
    ]);
    expect(await left(DRIPPER, ana.sandboxId)).toBe(2);
    expect(await db.couponRedemption.count({ where: { releasedAt: null } })).toBe(0);
    expect((await ana.browser.post(`/api/orders/${order.id}/cancel`)).statusCode).toBe(409);
  });
});

describe("the database", () => {
  async function anOrder() {
    const ana = await customer(app);
    await add(ana.browser, COFFEE, 2);
    await add(ana.browser, EBOOK);
    return { ana, order: await place(ana.browser, { address: HOME }) };
  }

  it("never changes what was bought or for how much", async () => {
    const { order } = await anOrder();
    await expect(db.order.update({ where: { id: order.id }, data: { totalCents: 100 } })).rejects.toThrow(
      /is frozen/,
    );
    await expect(db.order.update({ where: { id: order.id }, data: { city: "Rio" } })).rejects.toThrow(
      /is frozen/,
    );
    await expect(
      db.orderItem.updateMany({ where: { orderId: order.id }, data: { quantity: 1 } }),
    ).rejects.toThrow(/never change/);
    await expect(db.orderEvent.deleteMany({ where: { orderId: order.id } })).rejects.toThrow(/append-only/);
  });

  it("allows only the order's own transitions", async () => {
    const { order } = await anOrder();
    await expect(
      db.order.update({ where: { id: order.id }, data: { status: "delivered", deliveredAt: new Date() } }),
    ).rejects.toThrow(/cannot go from pending_payment to delivered/);
    await expect(db.order.update({ where: { id: order.id }, data: { status: "paid" } })).rejects.toThrow(
      /orders_paid_states/,
    );
    await db.order.update({ where: { id: order.id }, data: { status: "canceled", closedAt: new Date() } });
    await expect(
      db.order.update({ where: { id: order.id }, data: { status: "pending_payment", closedAt: null } }),
    ).rejects.toThrow(/cannot go from canceled/);
  });

  it("checks that an order adds up, ships what's physical and stays in its customer's sandbox", async () => {
    const { ana, order } = await anOrder();
    const base = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    const copy = (overrides: object, items = base.items) => {
      const { id: _id, number: _n, items: _i, updatedAt: _u, cartId: _c, ...rest } = base;
      return db.order.create({
        data: {
          ...rest,
          id: uuidv7(),
          status: "canceled",
          closedAt: new Date(),
          ...overrides,
          items: {
            create: items.map(({ id: _itemId, orderId: _orderId, ...item }) => ({ ...item, id: uuidv7() })),
          },
        },
      });
    };
    await expect(copy({})).resolves.toBeTruthy();
    await expect(
      copy({ subtotalCents: base.subtotalCents + 100, totalCents: base.totalCents + 100 }),
    ).rejects.toThrow(/does not add up/);
    await expect(copy({ totalCents: base.totalCents + 1 })).rejects.toThrow(/orders_total/);
    await expect(
      copy(
        {},
        base.items.filter((item) => item.kind === "physical"),
      ),
    ).rejects.toThrow(/does not add up/);
    const digital = base.items.filter((item) => item.kind === "digital");
    await expect(
      copy({ subtotalCents: 2900, totalCents: 2900 + base.shippingCents }, digital),
    ).rejects.toThrow(/address exactly when something ships/);

    const bia = await customer(app);
    await expect(copy({ sandboxId: bia.sandboxId })).rejects.toThrow(/its customer's sandbox/);
    // Stock of an order moves in the order's sandbox only.
    await expect(
      db.$transaction((tx) =>
        app.get(Stock).move(tx, {
          variantId: COFFEE,
          sandboxId: bia.sandboxId,
          kind: "release",
          quantity: 2,
          orderId: order.id,
        }),
      ),
    ).rejects.toThrow(/order's sandbox/);
    // And is released once.
    const release = () =>
      db.$transaction((tx) =>
        app.get(Stock).move(tx, {
          variantId: COFFEE,
          sandboxId: ana.sandboxId,
          kind: "release",
          quantity: 2,
          orderId: order.id,
        }),
      );
    await release();
    await expect(release()).rejects.toThrow(/Unique constraint failed/);
  });
});
