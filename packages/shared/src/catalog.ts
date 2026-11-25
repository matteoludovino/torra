import { z } from "zod";

/** The store's shelves. */
export const CATEGORIES = [
  { slug: "cafes", label: "Cafés", description: "Torrados na semana, em grãos ou moídos para o seu método." },
  { slug: "utensilios", label: "Utensílios", description: "Moedores, coadores, chaleiras e balanças." },
  {
    slug: "cursos",
    label: "Cursos e e-books",
    description: "Do primeiro coado ao espresso, com acesso na hora.",
  },
] as const;
export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
export const CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug) as [
  CategorySlug,
  ...CategorySlug[],
];

export function categoryLabel(slug: string): string {
  return CATEGORIES.find((category) => category.slug === slug)?.label ?? slug;
}

export type ProductKind = "physical" | "digital";

/** The built-in illustrations a product can show (no uploads). */
export const ARTS = ["bag", "grinder", "dripper", "kettle", "scale", "course", "ebook"] as const;
export type Art = (typeof ARTS)[number];

/** A storefront card. */
export interface ProductSummary {
  slug: string;
  title: string;
  subtitle: string;
  kind: ProductKind;
  category: string;
  art: string;
  /** The cheapest active variant's price. */
  priceFromCents: number;
  /** More than one price among the variants: shown as "a partir de". */
  priceVaries: boolean;
  /** No variant can be bought right now (physical stock at zero). */
  soldOut: boolean;
}

export interface VariantView {
  id: string;
  sku: string;
  /** One value per option name, in order. */
  optionValues: string[];
  priceCents: number;
  compareAtCents: number | null;
  weightGrams: number | null;
  /** Units available in the viewer's corner of the store; null for digital (always available). */
  available: number | null;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  optionNames: string[];
  variants: VariantView[];
}

/** Low enough to say so ("Últimas 3 unidades"). */
export const LOW_STOCK = 5;

/** Query strings come from plain GET forms: an empty field means "no filter". */
const blank = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );

export const catalogFilters = z.object({
  categoria: blank(z.enum(CATEGORY_SLUGS)),
  busca: blank(z.string().trim().max(80)),
});
export type CatalogFilters = z.infer<typeof catalogFilters>;
