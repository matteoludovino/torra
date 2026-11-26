"use client";

import { formatBRL, type CartLine } from "@torra/shared";
import Link from "next/link";
import { ProductArt } from "@/components/catalog/product-art";
import { QuotePanel } from "@/components/checkout/quote-panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ApiFailure } from "@/lib/api";
import { useCart, useCartChange } from "@/lib/cart";
import { useMe } from "@/lib/session";

/** The cart: lines at today's prices, what needs attention, and the subtotal. */
export function CartScreen() {
  const { data: cart, error } = useCart();
  const { data: me } = useMe();
  const change = useCartChange();
  const failure = change.error instanceof ApiFailure ? change.error.message : null;

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Carrinho</h1>
      {error ? (
        <Notice tone="error">
          {error instanceof ApiFailure ? error.message : "Não foi possível carregar o carrinho."}
        </Notice>
      ) : !cart ? (
        <div aria-busy className="h-48 animate-pulse rounded-2xl bg-stone-200/70" />
      ) : cart.lines.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-stone-300 p-10 text-center">
          <p className="text-stone-600">Seu carrinho está vazio.</p>
          <ButtonLink href="/loja">Ver a loja</ButtonLink>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_18rem] md:items-start">
          <section aria-label="Itens" className="grid gap-3">
            {failure ? <Notice tone="error">{failure}</Notice> : null}
            {cart.lines.some((line) => line.issue === "price_changed") ? (
              <Notice tone="info">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>O preço de algum item mudou desde que você o adicionou.</span>
                  <Button
                    variant="secondary"
                    busy={change.isPending}
                    onClick={() => change.mutate({ kind: "acknowledge" })}
                  >
                    Aceitar os novos preços
                  </Button>
                </div>
              </Notice>
            ) : null}
            <ul className="grid gap-3">
              {cart.lines.map((line) => (
                <Line key={line.variantId} line={line} />
              ))}
            </ul>
          </section>
          <aside className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm md:sticky md:top-6">
            <QuotePanel cart={cart} />
            <Button disabled>Continuar para o pagamento</Button>
            <p className="text-xs text-stone-500">
              {cart.ready
                ? "O checkout chega numa próxima versão da loja."
                : "Resolva os avisos dos itens para continuar."}
              {!me ? " Para pagar, você vai entrar na sua conta; o carrinho vai junto." : ""}
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}

const ISSUES = {
  unavailable: "Indisponível: remova para continuar.",
  insufficient: "Estoque menor que a quantidade escolhida.",
  price_changed: "O preço mudou.",
} as const;

function Line({ line }: { line: CartLine }) {
  const change = useCartChange();
  const options = line.options.map((option) => option.value).join(" · ");
  const choices = Array.from({ length: Math.max(line.maxQuantity, line.quantity) }, (_, n) => n + 1);
  return (
    <li className="grid grid-cols-[5rem_1fr] gap-4 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm sm:grid-cols-[6rem_1fr]">
      <Link
        href={`/produto/${line.product.slug}`}
        className="overflow-hidden rounded-xl"
        tabIndex={-1}
        aria-hidden
      >
        <ProductArt art={line.product.art} slug={line.product.slug} />
      </Link>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="grid gap-0.5">
            <Link
              href={`/produto/${line.product.slug}`}
              className="font-medium text-stone-900 hover:text-brand-800"
            >
              {line.product.title}
            </Link>
            {options ? <p className="text-sm text-stone-600">{options}</p> : null}
            {line.product.kind === "digital" ? <p className="text-sm text-sky-800">Produto digital</p> : null}
          </div>
          <p className="sm:text-right">
            <span className="font-semibold">{formatBRL(line.lineTotalCents)}</span>
            {line.quantity > 1 ? (
              <span className="block text-xs text-stone-500">{formatBRL(line.unitPriceCents)} cada</span>
            ) : null}
          </p>
        </div>
        {line.issue ? (
          <p className="text-sm font-medium text-amber-800">
            {ISSUES[line.issue]}
            {line.issue === "insufficient" ? ` Disponível: ${line.available}.` : ""}
            {line.issue === "price_changed"
              ? ` Era ${formatBRL(line.seenPriceCents)}, agora ${formatBRL(line.unitPriceCents)}.`
              : ""}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {line.product.kind === "physical" && line.issue !== "unavailable" ? (
            <label className="flex items-center gap-2 text-sm text-stone-700">
              Qtd.
              <select
                value={line.quantity}
                disabled={change.isPending}
                onChange={(event) =>
                  change.mutate({
                    kind: "set",
                    variantId: line.variantId,
                    quantity: Number(event.target.value),
                  })
                }
                className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
              >
                {choices.map((n) => (
                  <option key={n} value={n} disabled={n > line.maxQuantity}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => change.mutate({ kind: "remove", variantId: line.variantId })}
            disabled={change.isPending}
            className="text-sm text-stone-600 underline-offset-2 hover:text-red-700 hover:underline"
          >
            Remover
          </button>
        </div>
      </div>
    </li>
  );
}
