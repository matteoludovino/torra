import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ProductDetail, ProductSummary } from "@torra/shared";
import { Stock } from "../src/catalog/stock.service.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, admin, bareOrder, customer, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(db);
  await seedCatalog(db);
});

const list = async (who: Browser, query = "") =>
  ((await who.get(`/api/catalog${query}`)).json() as ProductSummary[]).map((p) => p.slug);
const product = async (who: Browser, slug: string) =>
  (await who.get(`/api/catalog/${slug}`)).json() as ProductDetail;

describe("the storefront", () => {
  it("lists the catalog in its order, by category, with prices from the cheapest variant", async () => {
    const visitor = new Browser(app);
    const all = (await visitor.get("/api/catalog")).json() as ProductSummary[];
    expect(all).toHaveLength(12);
    expect(all[0]).toMatchObject({
      slug: "mantiqueira-bourbon-amarelo",
      kind: "physical",
      category: "cafes",
      art: "bag",
      priceFromCents: 4900,
      priceVaries: true,
      soldOut: false,
    });
    expect(await list(visitor, "?categoria=cursos")).toEqual([
      "curso-cafe-coado-em-casa",
      "ebook-receitas-de-cafe-gelado",
      "curso-espresso-do-zero",
    ]);
    const kettle = all.find((p) => p.slug === "chaleira-bico-de-ganso")!;
    expect(kettle).toMatchObject({ priceFromCents: 22900, priceVaries: false });
    // No stock in any variant: sold out. Some variants gone: still on sale.
    expect(all.find((p) => p.slug === "balanca-com-timer")!.soldOut).toBe(true);
    expect(all.find((p) => p.slug === "caparao-natural-fermentado")!.soldOut).toBe(false);
    // Digital products are never sold out.
    expect(all.filter((p) => p.kind === "digital").every((p) => !p.soldOut)).toBe(true);
    // Empty fields from a plain form are no filter; an unknown category is a 400.
    expect(await list(visitor, "?categoria=&busca=")).toHaveLength(12);
    expect((await visitor.get("/api/catalog?categoria=vinhos")).statusCode).toBe(400);
  });

  it("searches Portuguese without accents, title first", async () => {
    const visitor = new Browser(app);
    expect(await list(visitor, "?busca=chaleira")).toEqual(["chaleira-bico-de-ganso"]);
    // "cafe" finds "café" and "cafés"; the coffee whose title says it comes first.
    const coffee = await list(visitor, "?busca=cafe+gelado");
    expect(coffee[0]).toBe("ebook-receitas-de-cafe-gelado");
    expect(await list(visitor, `?busca=${encodeURIComponent("cerâmica")}`)).toContain(
      "coador-conico-ceramica-02",
    );
    // In the title (the course) ranks above in the subtitle (the e-book's "tônica com espresso").
    expect(await list(visitor, "?busca=espresso&categoria=cursos")).toEqual([
      "curso-espresso-do-zero",
      "ebook-receitas-de-cafe-gelado",
    ]);
    expect(await list(visitor, "?busca=xyzzy")).toEqual([]);
  });

  it("shows a product's variants with what's available in the viewer's corner of the store", async () => {
    const visitor = new Browser(app);
    const caparao = await product(visitor, "caparao-natural-fermentado");
    expect(caparao.optionNames).toEqual(["Peso", "Moagem"]);
    expect(caparao.variants).toHaveLength(9);
    expect(caparao.variants[0]).toMatchObject({
      sku: "CAPA-250-G",
      optionValues: ["250 g", "Em grãos"],
      priceCents: 6900,
      weightGrams: 290,
      available: 3,
    });
    expect(caparao.variants.filter((v) => v.optionValues[0] === "1 kg").every((v) => v.available === 0)).toBe(
      true,
    );
    const course = await product(visitor, "curso-espresso-do-zero");
    expect(course.variants[0]).toMatchObject({ available: null, weightGrams: null, compareAtCents: 24700 });

    // A customer's reservations show in their own view only.
    const someone = await customer(app);
    const variantId = seedId("variant:CAPA-250-G");
    const orderId = await bareOrder(app, someone.sandboxId, someone.me.id);
    await db.$transaction((tx) =>
      app.get(Stock).move(tx, {
        variantId,
        sandboxId: someone.sandboxId,
        kind: "reserve",
        quantity: -2,
        orderId,
      }),
    );
    const mine = await product(someone.browser, "caparao-natural-fermentado");
    expect(mine.variants.find((v) => v.id === variantId)!.available).toBe(1);
    const theirs = await product(new Browser(app), "caparao-natural-fermentado");
    expect(theirs.variants.find((v) => v.id === variantId)!.available).toBe(3);

    expect((await visitor.get("/api/catalog/nao-existe")).statusCode).toBe(404);
    expect((await visitor.get("/api/catalog/Nao%20Valido!")).statusCode).toBe(404);
  });

  it("keeps a sandbox's own products to that sandbox, and inactive ones out of sight", async () => {
    const owner = await customer(app);
    const other = await customer(app);
    const productId = uuidv7();
    await db.product.create({
      data: {
        id: productId,
        sandboxId: owner.sandboxId,
        slug: "torra-da-demo",
        kind: "digital",
        category: "cursos",
        title: "Aula extra da demo",
        subtitle: "Só nesta demonstração.",
        description: "Um curso criado pelo admin da demo.",
        art: "course",
        position: -1,
      },
    });
    await db.variant.create({
      data: { id: uuidv7(), productId, sandboxId: owner.sandboxId, sku: "DEMO-AULA", priceCents: 1000 },
    });
    expect((await list(owner.browser))[0]).toBe("torra-da-demo");
    expect((await product(owner.browser, "torra-da-demo")).title).toBe("Aula extra da demo");
    for (const outsider of [other.browser, new Browser(app), (await admin(app)).browser]) {
      expect(await list(outsider)).not.toContain("torra-da-demo");
      expect((await outsider.get("/api/catalog/torra-da-demo")).statusCode).toBe(404);
    }

    await db.product.update({
      where: { id: seedId("product:chaleira-bico-de-ganso") },
      data: { active: false },
    });
    expect(await list(new Browser(app))).not.toContain("chaleira-bico-de-ganso");
    expect((await new Browser(app).get("/api/catalog/chaleira-bico-de-ganso")).statusCode).toBe(404);
  });
});
