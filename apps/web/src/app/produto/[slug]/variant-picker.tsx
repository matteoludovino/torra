"use client";

import { LOW_STOCK, formatBRL, type ProductDetail, type VariantView } from "@torra/shared";
import { useId, useState } from "react";

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
      <p className="text-sm text-stone-500">O carrinho chega na próxima versão da loja.</p>
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
