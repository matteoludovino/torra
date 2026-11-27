"use client";

import { ARTS, CATEGORIES, parseBRL, productInput, type ProductInput } from "@torra/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Select, TextArea, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useCatalogChange } from "@/lib/admin";
import { ApiFailure } from "@/lib/api";
import { validate, type FieldErrors } from "@/lib/forms";

const ART_LABELS: Record<(typeof ARTS)[number], string> = {
  bag: "Pacote de café",
  grinder: "Moedor",
  dripper: "Coador",
  kettle: "Chaleira",
  scale: "Balança",
  course: "Curso",
  ebook: "E-book",
};

interface VariantDraft {
  sku: string;
  options: string;
  price: string;
  weight: string;
  stock: string;
}
const emptyVariant = (): VariantDraft => ({ sku: "", options: "", price: "", weight: "", stock: "0" });
const list = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** A new product and its variants: in the shared catalog for the store, in the demo only for a demo. */
export function NewProductScreen() {
  const router = useRouter();
  const change = useCatalogChange();
  const [kind, setKind] = useState<"physical" | "digital">("physical");
  const [fields, setFields] = useState({
    category: "cafes",
    title: "",
    subtitle: "",
    description: "",
    art: "bag",
    optionNames: "",
  });
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const set = (name: keyof typeof fields, value: string) => setFields({ ...fields, [name]: value });
  const setVariant = (n: number, change: Partial<VariantDraft>) =>
    setVariants(variants.map((variant, i) => (i === n ? { ...variant, ...change } : variant)));

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const input: ProductInput = {
      kind,
      category: fields.category as ProductInput["category"],
      title: fields.title,
      subtitle: fields.subtitle,
      description: fields.description,
      art: fields.art as ProductInput["art"],
      optionNames: list(fields.optionNames),
      variants: variants.map((variant) => ({
        sku: variant.sku,
        optionValues: list(variant.options),
        priceCents: parseBRL(variant.price) ?? 0,
        weightGrams: kind === "physical" ? Number(variant.weight) || 0 : null,
        initialStock: kind === "physical" ? Number(variant.stock) || 0 : 0,
      })),
    };
    const { data, errors: problems } = validate(productInput, input);
    setErrors(problems ?? {});
    if (!data) {
      if (problems?.variants)
        setProblem("Confira as variantes: SKU, preço (mínimo R$ 0,50) e, se físico, o peso.");
      return;
    }
    change.mutate(
      { kind: "create", input: data },
      {
        onSuccess: (product) => router.push(`/admin/produtos#${product.id}`),
        onError: (error) =>
          setProblem(error instanceof ApiFailure ? error.message : "Não foi possível criar."),
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <Link href="/admin/produtos" className="text-sm text-stone-600 hover:underline">
        ← Produtos
      </Link>
      <Card title="Produto">
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 font-medium text-stone-800">Tipo</legend>
          {(["physical", "digital"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="kind"
                checked={kind === value}
                onChange={() => setKind(value)}
                className="accent-brand-700"
              />
              {value === "physical" ? "Físico (com estoque e frete)" : "Digital (download)"}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nome"
            value={fields.title}
            onChange={(e) => set("title", e.target.value)}
            error={errors.title}
          />
          <Select label="Categoria" value={fields.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.label}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-2">
            <TextField
              label="Resumo"
              value={fields.subtitle}
              onChange={(e) => set("subtitle", e.target.value)}
              error={errors.subtitle}
            />
          </div>
          <div className="sm:col-span-2">
            <TextArea
              label="Descrição"
              value={fields.description}
              onChange={(e) => set("description", e.target.value)}
              error={errors.description}
            />
          </div>
          <Select label="Ilustração" value={fields.art} onChange={(e) => set("art", e.target.value)}>
            {ARTS.map((art) => (
              <option key={art} value={art}>
                {ART_LABELS[art]}
              </option>
            ))}
          </Select>
          <TextField
            label="Opções (separadas por vírgula)"
            value={fields.optionNames}
            onChange={(e) => set("optionNames", e.target.value)}
            hint="Ex.: Peso, Moagem. Vazio para um produto sem variações."
            error={errors.optionNames}
          />
        </div>
      </Card>
      <Card
        title="Variantes"
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setVariants([...variants, emptyVariant()])}
          >
            Adicionar variante
          </Button>
        }
      >
        {variants.map((variant, n) => (
          <fieldset
            key={n}
            className="grid gap-3 border-t border-stone-100 pt-3 first-of-type:border-0 first-of-type:pt-0 sm:grid-cols-5"
          >
            <legend className="sr-only">Variante {n + 1}</legend>
            <TextField
              label="SKU"
              value={variant.sku}
              onChange={(e) => setVariant(n, { sku: e.target.value })}
            />
            <TextField
              label="Valores das opções"
              value={variant.options}
              onChange={(e) => setVariant(n, { options: e.target.value })}
              placeholder="250 g, Em grãos"
            />
            <TextField
              label="Preço"
              inputMode="decimal"
              value={variant.price}
              onChange={(e) => setVariant(n, { price: e.target.value })}
              placeholder="49,00"
            />
            {kind === "physical" ? (
              <>
                <TextField
                  label="Peso (g)"
                  inputMode="numeric"
                  value={variant.weight}
                  onChange={(e) => setVariant(n, { weight: e.target.value })}
                />
                <TextField
                  label="Estoque inicial"
                  inputMode="numeric"
                  value={variant.stock}
                  onChange={(e) => setVariant(n, { stock: e.target.value })}
                />
              </>
            ) : null}
          </fieldset>
        ))}
      </Card>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <div>
        <Button type="submit" busy={change.isPending}>
          Criar produto
        </Button>
      </div>
    </form>
  );
}
