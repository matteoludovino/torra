import { z } from "zod";
import { couponCode } from "./checkout";
import { cep, SHIPPING_SERVICES, UFS } from "./shipping";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Where a physical order goes. The CEP's directory fills most of it in; the customer confirms. */
export const deliveryAddress = z.object({
  recipient: text(2, 100),
  cep,
  street: text(2, 120),
  number: text(1, 20),
  complement: z
    .string()
    .trim()
    .max(60)
    .transform((value) => value || null)
    .nullable()
    .default(null),
  district: text(2, 80),
  city: text(2, 80),
  uf: z.enum(UFS),
});
export type DeliveryAddress = z.input<typeof deliveryAddress>;

/** Placing an order from the cart: the address and shipping for physical items, and a coupon. */
export const placeOrderInput = z.object({
  address: deliveryAddress.optional(),
  shippingService: z.enum(SHIPPING_SERVICES).optional(),
  couponCode: couponCode.optional(),
});
export type PlaceOrderInput = z.input<typeof placeOrderInput>;

export type OrderStatus =
  "pending_payment" | "paid" | "preparing" | "shipped" | "delivered" | "canceled" | "expired";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Pago",
  preparing: "Em preparo",
  shipped: "Enviado",
  delivered: "Entregue",
  canceled: "Cancelado",
  expired: "Expirado",
};

/** What a line of an order says, as it was bought. */
export interface OrderItemView {
  variantId: string;
  kind: "physical" | "digital";
  title: string;
  options: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  discountCents: number;
}

export interface OrderEventView {
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
  items: number;
}

export interface OrderView extends OrderSummary {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  couponCode: string | null;
  shipping: { service: string; daysMin: number; daysMax: number } | null;
  address: {
    recipient: string;
    cep: string;
    street: string;
    number: string;
    complement: string | null;
    district: string;
    city: string;
    uf: string;
  } | null;
  /** While waiting for payment: until when stock and coupon are held. */
  expiresAt: string | null;
  trackingCode: string | null;
  lines: OrderItemView[];
  events: OrderEventView[];
}
