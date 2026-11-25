import type { Art, CategorySlug, ProductKind } from "@torra/shared";

export interface SeedVariant {
  sku: string;
  optionValues: string[];
  priceCents: number;
  compareAtCents?: number;
  weightGrams?: number;
  /** Units in the shared catalog's stock (physical only). */
  stock?: number;
}

export interface SeedProduct {
  slug: string;
  kind: ProductKind;
  category: CategorySlug;
  title: string;
  subtitle: string;
  description: string;
  art: Art;
  optionNames: string[];
  variants: SeedVariant[];
}

const WEIGHTS = [
  { label: "250 g", grams: 250, code: "250" },
  { label: "500 g", grams: 500, code: "500" },
  { label: "1 kg", grams: 1000, code: "1K" },
];
const GRINDS = [
  { label: "Em grãos", code: "G" },
  { label: "Moído para filtro", code: "F" },
  { label: "Moído para espresso", code: "E" },
];

/** A coffee: every weight in every grind, priced by weight, with the same stock per variant. */
function coffee(
  code: string,
  base: Omit<SeedProduct, "kind" | "category" | "art" | "optionNames" | "variants">,
  prices: [number, number, number],
  stock: (weight: number, grind: number) => number,
  compareAt: Partial<Record<number, number>> = {},
): SeedProduct {
  return {
    ...base,
    kind: "physical",
    category: "cafes",
    art: "bag",
    optionNames: ["Peso", "Moagem"],
    variants: WEIGHTS.flatMap((weight, w) =>
      GRINDS.map((grind, g) => ({
        sku: `${code}-${weight.code}-${grind.code}`,
        optionValues: [weight.label, grind.label],
        priceCents: prices[w]!,
        ...(compareAt[w] ? { compareAtCents: compareAt[w] } : {}),
        // The bag, plus a little packaging.
        weightGrams: weight.grams + 40,
        stock: stock(w, g),
      })),
    ),
  };
}

