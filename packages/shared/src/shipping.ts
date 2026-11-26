import { z } from "zod";

/** A CEP: 8 digits, typed with or without the hyphen. */
export const cep = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{8}$/, "CEP com 8 dígitos"));

export function formatCep(digits: string): string {
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
export type Uf = (typeof UFS)[number];

type Region = "SE" | "S" | "CO" | "NE" | "N";
const REGION: Record<Uf, Region> = {
  SP: "SE",
  RJ: "SE",
  MG: "SE",
  ES: "SE",
  PR: "S",
  SC: "S",
  RS: "S",
  DF: "CO",
  GO: "CO",
  MT: "CO",
  MS: "CO",
  BA: "NE",
  SE: "NE",
  AL: "NE",
  PE: "NE",
  PB: "NE",
  RN: "NE",
  CE: "NE",
  PI: "NE",
  MA: "NE",
  PA: "N",
  AM: "N",
  AP: "N",
  RR: "N",
  RO: "N",
  AC: "N",
  TO: "N",
};

export const SHIPPING_SERVICES = ["economico", "expresso"] as const;
export type ShippingService = (typeof SHIPPING_SERVICES)[number];
export const SHIPPING_LABELS: Record<ShippingService, string> = {
  economico: "Econômico",
  expresso: "Expresso",
};

/**
 * From the roastery in São Paulo: a price for the first kilo, one per extra kilo (or part of one), and the
 * delivery time in business days, by region of the destination.
 */
const TABLE: Record<
  Region,
  Record<ShippingService, { firstKg: number; extraKg: number; days: [number, number] }>
> = {
  SE: {
    economico: { firstKg: 1990, extraKg: 600, days: [4, 6] },
    expresso: { firstKg: 3490, extraKg: 900, days: [1, 2] },
  },
  S: {
    economico: { firstKg: 2490, extraKg: 700, days: [5, 8] },
    expresso: { firstKg: 4290, extraKg: 1100, days: [2, 3] },
  },
  CO: {
    economico: { firstKg: 2690, extraKg: 800, days: [6, 9] },
    expresso: { firstKg: 4590, extraKg: 1200, days: [2, 4] },
  },
  NE: {
    economico: { firstKg: 2990, extraKg: 900, days: [7, 12] },
    expresso: { firstKg: 5290, extraKg: 1400, days: [3, 5] },
  },
  N: {
    economico: { firstKg: 3490, extraKg: 1100, days: [9, 15] },
    expresso: { firstKg: 6290, extraKg: 1700, days: [4, 7] },
  },
};

/** Economy shipping is free from this much in products (after the discount). */
export const FREE_SHIPPING_FROM_CENTS = 30_000;

export interface ShippingOption {
  service: ShippingService;
  label: string;
  priceCents: number;
  /** The table's price, before free shipping. */
  fullPriceCents: number;
  free: boolean;
  daysMin: number;
  daysMax: number;
}

/** The options for a parcel of `weightGrams` to `uf`, given what the products cost after the discount. */
export function quoteShipping(uf: Uf, weightGrams: number, productsCents: number): ShippingOption[] {
  const kilos = Math.max(1, Math.ceil(weightGrams / 1000));
  return SHIPPING_SERVICES.map((service) => {
    const rate = TABLE[REGION[uf]][service];
    const fullPriceCents = rate.firstKg + (kilos - 1) * rate.extraKg;
    const free = service === "economico" && productsCents >= FREE_SHIPPING_FROM_CENTS;
    return {
      service,
      label: SHIPPING_LABELS[service],
      priceCents: free ? 0 : fullPriceCents,
      fullPriceCents,
      free,
      daysMin: rate.days[0],
      daysMax: rate.days[1],
    };
  });
}
