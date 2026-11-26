import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CartView } from "@torra/shared";
import { Stock } from "../src/catalog/stock.service.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, PASSWORD, admin, customer, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(db);
  await seedCatalog(db);
});

const COFFEE = seedId("variant:MANT-250-G"); // R$ 49,00, 20 in stock
const DRIPPER = seedId("variant:COAD-02-PT"); // R$ 129,00, 2 in stock
const SCALE = seedId("variant:BAL-2K"); // sold out
const COURSE = seedId("variant:CURSO-COADO"); // digital, R$ 97,00

/** Adds a line a second after the previous one: lines are listed in the order they were added. */
const add = (who: Browser, variantId: string, quantity = 1) => {
  clock.advance(1000);
  return who.post("/api/cart/items", { variantId, quantity });
};
const cart = async (who: Browser) => (await who.get("/api/cart")).json() as CartView;

describe("a visitor's cart", () => {
  it("lives behind its own cookie, with the catalog's prices and nothing taken from the client", async () => {
    const visitor = new Browser(app);
    expect(await cart(visitor)).toEqual({ lines: [], count: 0, subtotalCents: 0, ready: false });
    expect(visitor.cookies.has("torra_cart")).toBe(false); // looking creates nothing

    expect((await add(visitor, COFFEE, 2)).statusCode).toBe(200);
    expect(visitor.cookies.has("torra_cart")).toBe(true);
    clock.advance(1000);
    await visitor.post("/api/cart/items", { variantId: COURSE, quantity: 1, priceCents: 1 }); // ignored
    const view = await cart(visitor);
    expect(view.lines.map((l) => [l.product.slug, l.quantity, l.unitPriceCents, l.lineTotalCents])).toEqual([
      ["mantiqueira-bourbon-amarelo", 2, 4900, 9800],
      ["curso-cafe-coado-em-casa", 1, 9700, 9700],
    ]);
    expect(view.lines[0]!.options).toEqual([
      { name: "Peso", value: "250 g" },
      { name: "Moagem", value: "Em grãos" },
    ]);
    expect(view).toMatchObject({ count: 3, subtotalCents: 19500, ready: true });
    // Only its hash is stored.
    const stored = await db.cart.findFirstOrThrow();
    expect(stored.tokenHash).not.toBeNull();
    expect(Buffer.from(stored.tokenHash!).toString()).not.toContain(visitor.cookies.get("torra_cart")!);
    // Another visitor sees their own (empty) cart.
    expect((await cart(new Browser(app))).lines).toEqual([]);
  });

  it("keeps quantities within stock, ten per line, and one of a digital product", async () => {
    const visitor = new Browser(app);
    await add(visitor, DRIPPER, 2);
    const more = await add(visitor, DRIPPER);
    expect(more.statusCode).toBe(409);
    expect(more.json().error).toMatchObject({ code: "insufficient_stock", message: "Só há 2 em estoque." });
    expect((await add(visitor, SCALE)).json().error.message).toBe("Este item esgotou.");
    expect((await add(visitor, COFFEE, 10)).statusCode).toBe(200);
    expect((await add(visitor, COFFEE)).json().error.code).toBe("max_per_line");
    expect((await visitor.post("/api/cart/items", { variantId: COFFEE, quantity: 11 })).statusCode).toBe(400);
    await add(visitor, COURSE);
    await add(visitor, COURSE);
    expect((await cart(visitor)).lines.find((l) => l.variantId === COURSE)!.quantity).toBe(1);
    expect((await visitor.put(`/api/cart/items/${COURSE}`, { quantity: 2 })).json().error.code).toBe(
      "one_per_customer",
    );

    expect((await visitor.put(`/api/cart/items/${COFFEE}`, { quantity: 3 })).json().lines[1].quantity).toBe(
      3,
    );
    expect((await visitor.delete(`/api/cart/items/${DRIPPER}`)).json().lines).toHaveLength(2);
    expect((await visitor.put(`/api/cart/items/${COFFEE}`, { quantity: 0 })).json().lines).toHaveLength(1);
    expect((await visitor.put(`/api/cart/items/${DRIPPER}`, { quantity: 1 })).json().error.code).toBe(
      "not_in_cart",
    );
    expect((await add(visitor, uuidv7())).statusCode).toBe(404);
  });

  it("says what changed: a new price (until acknowledged), fewer units, a product gone", async () => {
    const visitor = new Browser(app);
    await add(visitor, COFFEE, 3);
    await add(visitor, DRIPPER, 2);
    await add(visitor, COURSE);

    await db.variant.update({ where: { id: COFFEE }, data: { priceCents: 5400 } });
    // Another customer's purchase doesn't touch the shared stock a visitor sees; the store's does.
    await db.$transaction((tx) =>
      app
        .get(Stock)
        .move(tx, { variantId: DRIPPER, sandboxId: null, kind: "adjust", quantity: -1, reason: "Quebrou" }),
    );
    await db.product.update({
      where: { id: seedId("product:curso-cafe-coado-em-casa") },
      data: { active: false },
    });

    const view = await cart(visitor);
    expect(
      view.lines.map((l) => [l.issue, l.unitPriceCents, l.seenPriceCents, l.available, l.maxQuantity]),
    ).toEqual([
      ["price_changed", 5400, 4900, 20, 10],
      ["insufficient", 12900, 12900, 1, 1],
      ["unavailable", 9700, 9700, null, 1],
    ]);
    // The total is always at today's prices.
    expect(view).toMatchObject({ subtotalCents: 3 * 5400 + 2 * 12900 + 9700, ready: false });

    const seen = (await visitor.post("/api/cart/acknowledge-prices")).json() as CartView;
    expect(seen.lines[0]).toMatchObject({ issue: null, seenPriceCents: 5400 });
    await visitor.put(`/api/cart/items/${DRIPPER}`, { quantity: 1 });
    await visitor.delete(`/api/cart/items/${COURSE}`);
    expect((await cart(visitor)).ready).toBe(true);
  });

  it("is removed after 30 days without use, and limits writes per address", async () => {
    const visitor = new Browser(app);
    await add(visitor, COFFEE);
    clock.advance(29 * 24 * 3_600_000);
    await add(visitor, COFFEE); // used again: the clock restarts
    clock.advance(29 * 24 * 3_600_000);
    await app.get(Scheduler).runOnce();
    expect(await db.cart.count()).toBe(1);
    clock.advance(2 * 24 * 3_600_000);
    await app.get(Scheduler).runOnce();
    expect(await db.cart.count()).toBe(0);

    const busy = new Browser(app);
    for (let n = 0; n < 60; n++) await busy.put(`/api/cart/items/${COFFEE}`, { quantity: 1 });
    expect((await add(busy, COFFEE)).statusCode).toBe(429);
  });
});

