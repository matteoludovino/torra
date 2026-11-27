"use client";

import {
  ORDER_ORIGIN_LABELS,
  SHIPPING_LABELS,
  formatBRL,
  shipOrderInput,
  type AdminOrderView,
  type ShippingService,
} from "@torra/shared";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Card, Loading } from "@/components/admin/admin-shell";
import { StatusBadge } from "@/components/orders/status-badge";
import { Timeline } from "@/components/orders/timeline";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useAdminOrder, useOrderAction } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { validate } from "@/lib/forms";

/** One order, as the store runs it: who, what, the payment as Stripe has it, and the next step. */
export function AdminOrderScreen({ id }: { id: string }) {
  const { data: order, error } = useAdminOrder(id);
  if (error) {
    return error instanceof ApiFailure && error.status === 404 ? (
      <Notice tone="info">
        Pedido não encontrado.{" "}
        <Link href="/admin/pedidos" className="font-medium underline">
          Ver os pedidos
        </Link>
      </Notice>
    ) : (
      <Notice tone="error">
        {error instanceof ApiFailure ? error.message : "Não foi possível carregar."}
      </Notice>
    );
  }
  if (!order) return <Loading />;
  return (
    <article className="grid gap-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href="/admin/pedidos" className="basis-full text-sm text-stone-600 hover:underline">
          ← Pedidos
        </Link>
        <h2 className="text-xl font-semibold">Pedido #{order.number}</h2>
        <StatusBadge status={order.status} />
        {order.origin === "demo" ? (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-900">
            {ORDER_ORIGIN_LABELS.demo}
          </span>
        ) : null}
        <p className="basis-full text-sm text-stone-600">
          {order.customer.name} · {order.customer.email} · feito em {dateTime(order.createdAt)}
        </p>
      </header>
      <NextStep order={order} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="grid gap-6">
          <Card title="Itens">
            <ul className="grid gap-2 text-sm">
              {order.lines.map((line) => (
                <li key={line.variantId} className="flex items-baseline justify-between gap-3">
                  <span>
                    {line.quantity} × {line.title}
                    {line.options ? <span className="text-stone-500"> · {line.options}</span> : null}
                    {line.kind === "digital" ? <span className="text-sky-800"> · digital</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatBRL(line.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="grid gap-1 border-t border-stone-200 pt-3 text-sm">
              <Row label="Subtotal" value={formatBRL(order.subtotalCents)} />
              {order.discountCents > 0 ? (
                <Row label={`Desconto (${order.couponCode})`} value={`− ${formatBRL(order.discountCents)}`} />
              ) : null}
              {order.shipping ? (
                <Row
                  label={`Frete (${SHIPPING_LABELS[order.shipping.service as ShippingService] ?? order.shipping.service})`}
                  value={order.shippingCents === 0 ? "Grátis" : formatBRL(order.shippingCents)}
                />
              ) : null}
              <Row label="Total" value={formatBRL(order.totalCents)} strong />
            </dl>
          </Card>
          <Payment order={order} />
        </div>
        <aside className="grid gap-6">
          {order.address ? (
            <Card title="Entrega">
              <div className="grid gap-0.5 text-sm">
                <p>{order.address.recipient}</p>
                <p className="text-stone-600">
                  {order.address.street}, {order.address.number}
                  {order.address.complement ? ` · ${order.address.complement}` : ""}
                </p>
                <p className="text-stone-600">
                  {order.address.district} · {order.address.city}/{order.address.uf} · {order.address.cep}
                </p>
                {order.trackingCode ? (
                  <p className="mt-2">
                    Rastreio: <code className="font-medium">{order.trackingCode}</code>
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}
          <Timeline events={order.events} reader="store" />
        </aside>
      </div>
    </article>
  );
}

/** What can be done with the order now, by its situation. */
function NextStep({ order }: { order: AdminOrderView }) {
  const action = useOrderAction(order.id);
  const [asking, setAsking] = useState(false);
  const [tracking, setTracking] = useState("");
  const [trackingError, setTrackingError] = useState<string>();
  const failure = action.error instanceof ApiFailure ? action.error.message : null;

  function ship(event: FormEvent) {
    event.preventDefault();
    const { data, errors } = validate(shipOrderInput, { trackingCode: tracking });
    setTrackingError(errors?.trackingCode);
    if (data) action.mutate({ kind: "ship", trackingCode: data.trackingCode });
  }

  let body: React.ReactNode = null;
  if (order.status === "pending_payment") {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">Aguardando o pagamento do cliente.</p>
        <Button variant="secondary" onClick={() => setAsking(true)}>
          Cancelar pedido
        </Button>
      </div>
    );
  } else if (!order.ships && order.paidAt && order.status === "paid") {
    body = <p className="text-sm">Pago, só com produtos digitais: os downloads já estão com o cliente.</p>;
  } else if (order.status === "paid") {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">Pago. Próximo passo: separar e embalar.</p>
        <Button busy={action.isPending} onClick={() => action.mutate({ kind: "prepare" })}>
          Começar a preparar
        </Button>
      </div>
    );
  } else if (order.status === "preparing") {
    body = (
      <form onSubmit={ship} noValidate className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <TextField
            label="Código de rastreio"
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
            error={trackingError}
            placeholder="QB123456789BR"
          />
        </div>
        <Button type="submit" busy={action.isPending}>
          Marcar como enviado
        </Button>
      </form>
    );
  } else if (order.status === "shipped") {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">Enviado em {order.shippedAt ? dateTime(order.shippedAt) : "—"}.</p>
        <Button busy={action.isPending} onClick={() => action.mutate({ kind: "deliver" })}>
          Marcar como entregue
        </Button>
      </div>
    );
  }
  if (!body) return null;
  return (
    <Card title="Próximo passo">
      {body}
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      <Dialog open={asking} onClose={() => setAsking(false)} title={`Cancelar o pedido #${order.number}?`}>
        <p className="text-sm text-stone-700">
          O pagamento em aberto é cancelado no Stripe, o estoque e o cupom voltam, e o cliente vê o pedido
          como cancelado pela loja.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setAsking(false)}>
            Manter
          </Button>
          <Button
            busy={action.isPending}
            onClick={() => action.mutate({ kind: "cancel" }, { onSettled: () => setAsking(false) })}
          >
            Cancelar pedido
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

/** The payment, as the last check with Stripe saw it. */
function Payment({ order }: { order: AdminOrderView }) {
  const action = useOrderAction(order.id);
  const { payment } = order;
  return (
    <Card
      title="Pagamento"
      actions={
        payment.paymentIntentId ? (
          <Button
            variant="secondary"
            busy={action.isPending && action.variables?.kind === "reconcile"}
            onClick={() => action.mutate({ kind: "reconcile" })}
          >
            Consultar o Stripe agora
          </Button>
        ) : null
      }
    >
      {payment.problem ? (
        <Notice tone="error">
          Não conferiu com o pedido: {payment.problem}. O pedido não foi dado como pago.
        </Notice>
      ) : null}
      <dl className="grid gap-1 text-sm">
        <Row
          label="PaymentIntent"
          value={payment.paymentIntentId ?? (order.totalCents === 0 ? "— (pedido grátis)" : "—")}
          mono
        />
        <Row label="Cobrança" value={payment.latestChargeId ?? "—"} mono />
        <Row label="Tentativa" value={String(payment.attempt + 1)} />
        <Row label="Pago" value={formatBRL(payment.amountPaidCents)} />
        <Row label="Reembolsado" value={formatBRL(payment.amountRefundedCents)} />
        <Row label="Consultado" value={payment.checkedAt ? dateTime(payment.checkedAt) : "—"} />
      </dl>
      {payment.dashboardUrl ? (
        <ButtonLink href={payment.dashboardUrl} variant="secondary" target="_blank" rel="noreferrer">
          Abrir no Stripe (modo de teste)
        </ButtonLink>
      ) : payment.paymentIntentId ? (
        <p className="text-xs text-stone-500">Gateway simulado: sem painel do Stripe.</p>
      ) : null}
    </Card>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-stone-600">{label}</dt>
      <dd className={`min-w-0 truncate ${strong ? "font-semibold" : ""} ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
