import { formatCep, type OrderStatus, type OrderSummary, type OrderView } from "@torra/shared";
import type { Order, OrderEvent, OrderItem, Prisma } from "../generated/prisma/client.ts";

export const orderInclude = {
  items: { orderBy: { position: "asc" } },
  events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.OrderInclude;

type FullOrder = Order & { items: OrderItem[]; events: OrderEvent[] };

/**
 * The status to show: an order past its hold reads as expired right away, before the sweep closes it
 * (reading never writes).
 */
function shownStatus(order: Order, now: Date): OrderStatus {
  return order.status === "pending_payment" && order.expiresAt <= now ? "expired" : order.status;
}

export function summaryOf(order: Order, items: number, now: Date): OrderSummary {
  return {
    id: order.id,
    number: order.number,
    status: shownStatus(order, now),
    totalCents: order.totalCents,
    createdAt: order.createdAt.toISOString(),
    items,
  };
}

const PAID = new Set<OrderStatus>(["paid", "preparing", "shipped", "delivered"]);

/** `link` makes a short-lived download link for a paid order's digital item. */
export function viewOf(order: FullOrder, now: Date, link: (orderItemId: string) => string): OrderView {
  const status = shownStatus(order, now);
  return {
    ...summaryOf(order, order.items.length, now),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    couponCode: order.couponCode,
    shipping:
      order.shippingService && order.shippingDaysMin !== null && order.shippingDaysMax !== null
        ? { service: order.shippingService, daysMin: order.shippingDaysMin, daysMax: order.shippingDaysMax }
        : null,
    address: order.cep
      ? {
          recipient: order.recipient!,
          cep: formatCep(order.cep),
          street: order.street!,
          number: order.streetNumber!,
          complement: order.complement,
          district: order.district!,
          city: order.city!,
          uf: order.uf!,
        }
      : null,
    expiresAt: status === "pending_payment" ? order.expiresAt.toISOString() : null,
    paidAt: order.paidAt?.toISOString() ?? null,
    paymentReview: order.paymentProblem !== null,
    trackingCode: order.trackingCode,
    lines: order.items.map((item) => ({
      variantId: item.variantId,
      kind: item.kind,
      title: item.title,
      options: item.options,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
      discountCents: item.discountCents,
    })),
    downloads: PAID.has(order.status)
      ? order.items
          .filter((item) => item.kind === "digital")
          .map((item) => ({ variantId: item.variantId, title: item.title, url: link(item.id) }))
      : [],
    events: order.events.map((event) => ({
      type: event.type,
      at: event.createdAt.toISOString(),
      data: event.data as Record<string, unknown>,
    })),
  };
}
