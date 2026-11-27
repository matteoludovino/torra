"use client";

import { ORDER_STATUSES, ORDER_STATUS_LABELS, formatBRL, type SalesFigure } from "@torra/shared";
import Link from "next/link";
import { Card, Loading } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ApiFailure } from "@/lib/api";
import { useDashboard, useRetryEvent } from "@/lib/admin";
import { dateTime, plural } from "@/lib/format";

/** The overview: sales, what needs doing, stock running out, and work that got stuck. */
export function DashboardScreen() {
  const { data, error } = useDashboard();
  const retry = useRetryEvent();
  if (error)
    return (
      <Notice tone="error">
        {error instanceof ApiFailure ? error.message : "Não foi possível carregar."}
      </Notice>
    );
  if (!data) return <Loading />;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Figure label="Vendas em 7 dias" sales={data.sales7} />
        <Figure label="Vendas em 30 dias" sales={data.sales30} />
        <Tile label="A enviar" value={String(data.toShip)} href="/admin/pedidos?status=paid" />
        <Tile
          label="Pagamentos em análise"
          value={String(data.inReview)}
          tone={data.inReview > 0 ? "warn" : undefined}
        />
        <Tile
          label="Disputas abertas"
          value={String(data.disputesOpen)}
          tone={data.disputesOpen > 0 ? "warn" : undefined}
        />
        <Tile
          label="Reembolsos que falharam"
          value={String(data.refundsFailed)}
          tone={data.refundsFailed > 0 ? "warn" : undefined}
        />
      </div>

      <Card title="Pedidos por situação">
        <ul className="flex flex-wrap gap-2">
          {ORDER_STATUSES.map((status) => (
            <li key={status}>
              <Link
                href={`/admin/pedidos?status=${status}`}
                className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100"
              >
                {ORDER_STATUS_LABELS[status]}
                <span className="font-semibold tabular-nums">{data.byStatus[status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Estoque baixo">
          {data.lowStock.length === 0 ? (
            <p className="text-sm text-stone-600">Nada acabando.</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {data.lowStock.slice(0, 8).map((line) => (
                <li key={line.variantId} className="flex items-baseline justify-between gap-3">
                  <Link href={`/admin/produtos#${line.productId}`} className="hover:underline">
                    {line.title}
                    {line.options ? <span className="text-stone-500"> · {line.options}</span> : null}
                  </Link>
                  <span
                    className={`shrink-0 font-medium tabular-nums ${line.available === 0 ? "text-red-700" : "text-amber-800"}`}
                  >
                    {line.available === 0 ? "Esgotado" : plural(line.available, "unidade", "unidades")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.lowStock.length > 8 ? (
            <Link href="/admin/produtos" className="text-sm text-stone-600 hover:underline">
              e mais {data.lowStock.length - 8} no catálogo
            </Link>
          ) : null}
        </Card>
        <Card title="Trabalho parado">
          {data.stuck.length === 0 ? (
            <p className="text-sm text-stone-600">Nenhum evento parado: webhooks e e-mails em dia.</p>
          ) : (
            <ul className="grid gap-3 text-sm">
              {data.stuck.map((event) => (
                <li key={event.id} className="grid gap-1 rounded-lg bg-red-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="text-red-900">{event.type}</code>
                    <Button
                      variant="secondary"
                      busy={retry.isPending && retry.variables === event.id}
                      onClick={() => retry.mutate(event.id)}
                    >
                      Tentar de novo
                    </Button>
                  </div>
                  <p className="text-red-900/80">
                    {plural(event.attempts, "tentativa", "tentativas")} · desistiu em{" "}
                    {dateTime(event.failedAt)}
                  </p>
                  {event.lastError ? (
                    <p className="font-mono text-xs break-all text-red-900/70">{event.lastError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Figure({ label, sales }: { label: string; sales: SalesFigure }) {
  return (
    <Tile
      label={label}
      value={formatBRL(sales.totalCents)}
      hint={plural(sales.orders, "pedido pago", "pedidos pagos")}
    />
  );
}

function Tile({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "warn";
}) {
  const body = (
    <>
      <p className="text-sm text-stone-600">{label}</p>
      <p
        className={`text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-800" : "text-stone-900"}`}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-stone-500">{hint}</p> : null}
    </>
  );
  const style = "grid gap-1 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm";
  return href ? (
    <Link href={href} className={`${style} hover:border-brand-300`}>
      {body}
    </Link>
  ) : (
    <div className={style}>{body}</div>
  );
}
