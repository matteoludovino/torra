"use client";

import { couponInput, parseBRL, type CouponInput } from "@torra/shared";
import { useState, type FormEvent } from "react";
import { Card, Loading } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Select, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useAdminCoupons, useCouponChange } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { validate, type FieldErrors } from "@/lib/forms";

/** Coupons: what each one gives, how much it's been used, and on/off. */
export function CouponsScreen() {
  const { data: coupons, error } = useAdminCoupons();
  const change = useCouponChange();
  if (error)
    return (
      <Notice tone="error">
        {error instanceof ApiFailure ? error.message : "Não foi possível carregar."}
      </Notice>
    );
  return (
    <>
      <NewCoupon />
      <Card title="Cupons">
        {!coupons ? (
          <Loading />
        ) : (
          <ul className="grid divide-y divide-stone-100">
            {coupons.map((coupon) => (
              <li key={coupon.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className={`grid gap-0.5 ${coupon.active ? "" : "text-stone-400"}`}>
                  <p>
                    <code className="font-semibold">{coupon.code}</code> · {coupon.description}
                  </p>
                  <p className="text-xs text-stone-500">
                    {coupon.uses} {coupon.uses === 1 ? "uso" : "usos"}
                    {coupon.maxRedemptions ? ` de ${coupon.maxRedemptions}` : ""}
                    {coupon.oncePerCustomer ? " · um por cliente" : ""}
                    {coupon.endsAt ? ` · até ${shortDate(coupon.endsAt)}` : ""}
                    {!coupon.editable ? " · da loja (só leitura)" : ""}
                    {!coupon.active ? " · desativado" : ""}
                  </p>
                </div>
                {coupon.editable ? (
                  <Button
                    variant="secondary"
                    busy={
                      change.isPending &&
                      change.variables?.kind === "active" &&
                      change.variables.id === coupon.id
                    }
                    onClick={() => change.mutate({ kind: "active", id: coupon.id, active: !coupon.active })}
                  >
                    {coupon.active ? "Desativar" : "Ativar"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function NewCoupon() {
  const change = useCouponChange();
  const [form, setForm] = useState({
    code: "",
    kind: "percent",
    value: "",
    min: "",
    endsAt: "",
    max: "",
    once: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const set = (change: Partial<typeof form>) => setForm({ ...form, ...change });

  function submit(event: FormEvent) {
    event.preventDefault();
    const input: CouponInput = {
      code: form.code,
      kind: form.kind as "percent" | "fixed",
      value: form.kind === "percent" ? Number(form.value) || 0 : (parseBRL(form.value) ?? 0),
      minSubtotalCents: form.min ? (parseBRL(form.min) ?? -1) : 0,
      // The end of the chosen day, in Brasília.
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59-03:00`).toISOString() : null,
      maxRedemptions: form.max ? Number(form.max) || 0 : null,
      oncePerCustomer: form.once,
    };
    const { data, errors: problems } = validate(couponInput, input);
    setErrors(problems ?? {});
    setResult(null);
    if (!data) return;
    change.mutate(
      { kind: "create", input: data },
      {
        onSuccess: (coupon) => {
          setResult({ tone: "success", text: `Cupom ${coupon.code} criado.` });
          setForm({ code: "", kind: "percent", value: "", min: "", endsAt: "", max: "", once: false });
        },
        onError: (error) =>
          setResult({
            tone: "error",
            text: error instanceof ApiFailure ? error.message : "Não foi possível criar.",
          }),
      },
    );
  }

  return (
    <Card title="Novo cupom">
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Código"
            value={form.code}
            onChange={(e) => set({ code: e.target.value })}
            error={errors.code}
          />
          <Select label="Tipo" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="percent">Percentual</option>
            <option value="fixed">Valor fixo</option>
          </Select>
          <TextField
            label={form.kind === "percent" ? "Desconto (%)" : "Desconto (R$)"}
            inputMode="decimal"
            value={form.value}
            onChange={(e) => set({ value: e.target.value })}
            error={errors.value}
          />
          <TextField
            label="Compra mínima (R$, opcional)"
            inputMode="decimal"
            value={form.min}
            onChange={(e) => set({ min: e.target.value })}
            error={errors.minSubtotalCents}
          />
          <TextField
            label="Válido até (opcional)"
            type="date"
            value={form.endsAt}
            onChange={(e) => set({ endsAt: e.target.value })}
            error={errors.endsAt}
          />
          <TextField
            label="Limite de usos (opcional)"
            inputMode="numeric"
            value={form.max}
            onChange={(e) => set({ max: e.target.value })}
            error={errors.maxRedemptions}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.once}
            onChange={(e) => set({ once: e.target.checked })}
            className="accent-brand-700"
          />
          Um uso por cliente
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" busy={change.isPending}>
            Criar cupom
          </Button>
          {result ? (
            result.tone === "error" ? (
              <Notice tone="error">{result.text}</Notice>
            ) : (
              <p role="status" className="text-sm font-medium text-emerald-800">
                {result.text}
              </p>
            )
          ) : null}
        </div>
      </form>
    </Card>
  );
}
