"use client";

import {
  REFUND_STATUS_LABELS,
  formatBRL,
  lineRefundCents,
  parseBRL,
  type AdminOrderView,
  type RefundInput,
} from "@torra/shared";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useOrderAction } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";

const PAID = new Set(["paid", "preparing", "shipped", "delivered"]);
const OPEN_DISPUTES = new Set([
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
]);
const ORIGINS = {
  panel: "pelo painel",
  cancellation: "cancelamento",
  stripe: "no painel do Stripe",
} as const;

/** Refunds of a paid order: those made, and a form for another (units, shipping, or an amount). */
export function RefundPanel({ order }: { order: AdminOrderView }) {
  const left = order.payment.amountPaidCents - order.refundedCents;
  const disputed = order.disputeStatus !== null && OPEN_DISPUTES.has(order.disputeStatus);
  const canRefund = PAID.has(order.status) && order.payment.amountPaidCents > 0 && left > 0 && !disputed;
  if (order.refunds.length === 0 && !canRefund) return null;
  return (
    <Card title="Reembolsos">
      {order.refunds.length > 0 ? (
        <ul className="grid gap-2 text-sm">
          {order.refunds.map((refund) => (
            <li key={refund.id} className="grid gap-0.5 rounded-lg bg-stone-50 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium tabular-nums">{formatBRL(refund.amountCents)}</span>
                <span
                  className={
                    refund.status === "failed"
                      ? "text-red-700"
                      : refund.status === "succeeded"
                        ? "text-emerald-800"
                        : "text-amber-800"
                  }
                >
                  {REFUND_STATUS_LABELS[refund.status]}
                </span>
              </div>
              <p className="text-xs text-stone-600">
                {dateTime(refund.createdAt)} · {ORIGINS[refund.origin]}
                {refund.reason ? ` · ${refund.reason}` : ""}
              </p>
              {refund.items.length > 0 || refund.shippingCents > 0 ? (
                <p className="text-xs text-stone-600">
                  {[
                    ...refund.items.map(
                      (item) =>
                        `${item.quantity} × ${item.title}${item.restock ? ` (${item.restock} de volta ao estoque)` : ""}`,
                    ),
                    ...(refund.shippingCents > 0 ? [`frete ${formatBRL(refund.shippingCents)}`] : []),
                  ].join(" · ")}
                </p>
              ) : null}
              {refund.failureReason ? <p className="text-xs text-red-700">{refund.failureReason}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {disputed ? (
        <p className="text-sm text-stone-600">
          Com a disputa aberta, o banco já reteve o valor: não há como reembolsar.
        </p>
      ) : canRefund ? (
        <RefundForm order={order} left={left} />
      ) : null}
    </Card>
  );
}

function RefundForm({ order, left }: { order: AdminOrderView; left: number }) {
  const action = useOrderAction(order.id);
  const [mode, setMode] = useState<"items" | "amount">("items");
  const [units, setUnits] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [shipping, setShipping] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const shippingLeft =
    order.shippingCents > 0 &&
    !order.refunds.some(
      (refund) => refund.shippingCents > 0 && refund.status !== "failed" && refund.status !== "canceled",
    );

  const preview =
    mode === "amount"
      ? (parseBRL(amount) ?? 0)
      : order.lines.reduce(
          (sum, line) =>
            sum +
            lineRefundCents(
              line.lineTotalCents - line.discountCents,
              line.quantity,
              line.refundedQuantity,
              units[line.id] ?? 0,
            ),
          0,
        ) + (shipping ? order.shippingCents : 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const input: RefundInput =
      mode === "amount"
        ? { amountCents: parseBRL(amount) ?? 0, reason }
        : {
            items: order.lines
              .filter((line) => (units[line.id] ?? 0) > 0)
              .map((line) => ({
                orderItemId: line.id,
                quantity: units[line.id]!,
                restock: Boolean(restock[line.id]),
              })),
            shipping,
            reason,
          };
    if (reason.trim().length < 3) return setProblem("Diga o motivo (aparece no histórico e no registro).");
    if (preview <= 0) return setProblem("Escolha o que devolver.");
    if (preview > left) return setProblem(`Só resta ${formatBRL(left)} para reembolsar.`);
    action.mutate(
      { kind: "refunds", input },
      {
        onSuccess: () => {
          setUnits({});
          setRestock({});
          setShipping(false);
          setAmount("");
          setReason("");
        },
        onError: (error) =>
          setProblem(error instanceof ApiFailure ? error.message : "Não foi possível reembolsar."),
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 border-t border-stone-100 pt-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="refund-mode"
            checked={mode === "items"}
            onChange={() => setMode("items")}
            className="accent-brand-700"
          />
          Itens e frete
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="refund-mode"
            checked={mode === "amount"}
            onChange={() => setMode("amount")}
            className="accent-brand-700"
          />
          Um valor
        </label>
      </div>
      {mode === "items" ? (
        <ul className="grid gap-2 text-sm">
          {order.lines.map((line) => {
            const remaining = line.quantity - line.refundedQuantity;
            return (
              <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex items-center gap-2">
                  <span className="sr-only">Unidades de {line.title} a reembolsar</span>
                  <select
                    name={`units-${line.id}`}
                    value={units[line.id] ?? 0}
                    disabled={remaining === 0}
                    onChange={(event) => setUnits({ ...units, [line.id]: Number(event.target.value) })}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  >
                    {Array.from({ length: remaining + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className={remaining === 0 ? "text-stone-400" : ""}>
                    {line.title}
                    {line.options ? ` · ${line.options}` : ""}
                    {line.refundedQuantity > 0 ? ` (${line.refundedQuantity} já reembolsado)` : ""}
                  </span>
                </label>
                {line.kind === "physical" && (units[line.id] ?? 0) > 0 ? (
                  <label className="flex items-center gap-1.5 text-xs text-stone-600">
                    <input
                      type="checkbox"
                      name={`restock-${line.id}`}
                      checked={Boolean(restock[line.id])}
                      onChange={(event) => setRestock({ ...restock, [line.id]: event.target.checked })}
                      className="accent-brand-700"
                    />
                    voltou ao estoque
                  </label>
                ) : null}
              </li>
            );
          })}
          {shippingLeft ? (
            <li>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="shipping"
                  checked={shipping}
                  onChange={(event) => setShipping(event.target.checked)}
                  className="accent-brand-700"
                />
                Frete ({formatBRL(order.shippingCents)})
              </label>
            </li>
          ) : null}
        </ul>
      ) : (
        <label className="grid gap-1 text-sm">
          Valor (até {formatBRL(left)})
          <input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="10,00"
            className="w-40 rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
      )}
      <label className="grid gap-1 text-sm">
        Motivo
        <input
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ex.: chegou danificado"
          className="rounded-lg border border-stone-300 px-3 py-2"
        />
      </label>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={action.isPending}>
          Reembolsar {formatBRL(Math.max(0, preview))}
        </Button>
        <span className="text-xs text-stone-500">
          Devolvido ao cartão pelo Stripe; o cliente recebe um e-mail.
        </span>
      </div>
    </form>
  );
}

/** A dispute opened by the customer's bank: what it means, and where to answer it. */
export function DisputeNotice({ order }: { order: AdminOrderView }) {
  if (!order.disputeStatus) return null;
  const open = OPEN_DISPUTES.has(order.disputeStatus);
  const labels: Record<string, string> = {
    warning_needs_response: "alerta: precisa de resposta",
    warning_under_review: "alerta: em análise",
    needs_response: "precisa de resposta",
    under_review: "em análise pelo banco",
    won: "ganha pela loja",
    lost: "perdida",
    warning_closed: "alerta encerrado",
  };
  return (
    <Notice tone={open ? "error" : "info"}>
      Disputa no banco do cliente: {labels[order.disputeStatus] ?? order.disputeStatus}.
      {open ? " O valor fica retido até o banco decidir; envie as evidências pelo painel do Stripe." : ""}
      {order.payment.dashboardUrl ? (
        <>
          {" "}
          <a
            href={order.payment.dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline"
          >
            Abrir no Stripe
          </a>
        </>
      ) : null}
    </Notice>
  );
}
