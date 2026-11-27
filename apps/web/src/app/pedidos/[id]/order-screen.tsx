"use client";

import { SHIPPING_LABELS, formatBRL, type OrderView, type ShippingService } from "@torra/shared";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PaymentPanel } from "@/components/orders/payment-panel";
import { StatusBadge } from "@/components/orders/status-badge";
import { Timeline } from "@/components/orders/timeline";
import { RequireSession } from "@/components/require-session";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { CART_KEY } from "@/lib/cart";
import { paymentProcessing, useCancelOrder, useOrder, useSyncPayment } from "@/lib/orders";

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
  const sync = useSyncPayment(id);
  const client = useQueryClient();
  // Paid (however the page learned it): its lines have left the cart.
  const paidAt = order?.paidAt;
  useEffect(() => {
    if (paidAt) void client.invalidateQueries({ queryKey: CART_KEY });
  }, [paidAt, client]);
  // Back from a payment that left the page (Stripe adds ?payment_intent=…): check now, tidy the address.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("payment_intent")) return;
    history.replaceState(null, "", location.pathname);
    sync.mutate();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      <Payment order={order} />
      {order.downloads.length > 0 ? (
        <section className="grid gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <h2 className="font-semibold text-sky-950">Seus downloads</h2>
          <ul className="grid gap-2">
            {order.downloads.map((download) => (
              <li key={download.variantId}>
                <a
                  href={download.url}
                  download
                  className="inline-flex items-center gap-2 text-sm font-medium text-sky-900 underline underline-offset-2"
                >
                  Baixar {download.title} (PDF)
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-sky-900/80">
            Os links valem por uma hora; abra esta página de novo quando quiser baixar outra vez.
          </p>
        </section>
      ) : null}
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
          {/* A payment processing can't be stopped: it settles, or fails, on its own. */}
          {paymentProcessing(order) ? null : (
            <div>
              <Button variant="secondary" onClick={() => setAsking(true)}>
                Cancelar pedido
              </Button>
            </div>
          )}
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
  if (order.paidAt && order.status !== "canceled") {
    return (
      <Notice tone="success">
        Pagamento confirmado em {dateTime(order.paidAt)}.
        {order.lines.some((line) => line.kind === "physical")
          ? " Agora preparamos o envio e avisamos por e-mail quando sair."
          : ""}
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

/** Paying, for an order waiting for it: the card form, or why there's none right now. */
function Payment({ order }: { order: OrderView }) {
  if (order.status !== "pending_payment" || !order.expiresAt) return null;
  if (order.paymentReview) {
    return (
      <Notice tone="info">
        Estamos conferindo seu pagamento com o Stripe. Nada mais precisa ser feito agora: avisamos por e-mail.
      </Notice>
    );
  }
  if (paymentProcessing(order)) {
    return (
      <Notice tone="info">
        Seu pagamento está em processamento. Assim que for confirmado, este pedido muda sozinho e avisamos por
        e-mail.
      </Notice>
    );
  }
  return (
    <section
      aria-label="Pagamento"
      className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <h2 className="font-semibold">Pagamento com cartão</h2>
      <PaymentPanel order={order} />
    </section>
  );
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

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-stone-600">{label}</dt>
      <dd className={tone === "good" ? "text-emerald-800" : "text-stone-900"}>{value}</dd>
    </div>
  );
}
