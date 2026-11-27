import { z } from "zod";
import { ARTS, CATEGORY_SLUGS, type ProductKind } from "./catalog";
import type { OrderStatus, OrderSummary, OrderView } from "./orders";

/** Someone, as lists show them. */
export interface Person {
  id: string;
  name: string;
}

/** One entry of the admins' audit log. */
export interface AuditEntryView {
  id: string;
  actor: Person;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/**
 * Whose store an admin runs: the real one (every customer's orders, the shared catalog), or a demo's
 * (its own corner only: its orders, its products, its copy of the stock).
 */
export type AdminScope = "store" | "demo";

/** Where an order came from: a customer's account, or a one-click demo (removed after a day). */
export type OrderOrigin = "account" | "demo";

export const ORDER_ORIGIN_LABELS: Record<OrderOrigin, string> = { account: "Conta", demo: "Demo" };

// ---------------------------------------------------------------------------------------------------------
// Dashboard

export interface SalesFigure {
  orders: number;
  totalCents: number;
}

export interface LowStockLine {
  variantId: string;
  productId: string;
  title: string;
  options: string;
  sku: string;
  available: number;
}

/** An outbox event that gave up (a webhook that couldn't be handled, an email that couldn't be sent). */
export interface StuckEvent {
  id: string;
  type: string;
  attempts: number;
  lastError: string | null;
  failedAt: string;
}

export interface AdminDashboard {
  scope: AdminScope;
  sales7: SalesFigure;
  sales30: SalesFigure;
  byStatus: Record<OrderStatus, number>;
  /** Paid orders with something to ship, not shipped yet. */
  toShip: number;
  /** Paid orders whose payment didn't match (never counted as paid). */
  inReview: number;
  /** Orders with a dispute still open (the bank took the money back, pending evidence). */
  disputesOpen: number;
  /** Refunds Stripe couldn't make, or that failed later: the money is still with the store. */
  refundsFailed: number;
  lowStock: LowStockLine[];
  stuck: StuckEvent[];
}

// ---------------------------------------------------------------------------------------------------------
// Orders

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "canceled",
  "expired",
] as const satisfies readonly OrderStatus[];

const blank = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());

export const adminOrdersQuery = z.object({
  status: blank(z.enum(ORDER_STATUSES)),
  /** An order number, or part of a customer's name or email. */
  q: blank(z.string().trim().max(100)),
  /** Orders placed before this one (the next page). */
  before: blank(z.uuid()),
});
export type AdminOrdersQuery = z.input<typeof adminOrdersQuery>;

export interface AdminCustomerRef {
  id: string;
  name: string;
  email: string;
}

export interface AdminOrderSummary extends OrderSummary {
  customer: AdminCustomerRef;
  origin: OrderOrigin;
  paymentReview: boolean;
  disputeStatus: string | null;
  /** Something to ship (physical items). */
  ships: boolean;
}

export interface AdminOrderPage {
  orders: AdminOrderSummary[];
  /** Pass as `before` for the next page; null on the last. */
  next: string | null;
}

/** What Stripe has, as the last reconciliation saw it. */
export interface AdminPayment {
  paymentIntentId: string | null;
  latestChargeId: string | null;
  attempt: number;
  amountPaidCents: number;
  amountRefundedCents: number;
  checkedAt: string | null;
  problem: string | null;
  /** The PaymentIntent in Stripe's dashboard (test mode); null with the fake gateway. */
  dashboardUrl: string | null;
}

export interface AdminOrderView extends OrderView {
  customer: AdminCustomerRef;
  /** The latest dispute's status, if the customer's bank opened one. */
  disputeStatus: string | null;
  origin: OrderOrigin;
  ships: boolean;
  payment: AdminPayment;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export const shipOrderInput = z.object({
  trackingCode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase().replace(/\s+/g, ""))
    .pipe(z.string().regex(/^[A-Z0-9-]{5,40}$/, "Código de rastreio inválido")),
});
export type ShipOrderInput = z.input<typeof shipOrderInput>;

// ---------------------------------------------------------------------------------------------------------
// Catalog

