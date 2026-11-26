import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { SEED_CATALOG } from "./catalog.ts";

/** A stable id per seeded row, so seeding again updates instead of duplicating. */
export function seedId(key: string): string {
  const hex = createHash("sha256").update(`torra-seed:${key}`).digest("hex");
  // UUID version 8 ("custom"), RFC 9562 variant.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Writes the shared catalog and the store's coupons. Safe to run again: products and variants are updated in place, and stock is
 * seeded only the first time (after that, stock moves only through orders and admins).
 */
export async function seedCatalog(
  db: PrismaClient,
): Promise<{ products: number; variants: number; coupons: number }> {
  let variants = 0;
  for (const [position, product] of SEED_CATALOG.entries()) {
    const productId = seedId(`product:${product.slug}`);
    const { variants: seedVariants, ...fields } = product;
    await db.product.upsert({
      where: { id: productId },
      create: { id: productId, ...fields, position },
      update: { ...fields, position },
    });
    for (const [index, variant] of seedVariants.entries()) {
      const variantId = seedId(`variant:${variant.sku}`);
      const { stock, ...variantFields } = variant;
      const data = {
        ...variantFields,
        compareAtCents: variant.compareAtCents ?? null,
        weightGrams: variant.weightGrams ?? null,
        position: index,
      };
      await db.variant.upsert({
        where: { id: variantId },
        create: { id: variantId, productId, ...data },
        update: data,
      });
      const seeded = await db.stockMovement.count({ where: { variantId, sandboxId: null, kind: "seed" } });
      if (product.kind === "physical" && stock && seeded === 0) {
        await db.stockMovement.create({
          data: {
            id: seedId(`stock:${variant.sku}`),
            variantId,
            kind: "seed",
            quantity: stock,
            reason: "Estoque inicial",
          },
        });
      }
      variants += 1;
    }
  }
  for (const coupon of SEED_COUPONS) {
    const id = seedId(`coupon:${coupon.code}`);
    await db.coupon.upsert({ where: { id }, create: { id, ...coupon }, update: coupon });
  }
  return { products: SEED_CATALOG.length, variants, coupons: SEED_COUPONS.length };
}

/** The store's own coupons, for every customer. */
export const SEED_COUPONS = [
  { code: "BEMVINDO10", kind: "percent" as const, value: 10, oncePerCustomer: true },
  { code: "TORRA20", kind: "fixed" as const, value: 2000, minSubtotalCents: 15_000, maxRedemptions: 100 },
];
