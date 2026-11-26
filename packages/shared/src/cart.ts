import { z } from "zod";
import type { ProductKind } from "./catalog";

/** Units of one variant a cart may hold (a digital product: one; it's a licence, not stock). */
export const MAX_PER_LINE = 10;

export const addToCartInput = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_PER_LINE).default(1),
});
export type AddToCartInput = z.input<typeof addToCartInput>;

/** 0 removes the line. */
export const setQuantityInput = z.object({ quantity: z.number().int().min(0).max(MAX_PER_LINE) });

/**
 * What stands between a line and checkout, if anything:
 * - unavailable: no longer sold, or sold out;
 * - insufficient: fewer units left than the line asks for (see `available`);
 * - price_changed: the price is no longer the one the customer saw (they confirm, or remove the line).
 */
export type CartIssue = "unavailable" | "insufficient" | "price_changed";

export interface CartLine {
  variantId: string;
  sku: string;
  product: { slug: string; title: string; art: string; kind: ProductKind };
  /** "Peso: 250 g · Moagem: Em grãos"; empty for a product with a single variant. */
  options: { name: string; value: string }[];
  quantity: number;
  /** Always the current price: what checkout charges. */
  unitPriceCents: number;
  /** The price the customer saw when adding it (differs only with a price_changed issue). */
  seenPriceCents: number;
  lineTotalCents: number;
  /** Per unit, packaging included; null for digital. Shipping is priced on the parcel's total. */
  weightGrams: number | null;
  /** Units available in the customer's corner of the store; null for digital. */
  available: number | null;
  /** The most a line can be set to right now. */
  maxQuantity: number;
  issue: CartIssue | null;
}

export interface CartView {
  lines: CartLine[];
  /** Units across all lines (the header's badge). */
  count: number;
  subtotalCents: number;
  /** Ready for checkout: something in it, and no line with an issue. */
  ready: boolean;
}