export interface AdminVariant {
  id: string;
  sku: string;
  optionValues: string[];
  priceCents: number;
  compareAtCents: number | null;
  weightGrams: number | null;
  active: boolean;
  /** In the admin's corner of the store; null for digital. */
  available: number | null;
}

export interface AdminProduct {
  id: string;
  slug: string;
  kind: ProductKind;
  category: string;
  title: string;
  subtitle: string;
  description: string;
  art: string;
  optionNames: string[];
  active: boolean;
  /** The admin may change it: the real admin, shared products; a demo's, its own only. */
  editable: boolean;
  /** A demo's own product (not in the shared catalog). */
  own: boolean;
  variants: AdminVariant[];
}

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const priceCents = z.number().int().min(50).max(10_000_000);

export const variantInput = z.object({
  sku: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9-]{2,40}$/, "SKU: letras, números e hífens")),
  optionValues: z.array(text(1, 40)).max(3).default([]),
  priceCents,
  compareAtCents: priceCents.nullable().default(null),
  /** Physical products only. */
  weightGrams: z.number().int().min(1).max(30_000).nullable().default(null),
  /** Physical products only: the units it starts with. */
  initialStock: z.number().int().min(0).max(10_000).default(0),
});
export type VariantInput = z.input<typeof variantInput>;

export const productInput = z.object({
  kind: z.enum(["physical", "digital"]),
  category: z.enum(CATEGORY_SLUGS),
  title: text(3, 100),
  subtitle: text(3, 160),
  description: text(10, 4000),
  art: z.enum(ARTS),
  optionNames: z.array(text(1, 30)).max(3).default([]),
  variants: z.array(variantInput).min(1).max(20),
});
export type ProductInput = z.input<typeof productInput>;

export const productUpdate = z
  .object({
    title: text(3, 100),
    subtitle: text(3, 160),
    description: text(10, 4000),
    active: z.boolean(),
  })
  .partial();
export type ProductUpdate = z.input<typeof productUpdate>;

export const variantUpdate = z
  .object({
    priceCents,
    compareAtCents: priceCents.nullable(),
    weightGrams: z.number().int().min(1).max(30_000),
    active: z.boolean(),
  })
  .partial();
export type VariantUpdate = z.input<typeof variantUpdate>;

/** A correction of stock: units in (positive) or out (negative), and why. */
export const stockAdjustment = z.object({
  quantity: z
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((value) => value !== 0, "Informe quantas unidades entram ou saem."),
  reason: text(3, 200),
});
export type StockAdjustment = z.input<typeof stockAdjustment>;

// ---------------------------------------------------------------------------------------------------------
// Coupons

export interface AdminCoupon {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  description: string;
  minSubtotalCents: number;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  oncePerCustomer: boolean;
  active: boolean;
  /** Live uses, in the admin's view (all corners for the store, its own for a demo). */
  uses: number;
  editable: boolean;
}

export const couponInput = z
  .object({
    code: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase().replace(/\s+/g, ""))
      .pipe(z.string().regex(/^[A-Z0-9_-]{3,30}$/, "Código: 3 a 30 letras, números, - ou _")),
    kind: z.enum(["percent", "fixed"]),
    value: z.number().int().min(1).max(10_000_000),
    minSubtotalCents: z.number().int().min(0).max(10_000_000).default(0),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    oncePerCustomer: z.boolean().default(false),
  })
  .refine((coupon) => coupon.kind !== "percent" || coupon.value <= 100, {
    path: ["value"],
    message: "Percentual de 1 a 100.",
  })
  .refine((coupon) => !coupon.startsAt || !coupon.endsAt || coupon.startsAt < coupon.endsAt, {
    path: ["endsAt"],
    message: "O fim vem depois do início.",
  });
export type CouponInput = z.input<typeof couponInput>;

export const couponUpdate = z.object({ active: z.boolean() });

// ---------------------------------------------------------------------------------------------------------
// Customers

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  origin: OrderOrigin;
  emailVerified: boolean;
  createdAt: string;
  orders: number;
  /** Paid orders' totals, less refunds. */
  spentCents: number;
}

export const adminCustomersQuery = z.object({ q: blank(z.string().trim().max(100)) });
