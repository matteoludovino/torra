import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OutOfStock, Stock, type Movement } from "../src/catalog/stock.service.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { DEMO_LIFETIME_MS, Sandboxes } from "../src/sandbox/sandboxes.service.ts";
import { seedCatalog, seedId } from "../src/seed/seed.ts";
import { FakeClock } from "../src/time/clock.ts";
import { resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
const stock = app.get(Stock);
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(db);
  await seedCatalog(db);
});

/** The last two black drippers (seeded with 2), and a coffee with 20 of each variant. */
const DRIPPER = seedId("variant:COAD-02-PT");
const COFFEE = seedId("variant:MANT-250-G");
const COURSE = seedId("variant:CURSO-COADO");

const sandbox = () => db.$transaction((tx) => app.get(Sandboxes).create(tx, null));
const order = () => uuidv7();
const move = (movement: Movement) => db.$transaction((tx) => stock.move(tx, movement));
const reserve = (variantId: string, sandboxId: string | null, quantity: number) =>
  move({ variantId, sandboxId, kind: "reserve", quantity: -quantity, orderId: order() });
const level = async (variantId: string, sandboxId: string | null) =>
  (await stock.available(db, [variantId], sandboxId)).get(variantId);

describe("stock per sandbox (copy-on-write)", () => {
  it("a sandbox's first touch copies the shared balance; from then on only its own copy moves", async () => {
    const [a, b] = [await sandbox(), await sandbox()];
    await reserve(COFFEE, a, 3);
    expect(await level(COFFEE, a)).toBe(17);
    expect(await level(COFFEE, b)).toBe(20); // never touched: sees the shared level
    expect(await level(COFFEE, null)).toBe(20); // the shared catalog's stock is untouched
    await reserve(COFFEE, b, 1);
    expect(await level(COFFEE, b)).toBe(19);
    expect(await level(COFFEE, a)).toBe(17);
    const copies = await db.stockMovement.findMany({
      where: { kind: "copy" },
      orderBy: { sandboxId: "asc" },
    });
    expect(copies.map((c) => c.quantity)).toEqual([20, 20]);
    expect(await stock.reconcile()).toEqual([]);
  });

  it("never goes below zero, and a refused movement leaves the transaction usable", async () => {
    const a = await sandbox();
    await reserve(DRIPPER, a, 2);
    await expect(reserve(DRIPPER, a, 1)).rejects.toBeInstanceOf(OutOfStock);
    await db.$transaction(async (tx) => {
      await expect(
        stock.move(tx, { variantId: DRIPPER, sandboxId: a, kind: "reserve", quantity: -1, orderId: order() }),
      ).rejects.toBeInstanceOf(OutOfStock);
      // The same transaction goes on.
      await stock.move(tx, {
        variantId: COFFEE,
        sandboxId: a,
        kind: "reserve",
        quantity: -1,
        orderId: order(),
      });
    });
    expect(await level(DRIPPER, a)).toBe(0);
    expect(await level(COFFEE, a)).toBe(19);
    expect(await level(DRIPPER, null)).toBe(2);
  });

  it("two buyers at once can't both have the last units, and a first touch copies once", async () => {
    for (let round = 0; round < 5; round++) {
      const s = await sandbox();
      // Both are this sandbox's first touch of the variant, and together they want 3 of the 2 left.
      const wants = [2, 1];
      const results = await Promise.allSettled(wants.map((quantity) => reserve(DRIPPER, s, quantity)));
      const won = results.flatMap((result, n) => (result.status === "fulfilled" ? [wants[n]!] : []));
      expect(won).toHaveLength(1);
      for (const result of results)
        if (result.status === "rejected") expect(result.reason).toBeInstanceOf(OutOfStock);
      expect(await level(DRIPPER, s)).toBe(2 - won[0]!);
      expect(await db.stockMovement.count({ where: { kind: "copy", sandboxId: s } })).toBe(1);
    }
    expect(await level(DRIPPER, null)).toBe(2);
    expect(await stock.reconcile()).toEqual([]);
  });

  it("a sandbox's own product moves only in that sandbox; digital products have no stock", async () => {
    const [a, b] = [await sandbox(), await sandbox()];
    const productId = uuidv7();
    await db.product.create({
      data: {
        id: productId,
        sandboxId: a,
        slug: "torra-da-demo",
        kind: "physical",
        category: "cafes",
        title: "Torra da demo",
        subtitle: "Só nesta demonstração.",
        description: "Um café criado pelo admin da demo.",
        art: "bag",
      },
    });
    const own = uuidv7();
    await db.variant.create({
      data: { id: own, productId, sandboxId: a, sku: "DEMO-1", priceCents: 3000, weightGrams: 290 },
    });
    await move({ variantId: own, sandboxId: a, kind: "seed", quantity: 5 });
    await expect(move({ variantId: own, sandboxId: b, kind: "seed", quantity: 5 })).rejects.toThrow(
      /moves only in that sandbox/,
    );
    await expect(move({ variantId: own, sandboxId: null, kind: "seed", quantity: 5 })).rejects.toThrow(
      /moves only in that sandbox/,
    );
    await expect(move({ variantId: COURSE, sandboxId: a, kind: "seed", quantity: 1 })).rejects.toThrow(
      /digital products have no stock/,
    );
    // A variant lives in its product's sandbox.
    await expect(
      db.variant.create({
        data: { id: uuidv7(), productId, sandboxId: b, sku: "DEMO-2", priceCents: 1, weightGrams: 1 },
      }),
    ).rejects.toThrow(/its product's sandbox/);
  });
});

describe("the database", () => {
  it("keeps levels derived from movements, and movements append-only", async () => {
    await expect(db.$executeRaw`UPDATE stock_levels SET available = 999`).rejects.toThrow(
      /only through stock movements/,
    );
    await expect(
      db.$executeRaw`INSERT INTO stock_levels (id, "variantId", available, "updatedAt") VALUES (gen_random_uuid(), ${COURSE}::uuid, 5, now())`,
    ).rejects.toThrow(/only through stock movements/);
    await expect(db.$executeRaw`UPDATE stock_movements SET quantity = 999`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM stock_movements`).rejects.toThrow(/append-only/);
    // A reservation needs an order, and has a sign.
    await expect(move({ variantId: COFFEE, sandboxId: null, kind: "reserve", quantity: -1 })).rejects.toThrow(
      /stock_movements_order_kinds/,
    );
    await expect(
      move({ variantId: COFFEE, sandboxId: null, kind: "reserve", quantity: 1, orderId: order() }),
    ).rejects.toThrow(/stock_movements_sign/);
    expect(await stock.reconcile()).toEqual([]);
  });

  it("removes a demo's copies of shared stock with the demo, and nothing shared", async () => {
    const demo = await db.$transaction((tx) => app.get(Sandboxes).create(tx, DEMO_LIFETIME_MS));
    await reserve(COFFEE, demo, 4);
    const sharedBefore = await db.stockMovement.count({ where: { sandboxId: null } });
    await app.get(Sandboxes).remove(demo);
    expect(await db.stockMovement.count({ where: { sandboxId: { not: null } } })).toBe(0);
    expect(await db.stockLevel.count({ where: { sandboxId: { not: null } } })).toBe(0);
    expect(await db.stockMovement.count({ where: { sandboxId: null } })).toBe(sharedBefore);
    expect(await level(COFFEE, null)).toBe(20);
  });
});
