import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FREE_SHIPPING_FROM_CENTS,
  allocate,
  cep,
  chargeable,
  computeTotals,
  couponCode,
  quoteShipping,
  type Discount,
} from "../src";

const line = fc.record({
  unitPriceCents: fc.integer({ min: 1, max: 5_000_000 }),
  quantity: fc.integer({ min: 1, max: 10 }),
});
const discount: fc.Arbitrary<Discount | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 1, max: 100 }).map((percent) => ({ kind: "percent" as const, percent })),
  fc.integer({ min: 1, max: 100_000_000 }).map((amountCents) => ({ kind: "fixed" as const, amountCents })),
);

describe("totals", () => {
  it("always add up: total = subtotal − discount + shipping, and the lines' shares are the discount", () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 12 }),
        discount,
        fc.integer({ min: 0, max: 50_000 }),
        (lines, d, shipping) => {
          const keyed = lines.map((l, i) => ({ ...l, key: `l${i}` }));
          const t = computeTotals({ lines: keyed, discount: d, shippingCents: shipping });
          expect(t.subtotalCents).toBe(keyed.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0));
          expect(t.discountCents).toBeGreaterThanOrEqual(0);
          expect(t.discountCents).toBeLessThanOrEqual(t.subtotalCents);
          expect(t.totalCents).toBe(t.subtotalCents - t.discountCents + shipping);
          expect(t.lines.reduce((s, l) => s + l.discountCents, 0)).toBe(t.discountCents);
          for (const l of t.lines) {
            expect(Number.isInteger(l.discountCents)).toBe(true);
            expect(l.discountCents).toBeGreaterThanOrEqual(0);
            expect(l.discountCents).toBeLessThanOrEqual(l.lineTotalCents);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("round a percentage down, cap a fixed discount at the subtotal, and never touch shipping", () => {
    const lines = [
      { key: "a", unitPriceCents: 4900, quantity: 1 },
      { key: "b", unitPriceCents: 999, quantity: 3 },
    ];
    // 10% of 7897 is 789.7: the customer gets 789.
    expect(
      computeTotals({ lines, discount: { kind: "percent", percent: 10 }, shippingCents: 1990 }),
    ).toMatchObject({
      subtotalCents: 7897,
      discountCents: 789,
      totalCents: 7897 - 789 + 1990,
    });
    expect(
      computeTotals({ lines, discount: { kind: "fixed", amountCents: 50_000 }, shippingCents: 1990 })
        .totalCents,
    ).toBe(1990);
    // The cent left over goes to the larger remainder: 4900/7897 of 789 = 489.56…, 2997/7897 = 299.44…
    expect(
      computeTotals({ lines, discount: { kind: "percent", percent: 10 }, shippingCents: 0 }).lines.map(
        (l) => l.discountCents,
      ),
    ).toEqual([490, 299]);
  });

  it("allocate exactly, even where floating point would round", () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    const big = allocate(99_999_999, [50_000_000 * 10, 49_999_999 * 10, 7]);
    expect(big.reduce((s, x) => s + x, 0)).toBe(99_999_999);
  });

  it("know what can be charged by card", () => {
    expect([0, 1, 49, 50, 51].map(chargeable)).toEqual([true, false, false, true, true]);
  });
});

describe("shipping", () => {
  it("prices by region and started kilo, with free economy shipping from R$ 300 in products", () => {
    const [eco, exp] = quoteShipping("SP", 1290, 10_000);
    expect(eco).toMatchObject({
      service: "economico",
      priceCents: 1990 + 600,
      free: false,
      daysMin: 4,
      daysMax: 6,
    });
    expect(exp).toMatchObject({ service: "expresso", priceCents: 3490 + 900 });
    expect(quoteShipping("AM", 290, 10_000)[0]!.priceCents).toBe(3490);
    const free = quoteShipping("BA", 3000, FREE_SHIPPING_FROM_CENTS);
    expect(free[0]).toMatchObject({ free: true, priceCents: 0, fullPriceCents: 2990 + 2 * 900 });
    expect(free[1]!.free).toBe(false);
  });

  it("reads a CEP and a coupon code the way people type them", () => {
    expect(cep.parse(" 01310-100 ")).toBe("01310100");
    expect(cep.safeParse("1310-100").success).toBe(false);
    expect(couponCode.parse(" bem vindo10 ")).toBe("BEMVINDO10");
    expect(couponCode.safeParse("x!").success).toBe(false);
  });
});
