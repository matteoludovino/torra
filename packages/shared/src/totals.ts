/** Stripe's smallest charge in BRL: a total between R$ 0,01 and R$ 0,49 can't be paid by card. */
export const MIN_CHARGE_CENTS = 50;

export type Discount = { kind: "percent"; percent: number } | { kind: "fixed"; amountCents: number };

export interface TotalsInput {
  lines: { key: string; unitPriceCents: number; quantity: number }[];
  discount: Discount | null;
  shippingCents: number;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  /** Each line's share of the discount: they add up to the discount, and none exceeds its line. */
  lines: { key: string; lineTotalCents: number; discountCents: number }[];
}

/**
 * An order's money, the one way it's computed: subtotal − discount + shipping. The discount applies to
 * products only (never shipping), never exceeds the subtotal, rounds down (the customer never pays a
 * fraction more than the rule says), and is shared out among the lines in proportion to their totals by
 * largest remainder, so refunding one line refunds exactly its share.
 */
export function computeTotals({ lines, discount, shippingCents }: TotalsInput): Totals {
  const lineTotals = lines.map((line) => ({
    key: line.key,
    lineTotalCents: line.unitPriceCents * line.quantity,
  }));
  const subtotalCents = lineTotals.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents =
    discount === null
      ? 0
      : discount.kind === "percent"
        ? Math.floor((subtotalCents * discount.percent) / 100)
        : Math.min(discount.amountCents, subtotalCents);
  const shares = allocate(
    discountCents,
    lineTotals.map((line) => line.lineTotalCents),
  );
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
    lines: lineTotals.map((line, i) => ({ ...line, discountCents: shares[i]! })),
  };
}

/**
 * Splits `amount` among `weights` proportionally, in whole cents: everyone gets the floor of their exact
 * share, and the cents left go to the largest remainders (ties: the earlier line). Shares sum to `amount`
 * and none exceeds its weight when `amount` ≤ the sum of weights.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0 || amount === 0) return weights.map(() => 0);
  // Exact integers: amount × weight can pass 2^53 on large orders, where floating point rounds.
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  const parts = weights.map((weight, index) => {
    const product = BigInt(amount) * BigInt(weight);
    return { index, share: product / BigInt(total), remainder: product % BigInt(total) };
  });
  let left = BigInt(amount) - parts.reduce((sum, part) => sum + part.share, ZERO);
  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const part of byRemainder) {
    if (left === ZERO) break;
    part.share += ONE;
    left -= ONE;
  }
  return parts.map((part) => Number(part.share));
}

/** Can this total be charged? 0 (nothing to pay) or at least Stripe's minimum. */
export function chargeable(totalCents: number): boolean {
  return totalCents === 0 || totalCents >= MIN_CHARGE_CENTS;
}
