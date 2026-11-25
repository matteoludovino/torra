import { z } from "zod";

/**
 * Money is always an integer number of centavos (BRL). Never a float: R$ 0,10 + R$ 0,20 must be exactly
 * R$ 0,30. The API stores bigint and sends numbers (safe far beyond any amount here).
 */
export const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 → "R$ 1.234,56" */
export function formatBRL(amountCents: number): string {
  return brl.format(amountCents / 100);
}

/**
 * What a person types ("1.234,56", "1234", "R$ 50") → centavos, or null if it isn't an amount. At most
 * two decimal places; a dot followed by exactly three digits is a thousands separator.
 */
export function parseBRL(input: string): number | null {
  const text = input.replace(/R\$|\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replace(/\./g, "").split(",");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
