import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Address, Quote } from "@torra/shared";
import { AddressLookup } from "../src/checkout/address-lookup.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, bareOrder, customer, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
afterAll(() => app.close());

/** The postal directory, as tests know it: two real CEPs, an unknown one, and one that makes it fail. */
const DIRECTORY: Record<string, object> = {
  "01310100": { logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" },
  "69005000": { logradouro: "Rua Barroso", bairro: "Centro", localidade: "Manaus", uf: "AM" },
  "00000000": { erro: "true" },
};
let lookups = 0;
const lookup = app.get(AddressLookup);
lookup.fetch = async (input) => {
  lookups += 1;
  const cep = String(input).match(/ws\/(\d{8})\//)![1]!;
  if (cep === "99999999") throw new Error("connect ETIMEDOUT");
  return new Response(JSON.stringify(DIRECTORY[cep] ?? { erro: "true" }), { status: 200 });
};

beforeEach(async () => {
  await resetDb(db);
  await seedCatalog(db);
});

const COFFEE = seedId("variant:MANT-250-G"); // R$ 49,00, 290 g
const KG = seedId("variant:MANT-1K-G"); // R$ 165,00, 1040 g
const EBOOK = seedId("variant:EBOOK-GELADO"); // R$ 29,00, digital

const add = (who: Browser, variantId: string, quantity = 1) => {
  clock.advance(1000);
  return who.post("/api/cart/items", { variantId, quantity });
};
async function quote(who: Browser, input: object = {}): Promise<Quote> {
  const response = await who.post("/api/checkout/quote", input);
  if (response.statusCode !== 200) throw new Error(`quote failed: ${response.body}`);
  return response.json();
}

describe("shipping", () => {
  it("prices by the CEP's state and the parcel's weight, cheapest service unless asked", async () => {
    const visitor = new Browser(app);
    await add(visitor, COFFEE, 2); // 580 g: the first kilo
    const sp = await quote(visitor, { cep: "01310-100" });
    expect(sp.address).toMatchObject({
      cep: "01310-100",
      street: "Avenida Paulista",
      city: "São Paulo",
      uf: "SP",
    });
    expect(sp.shippingOptions.map((o) => [o.service, o.priceCents, o.daysMin, o.daysMax])).toEqual([
      ["economico", 1990, 4, 6],
      ["expresso", 3490, 1, 2],
    ]);
    expect(sp).toMatchObject({
      shippingService: "economico",
      shippingCents: 1990,
      totalCents: 9800 + 1990,
      complete: true,
    });
    expect((await quote(visitor, { cep: "01310100", shippingService: "expresso" })).totalCents).toBe(
      9800 + 3490,
    );

    await add(visitor, KG); // 1620 g: two kilos, to the North
    const am = await quote(visitor, { cep: "69005000" });
    expect(am.shippingOptions[0]).toMatchObject({ priceCents: 3490 + 1100, free: false });
    // R$ 312 in products: economy goes free.
    await add(visitor, COFFEE);
    const free = await quote(visitor, { cep: "69005000" });
    expect(free.shippingOptions[0]).toMatchObject({ free: true, priceCents: 0, fullPriceCents: 3490 + 1100 });
    expect(free.shippingCents).toBe(0);
    // Free shipping counts the products after the discount: R$ 20 off takes it below R$ 300.
    const discounted = await quote(visitor, { cep: "69005000", couponCode: "TORRA20" });
    expect(discounted).toMatchObject({ discountCents: 2000, shippingCents: 4590 });
    // The directory is asked once per CEP.
    expect(lookups).toBe(2);
  });

  it("asks for a CEP for physical items only, and copes with unknown CEPs and a silent directory", async () => {
    const visitor = new Browser(app);
    await add(visitor, EBOOK);
    expect(await quote(visitor)).toMatchObject({
      digitalOnly: true,
      shippingProblem: null,
      totalCents: 2900,
      complete: true,
    });

    await add(visitor, COFFEE);
    expect(await quote(visitor)).toMatchObject({
      digitalOnly: false,
      shippingProblem: "needs_cep",
      complete: false,
    });
    expect(await quote(visitor, { cep: "00000-000" })).toMatchObject({
      shippingProblem: "unknown_cep",
      complete: false,
    });
    const down = await quote(visitor, { cep: "99999-999" });
    expect(down).toMatchObject({ shippingProblem: "lookup_unavailable", complete: false });
    // Then the state typed by hand prices it.
    const typed = await quote(visitor, { cep: "99999-999", uf: "RS" });
    expect(typed).toMatchObject({
      shippingProblem: null,
      address: { uf: "RS", street: "" },
      shippingCents: 2490,
    });
    expect((await visitor.post("/api/checkout/quote", { cep: "123" })).statusCode).toBe(400);
    expect((await new Browser(app).post("/api/checkout/quote", {})).json().error.code).toBe("empty_cart");
  });

  it("looks up an address for the form, and says when it can't", async () => {
    const visitor = new Browser(app);
    expect((await visitor.get("/api/address/69005-000")).json() as Address).toMatchObject({
      city: "Manaus",
      uf: "AM",
    });
    expect((await visitor.get("/api/address/00000000")).statusCode).toBe(404);
    expect((await visitor.get("/api/address/123")).statusCode).toBe(404);
    const down = await visitor.get("/api/address/99999999");
    expect(down.statusCode).toBe(503);
    expect(down.json().error.code).toBe("lookup_unavailable");
  });
});

describe("coupons", () => {
  it("take a percentage (rounded down) or an amount off the products, never off shipping", async () => {
    const visitor = new Browser(app);
    await add(visitor, COFFEE, 3); // R$ 147,00
    const ten = await quote(visitor, { cep: "01310100", couponCode: " bemvindo10 " });
    expect(ten).toMatchObject({
      coupon: { code: "BEMVINDO10", description: "10% de desconto" },
      subtotalCents: 14700,
      discountCents: 1470,
      shippingCents: 1990,
      totalCents: 14700 - 1470 + 1990,
    });
    // TORRA20: from R$ 150,00.
    // (Currency puts a non-breaking space after "R$".)
    expect((await quote(visitor, { couponCode: "TORRA20" })).couponProblem?.replace(/\s/g, " ")).toBe(
      "Válido em compras a partir de R$ 150,00.",
    );
    await add(visitor, COFFEE);
    expect(await quote(visitor, { couponCode: "TORRA20" })).toMatchObject({
      discountCents: 2000,
      couponProblem: null,
    });
    expect((await quote(visitor, { couponCode: "NAOEXISTE" })).couponProblem).toBe("Cupom não encontrado.");
  });

  it("have dates, and a total limit counted in each customer's own corner", async () => {
    const now = clock.now();
    await db.coupon.createMany({
      data: [
        {
          id: uuidv7(),
          code: "AMANHA",
          kind: "percent",
          value: 5,
          startsAt: new Date(now.getTime() + 86_400_000),
        },
        { id: uuidv7(), code: "ONTEM", kind: "percent", value: 5, endsAt: now },
      ],
    });
    const a = await customer(app);
    const b = await customer(app);
    for (const who of [a, b]) await add(who.browser, KG);
    expect((await quote(a.browser, { couponCode: "AMANHA" })).couponProblem).toBe(
      "Este cupom ainda não está valendo.",
    );
    expect((await quote(a.browser, { couponCode: "ONTEM" })).couponProblem).toBe("Este cupom expirou.");

    // TORRA20 allows a number of uses per corner (2, for this test): A has used them all, B none.
    const torra = seedId("coupon:TORRA20");
    await db.coupon.update({ where: { id: torra }, data: { maxRedemptions: 2 } });
    for (let n = 0; n < 2; n++) {
      await db.couponRedemption.create({
        data: {
          id: uuidv7(),
          couponId: torra,
          userId: a.me.id,
          sandboxId: a.sandboxId,
          orderId: await bareOrder(app, a.sandboxId, a.me.id),
          exclusive: false,
        },
      });
    }
    expect((await quote(a.browser, { couponCode: "TORRA20" })).couponProblem).toBe("Este cupom esgotou.");
    expect((await quote(b.browser, { couponCode: "TORRA20" })).couponProblem).toBeNull();
    // A released use (its order expired) frees a place.
    await db.couponRedemption.updateMany({
      where: { id: (await db.couponRedemption.findFirstOrThrow()).id },
      data: { releasedAt: now },
    });
    expect((await quote(a.browser, { couponCode: "TORRA20" })).couponProblem).toBeNull();
  });

  it("can be once per customer, and the database keeps it so", async () => {
    const someone = await customer(app);
    await add(someone.browser, KG);
    const welcome = seedId("coupon:BEMVINDO10");
    const use = async () =>
      db.couponRedemption.create({
        data: {
          id: uuidv7(),
          couponId: welcome,
          userId: someone.me.id,
          sandboxId: someone.sandboxId,
          orderId: await bareOrder(app, someone.sandboxId, someone.me.id),
          exclusive: true,
        },
      });
    const first = await use();
    expect((await quote(someone.browser, { couponCode: "BEMVINDO10" })).couponProblem).toBe(
      "Você já usou este cupom.",
    );
    await expect(use()).rejects.toThrow(/couponId_userId|Unique constraint/);
    await db.couponRedemption.update({ where: { id: first.id }, data: { releasedAt: clock.now() } });
    expect((await quote(someone.browser, { couponCode: "BEMVINDO10" })).couponProblem).toBeNull();
    await use(); // released: a new live use is fine
    // A visitor's quote can't know whose first purchase it is: that's checked when the order is placed.
    const visitor = new Browser(app);
    await add(visitor, KG);
    expect((await quote(visitor, { couponCode: "BEMVINDO10" })).couponProblem).toBeNull();
  });

  it("stay in their corner: a sandbox's code, never shadowing a shared one", async () => {
    const owner = await customer(app);
    const other = await customer(app);
    await db.coupon.create({
      data: { id: uuidv7(), sandboxId: owner.sandboxId, code: "SODEMO", kind: "fixed", value: 500 },
    });
    for (const who of [owner, other]) await add(who.browser, KG);
    expect((await quote(owner.browser, { couponCode: "SODEMO" })).discountCents).toBe(500);
    expect((await quote(other.browser, { couponCode: "SODEMO" })).couponProblem).toBe(
      "Cupom não encontrado.",
    );
    await expect(
      db.coupon.create({
        data: { id: uuidv7(), sandboxId: owner.sandboxId, code: "TORRA20", kind: "fixed", value: 1 },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
    await expect(
      db.coupon.create({ data: { id: uuidv7(), code: "SODEMO", kind: "fixed", value: 1 } }),
    ).rejects.toThrow(/Unique constraint failed/);
    // A use is counted in the customer's own corner only.
    await expect(
      db.couponRedemption.create({
        data: {
          id: uuidv7(),
          couponId: seedId("coupon:TORRA20"),
          userId: owner.me.id,
          sandboxId: other.sandboxId,
          orderId: await bareOrder(app, other.sandboxId, other.me.id),
          exclusive: false,
        },
      }),
    ).rejects.toThrow(/customer's sandbox/);
  });
});

describe("the quote", () => {
  it("isn't complete while the cart has an issue, nor below the card minimum", async () => {
    const someone = await customer(app);
    await add(someone.browser, EBOOK);
    await db.coupon.create({
      data: { id: uuidv7(), sandboxId: someone.sandboxId, code: "QUASE", kind: "fixed", value: 2880 },
    });
    // R$ 29,00 − R$ 28,80 = R$ 0,20: too little to charge by card.
    expect(await quote(someone.browser, { couponCode: "QUASE" })).toMatchObject({
      totalCents: 20,
      belowMinimum: true,
      complete: false,
    });
    await db.variant.update({ where: { id: EBOOK }, data: { priceCents: 3100 } });
    expect(await quote(someone.browser)).toMatchObject({ totalCents: 3100, complete: false }); // price changed
  });
});
