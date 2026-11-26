"use client";

import {
  SHIPPING_LABELS,
  formatBRL,
  type OrderEventView,
  type OrderView,
  type ShippingService,
} from "@torra/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/orders/status-badge";
import { RequireSession } from "@/components/require-session";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useCancelOrder, useOrder } from "@/lib/orders";

/** One of the customer's orders: where it stands, what was bought, for how much, and what happened. */
export function OrderScreen({ id }: { id: string }) {
  return (
    <RequireSession>
      {() => (
        <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
          <Link href="/conta" className="text-sm text-stone-600 hover:underline">
            ← Sua conta
          </Link>
          <Order id={id} />
        </main>
      )}
    </RequireSession>
  );
}

function Order({ id }: { id: string }) {
  const { data: order, error, refetch } = useOrder(id);
  if (error) {
    return error instanceof ApiFailure && error.status === 404 ? (
      <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-stone-300 p-10 text-center">
        <p className="text-stone-600">Pedido não encontrado.</p>
        <ButtonLink href="/conta">Ver seus pedidos</ButtonLink>
      </div>
    ) : (
      <Notice tone="error">
        {error instanceof ApiFailure ? error.message : "Não foi possível carregar o pedido."}
      </Notice>
    );
  }
  if (!order) return <div aria-busy className="h-96 animate-pulse rounded-2xl bg-stone-200/70" />;
  return (
    <article className="grid gap-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pedido #{order.number}</h1>
        <StatusBadge status={order.status} />
        <p className="basis-full text-sm text-stone-600">Feito em {dateTime(order.createdAt)}</p>
      </header>
      <Standing order={order} onExpired={() => void refetch()} />
      <div className="grid gap-6 md:grid-cols-[1fr_18rem] md:items-start">
        <section
          aria-label="Itens"
          className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
        >
          <ul className="grid gap-3">
            {order.lines.map((line) => (
              <li key={line.variantId} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-stone-900">{line.title}</p>
                  <p className="text-stone-600">
                    {[line.options, `${line.quantity} × ${formatBRL(line.unitPriceCents)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {line.kind === "digital" ? <p className="text-sky-800">Produto digital</p> : null}
                </div>
                <p className="shrink-0 font-medium">{formatBRL(line.lineTotalCents)}</p>
              </li>
            ))}
          </ul>
          <dl className="grid gap-1.5 border-t border-stone-200 pt-3 text-sm">
            <Row label="Subtotal" value={formatBRL(order.subtotalCents)} />
            {order.discountCents > 0 ? (
              <Row
                label={`Desconto (${order.couponCode})`}
                value={`− ${formatBRL(order.discountCents)}`}
                tone="good"
              />
            ) : null}
            {order.shipping ? (
              <Row
                label={`Frete (${SHIPPING_LABELS[order.shipping.service as ShippingService] ?? order.shipping.service})`}
                value={order.shippingCents === 0 ? "Grátis" : formatBRL(order.shippingCents)}
              />
            ) : null}
            <div className="mt-1 flex items-baseline justify-between border-t border-stone-200 pt-2">
              <dt className="font-medium">Total</dt>
              <dd className="text-lg font-semibold">{formatBRL(order.totalCents)}</dd>
            </div>
          </dl>
        </section>
        <aside className="grid gap-4">
          {order.address && order.shipping ? (
            <section className="grid gap-1 rounded-2xl border border-stone-200 bg-white p-5 text-sm shadow-sm">
              <h2 className="mb-1 font-semibold">Entrega</h2>
              <p>{order.address.recipient}</p>
              <p className="text-stone-600">
                {order.address.street}, {order.address.number}
                {order.address.complement ? ` · ${order.address.complement}` : ""}
              </p>
              <p className="text-stone-600">
                {order.address.district} · {order.address.city}/{order.address.uf} · {order.address.cep}
              </p>
              <p className="mt-2 text-stone-600">
                Chega em {order.shipping.daysMin} a {order.shipping.daysMax} dias úteis depois do envio.
              </p>
            </section>
          ) : null}
          <Timeline events={order.events} />
        </aside>
      </div>
    </article>
  );
}

/** Where the order stands, and what the customer can do about it now. */
function Standing({ order, onExpired }: { order: OrderView; onExpired: () => void }) {
  const [asking, setAsking] = useState(false);
  const cancel = useCancelOrder(order.id);
  if (order.status === "pending_payment" && order.expiresAt) {
    return (
      <Notice tone="info">
        <div className="grid gap-3">
          <p>
            Aguardando pagamento. Os itens ficam guardados para você por mais{" "}
            <Countdown until={order.expiresAt} onEnd={onExpired} />.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Pagar {formatBRL(order.totalCents)}</Button>
            <Button variant="secondary" onClick={() => setAsking(true)}>
              Cancelar pedido
            </Button>
          </div>
          <p className="text-xs">O pagamento com cartão chega numa próxima versão da loja.</p>
        </div>
        <Dialog open={asking} onClose={() => setAsking(false)} title={`Cancelar o pedido #${order.number}?`}>
          <p className="text-sm text-stone-700">
            Os itens voltam para o estoque e o cupom, se houver, fica livre de novo. Seu carrinho continua
            como está.
          </p>
          {cancel.error ? (
            <Notice tone="error">
              {cancel.error instanceof ApiFailure ? cancel.error.message : "Não foi possível cancelar."}
            </Notice>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Manter pedido
            </Button>
            <Button
              busy={cancel.isPending}
              onClick={() => cancel.mutate(undefined, { onSuccess: () => setAsking(false) })}
            >
              Cancelar pedido
            </Button>
          </div>
        </Dialog>
      </Notice>
    );
  }
  if (order.status === "expired") {
    return (
      <Notice tone="info">
        Este pedido expirou sem pagamento: os itens voltaram para o estoque e nada foi cobrado. Seu carrinho
        continua como estava.{" "}
        <Link href="/carrinho" className="font-medium underline underline-offset-2">
          Ir para o carrinho
        </Link>
      </Notice>
    );
  }
  if (order.status === "canceled") {
    const replaced = order.events.some(
      (event) => event.type === "canceled" && event.data.reason === "replaced",
    );
    return (
      <Notice tone="info">
        {replaced
          ? "Este pedido foi substituído por um mais recente, com outras escolhas de entrega ou cupom."
          : "Pedido cancelado: nada foi cobrado."}{" "}
        <Link href="/conta" className="font-medium underline underline-offset-2">
          Ver seus pedidos
        </Link>
      </Notice>
    );
  }
  return null;
}

/** "29:41", ticking; tells the page when it's over. */
function Countdown({ until, onEnd }: { until: string; onEnd: () => void }) {
  const end = new Date(until).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const ended = useRef(false);
  useEffect(() => {
    if (left > 0 || ended.current) return;
    ended.current = true;
    onEnd();
  }, [left, onEnd]);
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return (
    <strong className="font-semibold tabular-nums" aria-label={`${minutes} minutos e ${seconds} segundos`}>
      {minutes}:{seconds}
    </strong>
  );
}

const EVENTS: Record<string, string> = {
  placed: "Pedido recebido",
  canceled: "Cancelado",
  expired: "Expirou sem pagamento",
};
const REASONS: Record<string, string> = {
  customer: "por você",
  replaced: "substituído por um pedido novo",
};

function Timeline({ events }: { events: OrderEventView[] }) {
  return (
    <section className="grid gap-2 rounded-2xl border border-stone-200 bg-white p-5 text-sm shadow-sm">
      <h2 className="mb-1 font-semibold">Histórico</h2>
      <ol className="grid gap-2 border-l border-stone-200 pl-4">
        {events.map((event, n) => {
          const reason = typeof event.data.reason === "string" ? REASONS[event.data.reason] : undefined;
          return (
            <li key={n} className="relative">
              <span
                aria-hidden
                className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-brand-600"
              />
              <p className="text-stone-900">
                {EVENTS[event.type] ?? event.type}
                {reason ? <span className="text-stone-600"> · {reason}</span> : null}
              </p>
              <p className="text-xs text-stone-500">{dateTime(event.at)}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-stone-600">{label}</dt>
      <dd className={tone === "good" ? "text-emerald-800" : "text-stone-900"}>{value}</dd>
    </div>
  );
}
