import { z } from "zod";
import { cep, SHIPPING_SERVICES, UFS, type ShippingOption, type ShippingService, type Uf } from "./shipping";

/** Coupon codes are stored and compared in upper case, without spaces. */
export const couponCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/\s+/g, ""))
  .pipe(z.string().regex(/^[A-Z0-9_-]{3,30}$/, "Código de cupom inválido"));

/** What the cart page and checkout ask the server to price: where to, which service, which coupon. */
export const quoteInput = z.object({
  cep: cep.optional(),
  shippingService: z.enum(SHIPPING_SERVICES).optional(),
  couponCode: couponCode.optional(),
  /** The state, typed by hand: used only when the postal directory doesn't answer. */
  uf: z.enum(UFS).optional(),
});
export type QuoteInput = z.input<typeof quoteInput>;

export interface Address {
  cep: string;
  street: string;
  district: string;
  city: string;
  uf: Uf;
}

export interface Quote {
  /** Nothing to ship: no address, no shipping. */
  digitalOnly: boolean;
  /** The CEP's address (from the postal directory), if one was given and found. */
  address: Address | null;
  /** Why there are no options yet: no CEP given, unknown CEP, or the directory didn't answer. */
  shippingProblem: "needs_cep" | "unknown_cep" | "lookup_unavailable" | null;
  shippingOptions: ShippingOption[];
  shippingService: ShippingService | null;
  coupon: { code: string; description: string } | null;
  /** A coupon was given but can't be used: why. */
  couponProblem: string | null;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  /** Between R$ 0,01 and R$ 0,49: too little to charge by card (Stripe's minimum is R$ 0,50). */
  belowMinimum: boolean;
  /** Everything needed to pay is there (the cart has no issues, an address for physical items, a payable total). */
  complete: boolean;
}

/** "10% de desconto", "R$ 20,00 de desconto em compras a partir de R$ 150,00". */
export interface CouponTerms {
  kind: "percent" | "fixed";
  value: number;
  minSubtotalCents: number;
}
