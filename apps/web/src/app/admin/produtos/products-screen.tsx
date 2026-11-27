"use client";

import {
  categoryLabel,
  formatBRL,
  parseBRL,
  stockAdjustment,
  type AdminProduct,
  type AdminVariant,
} from "@torra/shared";
import { useState, type FormEvent } from "react";
import { Loading } from "@/components/admin/admin-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useAdminProducts, useCatalogChange } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { validate, type FieldErrors } from "@/lib/forms";

/** The catalog with prices and stock in this admin's corner of the store. */
export function ProductsScreen() {
  const { data: products, error } = useAdminProducts();
  if (error)
    return (
      <Notice tone="error">
        {error instanceof ApiFailure ? error.message : "Não foi possível carregar."}
      </Notice>
    );
  if (!products) return <Loading />;
  return (
    <>
      <div className="flex justify-end">
        <ButtonLink href="/admin/produtos/novo">Novo produto</ButtonLink>
      </div>
      {products.map((product) => (
        <Product key={product.id} product={product} />
      ))}
    </>
  );
}

function Product({ product }: { product: AdminProduct }) {
  const change = useCatalogChange();
  const failure = change.error instanceof ApiFailure ? change.error.message : null;
  return (
    <section
      id={product.id}
      className="grid scroll-mt-6 gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="font-semibold">
            {product.title}
            {!product.active ? (
              <span className="ml-2 text-sm font-normal text-stone-500">(fora da loja)</span>
            ) : null}
          </h2>
          <p className="text-sm text-stone-600">
            {categoryLabel(product.category)} · {product.kind === "physical" ? "Físico" : "Digital"}
            {product.own ? " · desta demo" : ""}
            {!product.editable ? " · vitrine compartilhada (só o estoque desta demo muda aqui)" : ""}
          </p>
        </div>
        {product.editable ? (
          <Button
            variant="secondary"
            busy={change.isPending && change.variables?.kind === "product"}
            onClick={() =>
              change.mutate({ kind: "product", id: product.id, input: { active: !product.active } })
            }
          >
            {product.active ? "Tirar da loja" : "Voltar para a loja"}
          </Button>
        ) : null}
      </div>
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500">
              <th className="py-1 font-medium">SKU</th>
              <th className="py-1 font-medium">Opções</th>
              <th className="py-1 font-medium">Preço</th>
              <th className="py-1 font-medium">Estoque</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {product.variants.map((variant) => (
              <Variant key={variant.id} product={product} variant={variant} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Variant({ product, variant }: { product: AdminProduct; variant: AdminVariant }) {
  const change = useCatalogChange();
  const [price, setPrice] = useState(formatBRL(variant.priceCents));
  const [adjusting, setAdjusting] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  function savePrice(event: FormEvent) {
    event.preventDefault();
    const cents = parseBRL(price);
    if (cents === null || cents < 50) {
      setPriceError("Preço inválido (mínimo R$ 0,50).");
      return;
    }
    setPriceError(null);
    change.mutate(
      { kind: "variantUpdate", id: variant.id, input: { priceCents: cents } },
      {
        onError: (error) =>
          setPriceError(error instanceof ApiFailure ? error.message : "Não foi possível salvar."),
      },
    );
  }

  return (
    <tr className={variant.active ? "" : "text-stone-400"}>
      <td className="py-2 pr-3 font-mono text-xs">{variant.sku}</td>
      <td className="py-2 pr-3">{variant.optionValues.join(" · ") || "—"}</td>
      <td className="py-2 pr-3">
        {product.editable ? (
          <form onSubmit={savePrice} className="flex items-center gap-1.5">
            <label>
              <span className="sr-only">Preço de {variant.sku}</span>
              <input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                className="w-28 rounded-md border border-stone-300 px-2 py-1 text-sm tabular-nums"
              />
            </label>
            {parseBRL(price) !== variant.priceCents ? (
              <Button type="submit" variant="secondary" className="px-2 py-1" busy={change.isPending}>
                Salvar
              </Button>
            ) : null}
            {priceError ? <span className="text-xs text-red-700">{priceError}</span> : null}
          </form>
        ) : (
          <span className="tabular-nums">{formatBRL(variant.priceCents)}</span>
        )}
      </td>
      <td className="py-2 pr-3 tabular-nums">
        {variant.available === null ? (
          <span className="text-stone-500">digital</span>
        ) : (
          <span
            className={
              variant.available === 0 ? "text-red-700" : variant.available <= 5 ? "text-amber-800" : ""
            }
          >
            {variant.available}
          </span>
        )}
      </td>
      <td className="py-2 text-right whitespace-nowrap">
        {variant.available !== null ? (
          <Button variant="ghost" className="px-2 py-1" onClick={() => setAdjusting(true)}>
            Ajustar estoque
          </Button>
        ) : null}
        {product.editable ? (
          <Button
            variant="ghost"
            className="px-2 py-1"
            onClick={() =>
              change.mutate({ kind: "variantUpdate", id: variant.id, input: { active: !variant.active } })
            }
          >
            {variant.active ? "Desativar" : "Ativar"}
          </Button>
        ) : null}
        <StockDialog
          open={adjusting}
          onClose={() => setAdjusting(false)}
          product={product}
          variant={variant}
        />
      </td>
    </tr>
  );
}

/** A stock correction: units in or out, and why (the audit log keeps who). */
function StockDialog({
  open,
  onClose,
  product,
  variant,
}: {
  open: boolean;
  onClose: () => void;
  product: AdminProduct;
  variant: AdminVariant;
}) {
  const change = useCatalogChange();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const failure = change.error instanceof ApiFailure ? change.error.message : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const { data, errors: problems } = validate(stockAdjustment, { quantity: Number(quantity) || 0, reason });
    setErrors(problems ?? {});
    if (!data) return;
    change.mutate(
      { kind: "stock", id: variant.id, input: data },
      {
        onSuccess: () => {
          setQuantity("");
          setReason("");
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Estoque de ${product.title}`}>
      <form onSubmit={submit} noValidate className="grid gap-4 text-left">
        <p className="text-sm text-stone-600">
          {variant.sku}
          {variant.optionValues.length ? ` · ${variant.optionValues.join(" · ")}` : ""} · agora:{" "}
          {variant.available}
        </p>
        <TextField
          label="Unidades (positivo entra, negativo sai)"
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          error={errors.quantity}
          placeholder="Ex.: 10 ou -2"
        />
        <TextField
          label="Motivo"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={errors.reason}
          placeholder="Ex.: chegou um lote, quebrou no estoque"
        />
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button type="submit" busy={change.isPending}>
            Ajustar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
