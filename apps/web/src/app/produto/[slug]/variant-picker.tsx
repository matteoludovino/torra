"use client";

import { LOW_STOCK, MAX_PER_LINE, formatBRL, type ProductDetail, type VariantView } from "@torra/shared";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiFailure } from "@/lib/api";
import { useCartChange } from "@/lib/cart";

/**
 * Choosing a variant, one option at a time (weight, then grind…). A value that makes no existing variant
 * with the other choices is disabled; one whose variant is out of stock is marked, but can still be
 * picked to see it. Price and availability follow the chosen variant.
 */
export function VariantPicker({ product }: { product: ProductDetail }) {
  const initial = product.variants.find((v) => v.available !== 0) ?? product.variants[0]!;
  const [chosen, setChosen] = useState<string[]>(initial.optionValues);
  const variant = matching(product.variants, chosen) ?? initial;

  function choose(index: number, value: string) {
    const next = chosen.map((current, i) => (i === index ? value : current));
    // If that combination doesn't exist, keep the new value and take the first variant that has it.
    const found =
      matching(product.variants, next) ?? product.variants.find((v) => v.optionValues[index] === value);
    if (found) setChosen(found.optionValues);
  }

  return (
    <div className="grid gap-5">
      <Price variant={variant} />
      {product.optionNames.map((name, index) => (
        <OptionGroup
          key={name}
          name={name}
          values={unique(product.variants.map((v) => v.optionValues[index]!))}
          selected={chosen[index]!}
          state={(value) => {
            const candidate = matching(
              product.variants,
              chosen.map((current, i) => (i === index ? value : current)),
            );
            return !candidate ? "missing" : candidate.available === 0 ? "sold-out" : "ok";
          }}
          onChoose={(value) => choose(index, value)}
        />
      ))}
      <Availability variant={variant} digital={product.kind === "digital"} />
      <AddToCart key={variant.id} variant={variant} digital={product.kind === "digital"} />
    </div>
  );
}

function Price({ variant }: { variant: VariantView }) {
  return (
    <p className="flex items-baseline gap-3" aria-live="polite">
      <span className="text-3xl font-semibold text-stone-900">{formatBRL(variant.priceCents)}</span>
      {variant.compareAtCents ? (
        <s className="text-stone-500">
          <span className="sr-only">de </span>
          {formatBRL(variant.compareAtCents)}
        </s>
      ) : null}
    </p>
  );
}

function OptionGroup({
  name,
  values,
  selected,
  state,
  onChoose,
}: {
  name: string;
  values: string[];
  selected: string;
  state: (value: string) => "ok" | "sold-out" | "missing";
  onChoose: (value: string) => void;
}) {
  const group = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium text-stone-800">
        {name}: <span className="font-normal text-stone-600">{selected}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => {
          const status = state(value);
          return (
            <label
              key={value}
              className="cursor-pointer rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 has-checked:border-brand-700 has-checked:bg-brand-50 has-checked:font-medium has-disabled:cursor-not-allowed has-disabled:opacity-40 has-focus-visible:outline-2 has-focus-visible:outline-brand-600"
            >
              <input
                type="radio"
                name={group}
                value={value}
                checked={selected === value}
                disabled={status === "missing"}
                onChange={() => onChoose(value)}
                className="sr-only"
              />
              {value}
              {status === "sold-out" ? <span className="ml-1 text-xs text-stone-500">(esgotado)</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Availability({ variant, digital }: { variant: VariantView; digital: boolean }) {
  if (digital)
    return (
      <p className="text-sm font-medium text-sky-800">
        Produto digital: acesso liberado assim que o pagamento é aprovado.
      </p>
    );
  if (variant.available === 0)
    return <p className="text-sm font-medium text-stone-600">Esgotado nesta opção.</p>;
  if (variant.available !== null && variant.available <= LOW_STOCK)
    return (
      <p className="text-sm font-medium text-amber-800">
        {variant.available === 1 ? "Última unidade!" : `Últimas ${variant.available} unidades`}
      </p>
    );
  return <p className="text-sm font-medium text-emerald-800">Em estoque</p>;
}

function matching(variants: VariantView[], values: string[]): VariantView | undefined {
  return variants.find((v) => v.optionValues.every((value, i) => value === values[i]));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** How many, and into the cart. A digital product is one licence: no quantity to choose. */
function AddToCart({ variant, digital }: { variant: VariantView; digital: boolean }) {
  const change = useCartChange();
  const [quantity, setQuantity] = useState(1);
  const [done, setDone] = useState(false);
  const most = digital ? 1 : Math.min(MAX_PER_LINE, variant.available ?? 0);
  const quantityId = useId();
  if (most === 0) return null;

  async function add() {
    setDone(false);
    await change.mutateAsync({ kind: "add", variantId: variant.id, quantity }).catch(() => undefined);
    setDone(true);
  }

  const failure =
    change.error instanceof ApiFailure
      ? change.error.message
      : change.error
        ? "Não foi possível adicionar."
        : null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {digital ? null : (
          <label htmlFor={quantityId} className="grid gap-1.5 text-sm font-medium text-stone-800">
            Quantidade
            <select
              id={quantityId}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm shadow-xs focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none"
            >
              {Array.from({ length: most }, (_, n) => n + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button onClick={add} busy={change.isPending} className="px-6 py-2.5">
          Adicionar ao carrinho
        </Button>
      </div>
      <p role="status" className="text-sm">
        {done && !failure ? (
          <span className="font-medium text-emerald-800">
            Adicionado.{" "}
            <Link href="/carrinho" className="text-brand-700 underline-offset-2 hover:underline">
              Ver carrinho
            </Link>
          </span>
        ) : failure ? (
          <span className="text-red-700">{failure}</span>
        ) : null}
      </p>
    </div>
  );
}
