import { Injectable, NotFoundException } from "@nestjs/common";
import {
  LOW_STOCK,
  ORDER_STATUSES,
  type AdminCustomer,
  type AdminDashboard,
  type OrderStatus,
  type SalesFigure,
} from "@torra/shared";
import { Stock } from "../catalog/stock.service.ts";
import { transaction } from "../common/transactions.ts";
import { OutboxService } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { visibleTo } from "../sandbox/scope.ts";
import { Clock } from "../time/clock.ts";
import { originOf } from "./admin-orders.service.ts";
import { Audit } from "./audit.ts";
import { ordersOf, type Admin } from "./scope.ts";

const PAID = ["paid", "preparing", "shipped", "delivered"] as const;
const DAY = 86_400_000;

/** The panel's overview, its customers, and the work that got stuck. */
@Injectable()
export class AdminInsights {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly stock: Stock,
    private readonly outbox: OutboxService,
    private readonly audit: Audit,
  ) {}

  async dashboard(admin: Admin): Promise<AdminDashboard> {
    const now = this.clock.now();
    const scope = ordersOf(admin);
    const sales = async (days: number): Promise<SalesFigure> => {
      const row = await this.db.order.aggregate({
        where: { ...scope, status: { in: [...PAID] }, paidAt: { gte: new Date(now.getTime() - days * DAY) } },
        _count: { _all: true },
        _sum: { amountPaidCents: true, amountRefundedCents: true },
      });
      return {
        orders: row._count._all,
        totalCents: (row._sum.amountPaidCents ?? 0) - (row._sum.amountRefundedCents ?? 0),
      };
    };
    const statuses = await this.db.order.groupBy({ by: ["status"], where: scope, _count: { _all: true } });
    const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<
      OrderStatus,
      number
    >;
    for (const row of statuses) byStatus[row.status] = row._count._all;

    const variants = await this.db.variant.findMany({
      where: { active: true, product: { kind: "physical", active: true }, ...visibleTo(admin) },
      include: { product: true },
    });
    const available = await this.stock.available(
      this.db,
      variants.map((variant) => variant.id),
      admin.sandboxId,
    );
    const lowStock = variants
      .map((variant) => ({ variant, left: available.get(variant.id) ?? 0 }))
      .filter(({ left }) => left <= LOW_STOCK)
      .sort((a, b) => a.left - b.left || a.variant.sku.localeCompare(b.variant.sku))
      .map(({ variant, left }) => ({
        variantId: variant.id,
        productId: variant.productId,
        title: variant.product.title,
        options: variant.optionValues.join(" · "),
        sku: variant.sku,
        available: left,
      }));

    const stuck = await this.db.outboxEvent.findMany({
      where: { failedAt: { not: null }, ...(admin.sandboxId ? { sandboxId: admin.sandboxId } : {}) },
      orderBy: { failedAt: "desc" },
      take: 20,
    });
    return {
      scope: admin.scope,
      sales7: await sales(7),
      sales30: await sales(30),
      byStatus,
      toShip: await this.db.order.count({
        where: { ...scope, status: { in: ["paid", "preparing"] }, cep: { not: null } },
      }),
      inReview: await this.db.order.count({ where: { ...scope, paymentProblem: { not: null } } }),
      lowStock,
      stuck: stuck.map((event) => ({
        id: String(event.id),
        type: event.type,
        attempts: event.attempts,
        lastError: event.lastError,
        failedAt: event.failedAt!.toISOString(),
      })),
    };
  }

  /** Tries a stuck event again, from the start (its handler is idempotent, like every outbox handler). */
  async retry(admin: Admin, id: string): Promise<void> {
    if (!/^\d{1,18}$/.test(id))
      throw new NotFoundException({ code: "not_found", message: "Evento não encontrado." });
    await transaction(this.db, async (tx) => {
      const { count } = await tx.outboxEvent.updateMany({
        where: {
          id: BigInt(id),
          failedAt: { not: null },
          ...(admin.sandboxId ? { sandboxId: admin.sandboxId } : {}),
        },
        data: { failedAt: null, attempts: 0, dueAt: this.clock.now(), lockedUntil: null },
      });
      if (count === 0) throw new NotFoundException({ code: "not_found", message: "Evento não encontrado." });
      await this.audit.record(tx, admin.user, "event.retry", { type: "event", id: null }, { eventId: id });
    });
    this.outbox.committed();
  }

  async customers(admin: Admin, q?: string): Promise<AdminCustomer[]> {
    const users = await this.db.user.findMany({
      where: {
        role: "customer",
        ...(admin.sandboxId ? { sandboxId: admin.sandboxId } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { sandbox: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const totals = await this.db.order.groupBy({
      by: ["userId"],
      where: { userId: { in: users.map((user) => user.id) } },
      _count: { _all: true },
    });
    const spent = await this.db.order.groupBy({
      by: ["userId"],
      where: { userId: { in: users.map((user) => user.id) }, status: { in: [...PAID] } },
      _sum: { amountPaidCents: true, amountRefundedCents: true },
    });
    const orders = new Map(totals.map((row) => [row.userId, row._count._all]));
    const money = new Map(
      spent.map((row) => [row.userId, (row._sum.amountPaidCents ?? 0) - (row._sum.amountRefundedCents ?? 0)]),
    );
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      origin: originOf(user.sandbox!),
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      orders: orders.get(user.id) ?? 0,
      spentCents: money.get(user.id) ?? 0,
    }));
  }

  recentAudit(admin: Admin) {
    return this.audit.recent(admin.user);
  }
}
