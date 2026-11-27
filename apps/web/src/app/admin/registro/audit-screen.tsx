"use client";

import type { AuditEntryView } from "@torra/shared";
import { Card, Loading } from "@/components/admin/admin-shell";
import { Notice } from "@/components/ui/notice";
import { useAuditLog } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";

const ACTIONS: Record<string, string> = {
  "order.prepare": "Começou a preparar o pedido",
  "order.ship": "Enviou o pedido",
  "order.deliver": "Marcou como entregue o pedido",
  "order.cancel": "Cancelou o pedido",
  "order.reconcile": "Consultou o Stripe sobre o pedido",
  "product.create": "Criou o produto",
  "product.update": "Alterou o produto",
  "variant.create": "Criou a variante",
  "variant.update": "Alterou a variante",
  "stock.adjust": "Ajustou o estoque de",
  "coupon.create": "Criou o cupom",
  "coupon.activate": "Ativou o cupom",
  "coupon.deactivate": "Desativou o cupom",
  "event.retry": "Tentou de novo o evento",
};

/** What the admins did, newest first; the database keeps it append-only. */
export function AuditScreen() {
  const { data: entries, error } = useAuditLog();
  if (error)
    return (
      <Notice tone="error">
        {error instanceof ApiFailure ? error.message : "Não foi possível carregar."}
      </Notice>
    );
  return (
    <Card title="Registro de ações">
      {!entries ? (
        <Loading />
      ) : entries.length === 0 ? (
        <p className="text-sm text-stone-600">Nenhuma ação ainda.</p>
      ) : (
        <ol className="grid divide-y divide-stone-100 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="grid gap-0.5 py-2.5">
              <p>
                <span className="font-medium">{entry.actor.name}</span> ·{" "}
                {ACTIONS[entry.action] ?? entry.action} {describe(entry)}
              </p>
              <p className="text-xs text-stone-500">{dateTime(entry.createdAt)}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function describe({ details }: AuditEntryView): string {
  const parts: string[] = [];
  if (typeof details.number === "number") parts.push(`#${details.number}`);
  for (const key of ["title", "sku", "code", "trackingCode", "eventId"] as const) {
    if (typeof details[key] === "string" || typeof details[key] === "number")
      parts.push(String(details[key]));
  }
  if (typeof details.quantity === "number")
    parts.push(`${details.quantity > 0 ? "+" : ""}${details.quantity}`);
  if (typeof details.reason === "string") parts.push(`(${details.reason})`);
  return parts.join(" ");
}