/** The shared catalog: everyone sees it; stock is copied into a customer's sandbox when they first touch it. */
export const SEED_CATALOG: SeedProduct[] = [
  coffee(
    "MANT",
    {
      slug: "mantiqueira-bourbon-amarelo",
      title: "Mantiqueira de Minas · Bourbon Amarelo",
      subtitle: "Caramelo, laranja e chocolate ao leite. Torra média.",
      description:
        "Cultivado a 1.300 m na Serra da Mantiqueira e secado em terreiro suspenso. Doce e equilibrado, vai bem no coado e na prensa francesa. Pontuação 86 (SCA).",
    },
    [4900, 8900, 16500],
    () => 20,
  ),
  coffee(
    "CERR",
    {
      slug: "cerrado-mundo-novo",
      title: "Cerrado Mineiro · Mundo Novo",
      subtitle: "Castanhas, chocolate amargo e corpo encorpado. Torra média-escura.",
      description:
        "Um clássico do Cerrado, com Denominação de Origem. Corpo alto e baixa acidez: o café para quem gosta de espresso e de leite.",
    },
    [4200, 7600, 13900],
    () => 25,
  ),
  coffee(
    "CHAP",
    {
      slug: "chapada-catuai-vermelho",
      title: "Chapada Diamantina · Catuaí Vermelho",
      subtitle: "Frutas vermelhas, mel e acidez brilhante. Torra clara.",
      description:
        "Da região de Piatã, na Bahia, a mais de 1.200 m. Processo cereja descascado. Brilha no coado e no Aeropress; no espresso, pede uma moagem mais fina.",
    },
    [5600, 10200, 19500],
    () => 12,
  ),
  coffee(
    "CAPA",
    {
      slug: "caparao-natural-fermentado",
      title: "Caparaó · Natural fermentado (microlote)",
      subtitle: "Uva-passa, licor e cacau. Lote de 60 kg.",
      description:
        "Microlote de fermentação controlada de 72 horas, do produtor José Antônio, em Alto Caparaó. Edição limitada: quando acabar, só na próxima safra.",
    },
    [6900, 12900, 24500],
    // A limited lot: few bags, and the 1 kg already gone.
    (weight) => (weight === 2 ? 0 : 3),
  ),
  coffee(
    "CASA",
    {
      slug: "blend-da-casa",
      title: "Blend da Casa",
      subtitle: "Chocolate, rapadura e baixa acidez. Para o dia a dia.",
      description:
        "Nosso café de todo dia: Mundo Novo do Cerrado com Catuaí do Sul de Minas, em torra média. Rende bem em qualquer método.",
    },
    [3600, 6400, 11900],
    () => 40,
    { 2: 12900 },
  ),
  {
    slug: "moedor-manual-mos-de-aco",
    kind: "physical",
    category: "utensilios",
    title: "Moedor manual com mós de aço",
    subtitle: "40 ajustes de moagem, do espresso à prensa francesa.",
    description:
      "Mós cônicas de aço inox de 38 mm e eixo com dois rolamentos: moagem uniforme, sem aquecer o café. Cabe 25 g por vez.",
    art: "grinder",
    optionNames: [],
    variants: [{ sku: "MOED-38", optionValues: [], priceCents: 34900, weightGrams: 650, stock: 8 }],
  },
  {
    slug: "coador-conico-ceramica-02",
    kind: "physical",
    category: "utensilios",
    title: "Coador cônico de cerâmica 02",
    subtitle: "Para 1 a 4 xícaras, com papéis filtro 02.",
    description:
      "Cerâmica esmaltada que segura a temperatura e nervuras em espiral para o café escoar por igual. Acompanha 40 filtros de papel.",
    art: "dripper",
    optionNames: ["Cor"],
    variants: [
      { sku: "COAD-02-BR", optionValues: ["Branco"], priceCents: 12900, weightGrams: 420, stock: 12 },
      { sku: "COAD-02-PT", optionValues: ["Preto"], priceCents: 12900, weightGrams: 420, stock: 2 },
    ],
  },
  {
    slug: "chaleira-bico-de-ganso",
    kind: "physical",
    category: "utensilios",
    title: "Chaleira bico de ganso 1 L",
    subtitle: "Fluxo fino e constante para o coado.",
    description:
      "Aço inox com termômetro na tampa e cabo que não esquenta. Vai ao fogão a gás, elétrico e de indução.",
    art: "kettle",
    optionNames: [],
    variants: [{ sku: "CHAL-1L", optionValues: [], priceCents: 22900, weightGrams: 900, stock: 6 }],
  },
  {
    slug: "balanca-com-timer",
    kind: "physical",
    category: "utensilios",
    title: "Balança com timer 0,1 g",
    subtitle: "Peso e tempo na mesma tela, para repetir a receita.",
    description:
      "Precisão de 0,1 g até 2 kg, timer automático ao começar a despejar a água e bateria recarregável por USB-C.",
    art: "scale",
    optionNames: [],
    variants: [{ sku: "BAL-2K", optionValues: [], priceCents: 15900, weightGrams: 380, stock: 0 }],
  },
  {
    slug: "curso-cafe-coado-em-casa",
    kind: "digital",
    category: "cursos",
    title: "Curso Café Coado em Casa",
    subtitle: "8 aulas em vídeo: moagem, proporção, temperatura e tempo.",
    description:
      "Do primeiro coado ao café de cafeteria, sem equipamento caro. Inclui a planilha de receitas e acesso vitalício às aulas.",
    art: "course",
    optionNames: [],
    variants: [{ sku: "CURSO-COADO", optionValues: [], priceCents: 9700 }],
  },
  {
    slug: "ebook-receitas-de-cafe-gelado",
    kind: "digital",
    category: "cursos",
    title: "E-book 30 receitas de café gelado",
    subtitle: "Cold brew, tônica com espresso, affogato e mais.",
    description: "Um PDF de 64 páginas com fotos, medidas e o passo a passo de cada receita.",
    art: "ebook",
    optionNames: [],
    variants: [{ sku: "EBOOK-GELADO", optionValues: [], priceCents: 2900 }],
  },
  {
    slug: "curso-espresso-do-zero",
    kind: "digital",
    category: "cursos",
    title: "Curso Espresso do Zero",
    subtitle: "Do ajuste da moagem ao latte art, em 12 aulas.",
    description:
      "Para quem tem (ou vai ter) uma máquina de espresso em casa: extração, calibragem, vaporização do leite e os primeiros desenhos.",
    art: "course",
    optionNames: [],
    variants: [{ sku: "CURSO-ESPRESSO", optionValues: [], priceCents: 19700, compareAtCents: 24700 }],
  },
];
