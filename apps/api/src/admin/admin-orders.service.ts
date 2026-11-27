import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminOrderPage, AdminOrderSummary, AdminOrderView, OrderOrigin } from "@torra/shared";
import type { z } from "zod";
import type { adminOrdersQuery, refundInput } from "@torra/shared";
import { expectChanged, transaction } from "../common/transactions.ts";
import { uuidv7 } from "../common/ids.ts";
import { ENV, type Env } from "../env.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { Downloads } from "../orders/downloads.ts";
import { FULFILLMENT } from "../orders/order-emails.ts";
import { Orders } from "../orders/orders.service.ts";
import { orderInclude, summaryOf, viewOf } from "../orders/views.ts";
import { OutboxService } from "../outbox/outbox.service.ts";
import { Payments } from "../payments/payments.service.ts";
import { Refunds } from "../payments/refunds.service.ts";
import { PaymentGateway } from "../payments/gateway.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";
import { Audit } from "./audit.ts";
import { ordersOf, type Admin } from "./scope.ts";

const PAGE = 30;
const NOT_FOUND = { code: "not_found", message: "Pedido não encontrado." };
type Query = z.infer<typeof adminOrdersQuery>;

/**
 * Orders, as the admin panel runs them: find, look into (with what Stripe has), and move along the
 * fulfillment steps (paid → preparing → shipped with a tracking code → delivered). Each step is a
 * conditional update, so two admins clicking at once can't both move it; each is in the audit log.
 */
@Injectable()
export class AdminOrders {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly orders: Orders,
    private readonly payments: Payments,
    private readonly refunds: Refunds,
    private readonly gateway: PaymentGateway,
    private readonly downloads: Downloads,
    private readonly outbox: OutboxService,
    private readonly audit: Audit,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(admin: Admin, query: Query): Promise<AdminOrderPage> {
    const where: Prisma.OrderWhereInput = { ...ordersOf(admin) };
    if (query.status) where.status = query.status;
    if (query.q) {
      const number = /^#?\d+$/.test(query.q) ? Number(query.q.replace("#", "")) : null;
      where.OR = [
        ...(number !== null && Number.isSafeInteger(number) ? [{ number }] : []),
        { email: { contains: query.q, mode: "insensitive" } },
        { user: { name: { contains: query.q, mode: "insensitive" } } },
      ];
    }
    if (query.before) where.id = { lt: query.before };
    const rows = await this.db.order.findMany({
      where,
      include: { user: true, sandbox: true, _count: { select: { items: true } } },
      // uuidv7 ids sort by creation: the id is the page's cursor.
      orderBy: { id: "desc" },
      take: PAGE + 1,
    });
    const now = this.clock.now();
    const orders = rows.slice(0, PAGE).map((row): AdminOrderSummary => ({
      ...summaryOf(row, row._count.items, now),
      customer: { id: row.user.id, name: row.user.name, email: row.email },
      origin: originOf(row.sandbox),
      paymentReview: row.paymentProblem !== null,
      disputeStatus: row.disputeStatus,
      ships: row.cep !== null,
    }));
    return { orders, next: rows.length > PAGE ? orders.at(-1)!.id : null };
  }

  async view(admin: Admin, id: string): Promise<AdminOrderView> {
    const order = await this.db.order.findFirst({
      where: { id, ...ordersOf(admin) },
      include: { ...orderInclude, user: true, sandbox: true },
    });
    if (!order) throw new NotFoundException(NOT_FOUND);
    const now = this.clock.now();
    return {
      ...viewOf(order, now, (itemId) => this.downloads.link(itemId)),
      customer: { id: order.user.id, name: order.user.name, email: order.email },
      origin: originOf(order.sandbox),
      disputeStatus: order.disputeStatus,
      ships: order.cep !== null,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      payment: {
        paymentIntentId: order.paymentIntentId,
        latestChargeId: order.latestChargeId,
        attempt: order.paymentAttempt,
        amountPaidCents: order.amountPaidCents,
        amountRefundedCents: order.amountRefundedCents,
        checkedAt: order.paymentCheckedAt?.toISOString() ?? null,
        problem: order.paymentProblem,
        dashboardUrl:
          this.gateway.kind === "stripe" && order.paymentIntentId
            ? `https://dashboard.stripe.com/test/payments/${order.paymentIntentId}`
            : null,
      },
    };
  }

  /** Paid → preparing: someone is packing it. */
  async prepare(admin: Admin, id: string): Promise<AdminOrderView> {
    await this.step(admin, id, "paid", "preparing", {}, "order.prepare");
    return this.view(admin, id);
  }

