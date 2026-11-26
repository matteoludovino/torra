import { Injectable } from "@nestjs/common";
import { formatBRL, type Discount } from "@torra/shared";
import type { Coupon } from "../generated/prisma/client.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { visibleTo } from "../sandbox/scope.ts";

/** Who is using a coupon: a signed-in customer (their sandbox and account), or a visitor pricing a cart. */
export interface CouponUser {
  userId: string | null;
  sandboxId: string | null;
}

export type CouponCheck =
  { ok: true; coupon: Coupon; discount: Discount; description: string } | { ok: false; problem: string };

/**
 * The rules of a coupon, the one place they're decided (the cart's quote now; placing an order, under the
 * coupon's row lock, in stage 5). Limits count live uses (not released) in the customer's own corner of
 * the store.
 */
@Injectable()
export class Coupons {
  async check(
    tx: Tx,
    code: string,
    user: CouponUser,
    subtotalCents: number,
    now: Date,
  ): Promise<CouponCheck> {
    const coupon = await tx.coupon.findFirst({
      where: { code, active: true, ...visibleTo({ sandboxId: user.sandboxId }) },
      orderBy: { sandboxId: { sort: "asc", nulls: "first" } },
    });
    if (!coupon) return { ok: false, problem: "Cupom não encontrado." };
    if (coupon.startsAt && coupon.startsAt > now)
      return { ok: false, problem: "Este cupom ainda não está valendo." };
    if (coupon.endsAt && coupon.endsAt <= now) return { ok: false, problem: "Este cupom expirou." };
    if (subtotalCents < coupon.minSubtotalCents) {
      return { ok: false, problem: `Válido em compras a partir de ${formatBRL(coupon.minSubtotalCents)}.` };
    }
    if (coupon.maxRedemptions !== null && user.sandboxId) {
      const used = await tx.couponRedemption.count({
        where: { couponId: coupon.id, sandboxId: user.sandboxId, releasedAt: null },
      });
      if (used >= coupon.maxRedemptions) return { ok: false, problem: "Este cupom esgotou." };
    }
    if (coupon.oncePerCustomer && user.userId) {
      const mine = await tx.couponRedemption.count({
        where: { couponId: coupon.id, userId: user.userId, releasedAt: null },
      });
      if (mine > 0) return { ok: false, problem: "Você já usou este cupom." };
    }
    const discount: Discount =
      coupon.kind === "percent"
        ? { kind: "percent", percent: coupon.value }
        : { kind: "fixed", amountCents: coupon.value };
    return { ok: true, coupon, discount, description: describe(coupon) };
  }
}

/** "10% de desconto", "R$ 20,00 de desconto em compras a partir de R$ 150,00". */
export function describe(
  coupon: Pick<Coupon, "kind" | "value" | "minSubtotalCents" | "oncePerCustomer">,
): string {
  const off =
    coupon.kind === "percent" ? `${coupon.value}% de desconto` : `${formatBRL(coupon.value)} de desconto`;
  const min =
    coupon.minSubtotalCents > 0 ? ` em compras a partir de ${formatBRL(coupon.minSubtotalCents)}` : "";
  return `${off}${min}`;
}
