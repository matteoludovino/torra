import { ORDER_STATUS_LABELS, type OrderStatus } from "@torra/shared";

const TONES: Record<OrderStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-900",
  paid: "bg-brand-100 text-brand-900",
  preparing: "bg-brand-100 text-brand-900",
  shipped: "bg-sky-100 text-sky-900",
  delivered: "bg-emerald-100 text-emerald-900",
  canceled: "bg-stone-200 text-stone-700",
  expired: "bg-stone-200 text-stone-700",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