  /** Preparing → shipped, with the carrier's tracking code: the customer is told. */
  async ship(admin: Admin, id: string, trackingCode: string): Promise<AdminOrderView> {
    const now = this.clock.now();
    await this.step(admin, id, "preparing", "shipped", { trackingCode, shippedAt: now }, "order.ship", {
      trackingCode,
    });
    return this.view(admin, id);
  }

  /** Shipped → delivered. */
  async deliver(admin: Admin, id: string): Promise<AdminOrderView> {
    await this.step(admin, id, "shipped", "delivered", { deliveredAt: this.clock.now() }, "order.deliver");
    return this.view(admin, id);
  }

  /** Closes an order still waiting for payment (paid orders are cancelled by refunding them). */
  /**
   * Cancels an order: one waiting for payment closes (its PaymentIntent let go of); one paid and not yet
   * shipped is refunded in full, its goods back to stock, and closes once Stripe has the refund.
   */
  async cancel(admin: Admin, id: string): Promise<AdminOrderView> {
    const order = await this.db.order.findFirst({ where: { id, ...ordersOf(admin) } });
    if (!order) throw new NotFoundException(NOT_FOUND);
    if (order.status === "pending_payment") {
      await this.orders.cancelByAdmin(admin.user, id, ordersOf(admin));
    } else if (order.status === "paid" || order.status === "preparing") {
      await this.refunds.cancelPaid(admin.user, id, ordersOf(admin));
    } else {
      throw new ConflictException({
        code: "not_cancelable",
        message:
          order.status === "shipped" || order.status === "delivered"
            ? "Pedido já enviado: reembolse os itens devolvidos em vez de cancelar."
            : "Este pedido já está encerrado.",
      });
    }
    return this.view(admin, id);
  }

  /** Gives money back: units of lines (optionally back to stock), the shipping, or an amount. */
  async refund(admin: Admin, id: string, input: z.infer<typeof refundInput>): Promise<AdminOrderView> {
    await this.refunds.request(admin.user, id, input, ordersOf(admin));
    return this.view(admin, id);
  }

  /** Asks Stripe now (the admin wants the current state, without waiting for the sweep). */
  async reconcile(admin: Admin, id: string): Promise<AdminOrderView> {
    const order = await this.db.order.findFirst({ where: { id, ...ordersOf(admin) } });
    if (!order) throw new NotFoundException(NOT_FOUND);
    await this.payments.reconcile(order.id);
    await this.refunds.reconcile(order.id);
    await transaction(this.db, (tx) =>
      this.audit.record(tx, admin.user, "order.reconcile", { type: "order", id }, { number: order.number }),
    );
    return this.view(admin, id);
  }

  private async step(
    admin: Admin,
    id: string,
    from: "paid" | "preparing" | "shipped",
    to: "preparing" | "shipped" | "delivered",
    data: Prisma.OrderUpdateManyMutationInput,
    action: string,
    details: Prisma.InputJsonObject = {},
  ): Promise<void> {
    const now = this.clock.now();
    const order = await this.db.order.findFirst({ where: { id, ...ordersOf(admin) } });
    if (!order) throw new NotFoundException(NOT_FOUND);
    if (order.cep === null) {
      throw new ConflictException({
        code: "nothing_to_ship",
        message: "Pedido só com produtos digitais: não há envio (os downloads são a entrega).",
      });
    }
    await transaction(this.db, async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, status: from, ...ordersOf(admin) },
        data: { status: to, ...data },
      });
      expectChanged(count, { code: "wrong_status", message: `Este pedido não está mais "${LABELS[from]}".` });
      await tx.orderEvent.create({
        data: {
          id: uuidv7(now.getTime()),
          orderId: id,
          type: to,
          actorId: admin.user.id,
          data: details,
          createdAt: now,
        },
      });
      await this.audit.record(
        tx,
        admin.user,
        action,
        { type: "order", id },
        { number: order.number, ...details },
      );
      if (to === "shipped" || to === "delivered") {
        await this.outbox.add(tx, FULFILLMENT[to], { orderId: id }, { sandboxId: order.sandboxId });
      }
    });
    this.outbox.committed();
  }
}

const LABELS = { paid: "pago", preparing: "em preparo", shipped: "enviado" } as const;

export function originOf(sandbox: { expiresAt: Date | null }): OrderOrigin {
  return sandbox.expiresAt === null ? "account" : "demo";
}