describe("a customer's cart", () => {
  it("takes in the visitor cart on sign-in: quantities add up within the limit, and the cookie goes", async () => {
    const someone = await customer(app, "Ana Souza", "ana@exemplo.com");
    await add(someone.browser, COFFEE, 8);
    await someone.browser.post("/api/auth/logout");

    const browser = new Browser(app);
    await add(browser, COFFEE, 5);
    await add(browser, COURSE);
    const login = await browser.post("/api/auth/login", { email: "ana@exemplo.com", password: PASSWORD });
    expect(login.statusCode).toBe(200);
    expect(browser.cookies.has("torra_cart")).toBe(false);
    const view = await cart(browser);
    expect(view.lines.map((l) => [l.product.slug, l.quantity])).toEqual([
      ["mantiqueira-bourbon-amarelo", 10],
      ["curso-cafe-coado-em-casa", 1],
    ]);
    expect(await db.cart.count()).toBe(1);
    expect((await db.cart.findFirstOrThrow()).sandboxId).toBe(someone.sandboxId);
  });

  it("sees stock as the customer's own corner has it, and sign-up brings the visitor cart along", async () => {
    const browser = new Browser(app);
    await add(browser, DRIPPER, 2);
    const signup = await browser.post("/api/auth/signup", {
      name: "Bia",
      email: "bia@exemplo.com",
      password: PASSWORD,
    });
    expect(signup.statusCode).toBe(201);
    const { sandboxId } = await db.user.findUniqueOrThrow({ where: { email: "bia@exemplo.com" } });
    expect((await cart(browser)).lines[0]).toMatchObject({ quantity: 2, issue: null });

    // Units reserved in her own sandbox (an order, from stage 5 on) leave her fewer; others don't see it.
    await db.$transaction((tx) =>
      app
        .get(Stock)
        .move(tx, { variantId: DRIPPER, sandboxId, kind: "reserve", quantity: -1, orderId: uuidv7() }),
    );
    expect((await cart(browser)).lines[0]).toMatchObject({ issue: "insufficient", available: 1 });
    const other = new Browser(app);
    expect((await add(other, DRIPPER, 2)).statusCode).toBe(200);
  });

  it("isn't for the store's admins, who'd be buying the shared stock", async () => {
    const storeAdmin = await admin(app);
    expect((await cart(storeAdmin.browser)).lines).toEqual([]);
    const refused = await add(storeAdmin.browser, COFFEE);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("admins_dont_shop");
  });

  it("can't hold another sandbox's products, even written straight to the database", async () => {
    const owner = await customer(app);
    const other = await customer(app);
    const productId = uuidv7();
    await db.product.create({
      data: {
        id: productId,
        sandboxId: owner.sandboxId,
        slug: "aula-da-demo",
        kind: "digital",
        category: "cursos",
        title: "Aula da demo",
        subtitle: "Só nesta demonstração.",
        description: "Um curso criado pelo admin da demo.",
        art: "course",
      },
    });
    const theirs = uuidv7();
    await db.variant.create({
      data: { id: theirs, productId, sandboxId: owner.sandboxId, sku: "AULA", priceCents: 1000 },
    });
    expect((await add(owner.browser, theirs)).statusCode).toBe(200);
    expect((await add(other.browser, theirs)).statusCode).toBe(404);
    expect((await add(new Browser(app), theirs)).statusCode).toBe(404);

    await add(other.browser, COFFEE);
    const otherCart = await db.cart.findUniqueOrThrow({ where: { userId: other.me.id } });
    await expect(
      db.cartItem.create({
        data: { cartId: otherCart.id, variantId: theirs, quantity: 1, seenPriceCents: 1000 },
      }),
    ).rejects.toThrow(/its own sandbox's only/);
  });

  it("is made once when first adds race", async () => {
    const variants = [
      "MANT-250-G",
      "MANT-500-G",
      "CERR-250-G",
      "CHAP-250-G",
      "CASA-250-G",
      "CURSO-COADO",
    ].map((sku) => seedId(`variant:${sku}`));
    for (let round = 0; round < 5; round++) {
      const someone = await customer(app);
      const answers = await Promise.all(variants.map((variantId) => add(someone.browser, variantId)));
      expect(answers.map((a) => a.statusCode)).toEqual(variants.map(() => 200));
      expect(await db.cart.count({ where: { userId: someone.me.id } })).toBe(1);
      expect((await cart(someone.browser)).lines).toHaveLength(variants.length);
    }
  });
});
