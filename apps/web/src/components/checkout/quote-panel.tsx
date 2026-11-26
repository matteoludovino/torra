"use client";

import { UFS, formatBRL, formatCep, type CartView, type Quote } from "@torra/shared";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ApiFailure } from "@/lib/api";
import { useChoices, useQuote, type Choices } from "@/lib/checkout";

const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-xs focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none";

/** Shipping to a CEP, a coupon, and the totals the server computes for this cart. */
export function QuotePanel({ cart }: { cart: CartView }) {
  const [choices, setChoices] = useChoices();
  const { data: quote, error, isFetching } = useQuote(cart, choices);
  const set = (change: Partial<Choices>) => setChoices({ ...choices, ...change });

  return (
    <div className="grid gap-4" aria-busy={isFetching || undefined}>
      {quote?.digitalOnly ? (
        <p className="text-sm text-stone-600">Só produtos digitais: sem frete.</p>
      ) : (
        // Keyed by the CEP: the field shows the saved one once it loads from the session.
        <Shipping key={choices.cep ?? ""} quote={quote} choices={choices} onChange={set} />
      )}
      <Coupon quote={quote} code={choices.couponCode} onChange={(couponCode) => set({ couponCode })} />
      {error ? (
        <p className="text-sm text-red-700">
          {error instanceof ApiFailure ? error.message : "Não foi possível calcular."}
        </p>
      ) : null}
      <dl className="grid gap-1.5 border-t border-stone-200 pt-3 text-sm">
        <Row label="Subtotal" value={formatBRL(quote?.subtotalCents ?? cart.subtotalCents)} />
        {quote && quote.discountCents > 0 ? (
          <Row label="Desconto" value={`− ${formatBRL(quote.discountCents)}`} tone="good" />
        ) : null}
        {quote && !quote.digitalOnly ? (
          <Row
            label="Frete"
            value={
              quote.shippingService
                ? quote.shippingCents === 0
                  ? "Grátis"
                  : formatBRL(quote.shippingCents)
                : "—"
            }
          />
        ) : null}
        <div className="mt-1 flex items-baseline justify-between border-t border-stone-200 pt-2">
          <dt className="font-medium">Total</dt>
          <dd className="text-lg font-semibold" aria-live="polite">
            {formatBRL(quote?.totalCents ?? cart.subtotalCents)}
          </dd>
        </div>
      </dl>
      {quote?.belowMinimum ? (
        <p className="text-sm text-amber-800">
          O total ficou abaixo de R$ 0,50, o mínimo que dá para cobrar no cartão. Tire o cupom ou adicione
          algo.
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-stone-600">{label}</dt>
      <dd className={tone === "good" ? "text-emerald-800" : "text-stone-900"}>{value}</dd>
    </div>
  );
}

function Shipping({
  quote,
  choices,
  onChange,
}: {
  quote: Quote | undefined;
  choices: Choices;
  onChange: (change: Partial<Choices>) => void;
}) {
  const [cep, setCep] = useState(choices.cep ? formatCep(choices.cep) : "");
  function submit(event: FormEvent) {
    event.preventDefault();
    onChange({ cep: cep.replace(/\D/g, "") || undefined, uf: undefined });
  }
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium text-stone-800">Frete</legend>
      <form onSubmit={submit} className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">CEP</span>
          <input
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="CEP"
            maxLength={9}
            value={cep}
            onChange={(event) => setCep(event.target.value)}
            className={input}
          />
        </label>
        <Button type="submit" variant="secondary">
          Calcular
        </Button>
      </form>
      {quote?.address ? (
        <p className="text-xs text-stone-600">
          {[quote.address.street, quote.address.city].filter(Boolean).join(", ")}
          {quote.address.city ? "/" : ""}
          {quote.address.uf}
        </p>
      ) : null}
      {quote?.shippingProblem === "unknown_cep" ? (
        <p className="text-sm text-red-700">CEP não encontrado.</p>
      ) : null}
      {quote?.shippingProblem === "lookup_unavailable" ? (
        <label className="grid gap-1 text-sm text-stone-700">
          A busca de CEP não respondeu. Escolha o estado:
          <select
            value={choices.uf ?? ""}
            onChange={(event) => onChange({ uf: (event.target.value || undefined) as Choices["uf"] })}
            className={input}
          >
            <option value="">Estado</option>
            {UFS.map((uf) => (
              <option key={uf}>{uf}</option>
            ))}
          </select>
        </label>
      ) : null}
      {quote && quote.shippingOptions.length > 0 ? (
        <div className="grid gap-1.5">
          {quote.shippingOptions.map((option) => (
            <label
              key={option.service}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm has-checked:border-brand-600 has-checked:bg-brand-50"
            >
              <input
                type="radio"
                name="shipping"
                checked={quote.shippingService === option.service}
                onChange={() => onChange({ shippingService: option.service })}
                className="accent-brand-700"
              />
              <span className="flex-1">
                {option.label}
                <span className="block text-xs text-stone-500">
                  {option.daysMin} a {option.daysMax} dias úteis
                </span>
              </span>
              <span className="font-medium">
                {option.free ? (
                  <>
                    <s className="mr-1 text-xs font-normal text-stone-400">
                      {formatBRL(option.fullPriceCents)}
                    </s>
                    Grátis
                  </>
                ) : (
                  formatBRL(option.priceCents)
                )}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

function Coupon({
  quote,
  code,
  onChange,
}: {
  quote: Quote | undefined;
  code: string | undefined;
  onChange: (code: string | undefined) => void;
}) {
  const [typed, setTyped] = useState("");
  if (quote?.coupon) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <span>
          <strong className="font-semibold">{quote.coupon.code}</strong> · {quote.coupon.description}
        </span>
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-emerald-800 underline-offset-2 hover:underline"
        >
          Remover
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (typed.trim()) onChange(typed.trim());
      }}
      className="grid gap-1.5"
    >
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Cupom de desconto</span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Cupom de desconto"
            autoCapitalize="characters"
            className={input}
          />
        </label>
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </div>
      {code && quote?.couponProblem ? <p className="text-sm text-red-700">{quote.couponProblem}</p> : null}
      {!code ? <p className="text-xs text-stone-500">Primeira compra? Use BEMVINDO10.</p> : null}
    </form>
  );
}
