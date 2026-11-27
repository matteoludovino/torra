import { z } from "zod";

/**
 * What a line gives back for `refunding` more units, when `already` were refunded before: its net (line
 * total less its discount share) spread over its units, in whole cents, so that refunding every unit, in
 * any steps, gives back exactly the net.
 */
export function lineRefundCents(
  netCents: number,
  quantity: number,
  already: number,
  refunding: number,
): number {
  return (
    Math.floor((netCents * (already + refunding)) / quantity) - Math.floor((netCents * already) / quantity)
  );
}

/**
 * A refund asked for in the admin panel: units of lines (optionally back to stock) and/or the shipping,
 * or an amount on its own (a goodwill gesture). Always with a reason.
 */
export const refundInput = z
  .object({
    items: z
      .array(
        z.object({
          orderItemId: z.uuid(),
          quantity: z.number().int().min(1).max(10),
          restock: z.boolean().default(false),
        }),
      )
      .max(20)
      .default([]),
    shipping: z.boolean().default(false),
    amountCents: z.number().int().min(1).max(100_000_000).optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .refine(
    (refund) => (refund.amountCents === undefined) !== (refund.items.length === 0 && !refund.shipping),
    {
      path: ["items"],
      message: "Escolha itens e/ou o frete, ou um valor.",
    },
  )
  .refine((refund) => new Set(refund.items.map((item) => item.orderItemId)).size === refund.items.length, {
    path: ["items"],
    message: "Cada item uma vez.",
  });
export type RefundInput = z.input<typeof refundInput>;

export type RefundStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: "Em processamento",
  requires_action: "Aguardando o banco",
  succeeded: "Reembolsado",
  failed: "Falhou",
  canceled: "Cancelado",
};

export interface RefundView {
  id: string;
  amountCents: number;
  shippingCents: number;
  status: RefundStatus;
  origin: "panel" | "cancellation" | "stripe";
  reason: string | null;
  failureReason: string | null;
  createdAt: string;
  items: { orderItemId: string; title: string; quantity: number; amountCents: number; restock: number }[];
}
