import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminCoupon } from "@torra/shared";
import type { couponInput } from "@torra/shared";
import type { z } from "zod";
import { describe } from "../checkout/coupons.service.ts";
import { uuidv7 } from "../common/ids.ts";
import { isUniqueViolation, transaction } from "../common/transactions.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { visibleTo } from "../sandbox/scope.ts";
import { Clock } from "../time/clock.ts";
import { Audit } from "./audit.ts";
import { ownedBy, type Admin } from "./scope.ts";

const NOT_FOUND = { code: "not_found", message: "Cupom não encontrado." };

/**
 * Coupons, as admins run them: the store's admins the shared ones, a demo's admin its own (which can't
 * take a shared coupon's code). Uses are counted in the admin's view: every corner for the store, the
 * demo's own for a demo.
 */
@Injectable()
export class AdminCoupons {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly audit: Audit,
  ) {}

  async list(admin: Admin): Promise<AdminCoupon[]> {
    const coupons = await this.db.coupon.findMany({
      where: visibleTo(admin),
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
    const uses = await this.db.couponRedemption.groupBy({
      by: ["couponId"],
      where: {
        couponId: { in: coupons.map((coupon) => coupon.id) },
        releasedAt: null,
        ...(admin.sandboxId ? { sandboxId: admin.sandboxId } : {}),
      },
      _count: { _all: true },
    });
    const counts = new Map(uses.map((row) => [row.couponId, row._count._all]));
    return coupons.map((coupon) => ({
      id: coupon.id,
      code: coupon.code,
      kind: coupon.kind,
      value: coupon.value,
      description: describe(coupon),
      minSubtotalCents: coupon.minSubtotalCents,
      startsAt: coupon.startsAt?.toISOString() ?? null,
      endsAt: coupon.endsAt?.toISOString() ?? null,
      maxRedemptions: coupon.maxRedemptions,
      oncePerCustomer: coupon.oncePerCustomer,
      active: coupon.active,
      uses: counts.get(coupon.id) ?? 0,
      editable: coupon.sandboxId === admin.sandboxId,
    }));
  }

  async create(admin: Admin, input: z.infer<typeof couponInput>): Promise<AdminCoupon> {
    const now = this.clock.now();
    const id = uuidv7(now.getTime());
    try {
      await transaction(this.db, async (tx) => {
        await tx.coupon.create({
          data: {
            id,
            sandboxId: admin.sandboxId,
            code: input.code,
            kind: input.kind,
            value: input.value,
            minSubtotalCents: input.minSubtotalCents,
            startsAt: input.startsAt ? new Date(input.startsAt) : null,
            endsAt: input.endsAt ? new Date(input.endsAt) : null,
            maxRedemptions: input.maxRedemptions,
            oncePerCustomer: input.oncePerCustomer,
            createdAt: now,
          },
        });
        await this.audit.record(
          tx,
          admin.user,
          "coupon.create",
          { type: "coupon", id },
          { code: input.code },
        );
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new ConflictException({ code: "code_taken", message: "Já existe um cupom com este código." });
    }
    return this.one(admin, id);
  }

  /** On or off (uses already held keep their discount). */
  async setActive(admin: Admin, id: string, active: boolean): Promise<AdminCoupon> {
    await transaction(this.db, async (tx) => {
      const coupon = await tx.coupon.findFirst({ where: { id, ...ownedBy(admin) } });
      if (!coupon) throw new NotFoundException(NOT_FOUND);
      await tx.coupon.update({ where: { id }, data: { active } });
      await this.audit.record(
        tx,
        admin.user,
        active ? "coupon.activate" : "coupon.deactivate",
        { type: "coupon", id },
        {
          code: coupon.code,
        },
      );
    });
    return this.one(admin, id);
  }

  private async one(admin: Admin, id: string): Promise<AdminCoupon> {
    const coupon = (await this.list(admin)).find((candidate) => candidate.id === id);
    if (!coupon) throw new NotFoundException(NOT_FOUND);
    return coupon;
  }
}
