import type { OrderEventView } from "@torra/shared";
import { dateTime } from "@/lib/format";

const EVENTS: Record<string, string> = {
  placed: "Pedido recebido",
  paid: "Pagamento confirmado",
  payment_processing: "Pagamento em processamento",
  payment_problem: "Pagamento em análise",
  late_payment_refunded: "Pagamento estornado (o pedido já estava encerrado)",
  preparing: "Em preparo",
  shipped: "Enviado",
  delivered: "Entregue",
  canceled: "Cancelado",
  expired: "Expirou sem pagamento",
};

/** Who or what closed an order; the customer reads "por você", the store "pelo cliente". */
const REASONS: Record<"customer" | "store", Record<string, string>> = {
  customer: { customer: "por você", replaced: "substituído por um pedido novo", admin: "pela loja" },
  store: { customer: "pelo cliente", replaced: "substituído por um pedido novo", admin: "pela loja" },
};

/** An order's history, oldest first. */
export function Timeline({
  events,
  reader = "customer",
}: {
  events: OrderEventView[];
  reader?: "customer" | "store";
}) {
  return (
    <section className="grid gap-2 rounded-2xl border border-stone-200 bg-white p-5 text-sm shadow-sm">
      <h2 className="mb-1 font-semibold">Histórico</h2>
      <ol className="grid gap-2 border-l border-stone-200 pl-4">
        {events.map((event, n) => {
          const reason =
            typeof event.data.reason === "string" ? REASONS[reader][event.data.reason] : undefined;
          const tracking = typeof event.data.trackingCode === "string" ? event.data.trackingCode : undefined;
          return (
            <li key={n} className="relative">
              <span
                aria-hidden
                className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-brand-600"
              />
              <p className="text-stone-900">
                {EVENTS[event.type] ?? event.type}
                {reason ? <span className="text-stone-600"> · {reason}</span> : null}
                {tracking ? <span className="text-stone-600"> · {tracking}</span> : null}
              </p>
              <p className="text-xs text-stone-500">{dateTime(event.at)}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
