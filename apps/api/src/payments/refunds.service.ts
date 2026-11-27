import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { formatBRL, lineRefundCents, type refundInput } from "@torra/shared";
import type { z } from "zod";
import { Audit } from "../admin/audit.ts";
import type { AuthUser } from "../auth/auth-user.ts";
import { Stock } from "../catalog/stock.service.ts";
import { uuidv7 } from "../common/ids.ts";
import { isUniqueViolation, transaction } from "../common/transactions.ts";
import { ENV, type Env } from "../env.ts";
import type { Order, Prisma, RefundOrigin } from "../generated/prisma/client.ts";
import { OutboxService, type Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Scheduler } from "../scheduler/scheduler.service.ts";
import { Clock } from "../time/clock.ts";
import { GatewayRefused, PaymentGateway, type Refund as GatewayRefund } from "./gateway.ts";

type RefundInput = z.infer<typeof refundInput>;

export const REFUND_EVENTS = { succeeded: "refund.succeeded" } as const;

/** How long before a refund still pending is checked with Stripe again (or sent again, if it never got there). */
export const REFUND_RECHECK_MS = 2 * 60_000;
/** Older than this, a retry first asks Stripe whether the refund exists (its idempotency key may have expired). */
const LOOK_FIRST_AFTER_MS = 60_000;

const PAID = new Set(["paid", "preparing", "shipped", "delivered"]);
const COUNTED = ["pending", "requires_action", "succeeded"] as const;
const OPEN_DISPUTES = new Set([
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
]);
const NOT_FOUND = { code: "not_found", message: "Pedido não encontrado." };

/**
 * Refunds. The local row comes first (its id is Stripe's idempotency key and goes in the refund's
 * metadata), then Stripe is asked, outside any transaction; its answer, an event or a sweep settle the
 * row. A retry whose key may have expired looks the refund up by our id first, so a lost answer never
 * refunds twice. Stripe's list of refunds is the truth: refunds made in its Dashboard become rows here,
 * and refunds that fail later stop counting. The database caps what's refunded at what was paid.
 */
@Injectable()
export class Refunds implements OnModuleInit {
  private readonly logger = new Logger("Refunds");

  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly gateway: PaymentGateway,
    private readonly outbox: OutboxService,
    private readonly scheduler: Scheduler,
    private readonly stock: Stock,
    private readonly audit: Audit,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "refund-check",
      run: (now) => this.recheck(now),
      nextDueAt: async () => {
        const row = await this.db.refund.findFirst({
          where: { status: { in: ["pending", "requires_action"] } },
          orderBy: { updatedAt: "asc" },
          select: { updatedAt: true },
        });
        return row ? new Date(row.updatedAt.getTime() + REFUND_RECHECK_MS) : null;
      },
    });
  }

  /**
   * An admin's refund: units of lines (back to stock if asked), the shipping, or an amount on its own.
   * `scope` limits the orders the admin may touch. Returns the refund's id.
   */
  async request(
    admin: AuthUser,
    orderId: string,
    input: RefundInput,
    scope: Prisma.OrderWhereInput,
    origin: RefundOrigin = "panel",
  ): Promise<string> {
    const now = this.clock.now();
    const refundId = uuidv7(now.getTime());
    await transaction(this.db, async (tx) => {
      const order = await this.locked(tx, orderId, scope);
      if (!PAID.has(order.status) || order.amountPaidCents === 0 || !order.paymentIntentId) {
        throw new ConflictException({
          code: "not_refundable",
          message: "Só pedidos pagos com cartão têm o que reembolsar.",
        });
      }
      if (order.disputeStatus && OPEN_DISPUTES.has(order.disputeStatus)) {
        throw new ConflictException({
          code: "disputed",
          message: "Pedido em disputa: o banco já reteve o valor. Responda à disputa no Stripe.",
        });
      }
      const lines = await this.linesOf(tx, order, input);
      let shippingCents = 0;
      if (input.shipping) {
        const already = await tx.refund.aggregate({
          where: { orderId, status: { in: [...COUNTED] } },
          _sum: { shippingCents: true },
        });
        if (order.shippingCents === 0 || (already._sum.shippingCents ?? 0) > 0) {
          throw new ConflictException({
            code: "shipping_refunded",
            message: "Não há frete a devolver neste pedido.",
          });
        }
        shippingCents = order.shippingCents;
      }
      const amountCents =
        input.amountCents ?? lines.reduce((sum, line) => sum + line.amountCents, 0) + shippingCents;
      const left = order.amountPaidCents - order.amountRefundedCents;
      if (amountCents <= 0) {
        throw new ConflictException({
          code: "nothing_to_refund",
          message: "Esses itens não têm valor a devolver.",
        });
      }
      if (amountCents > left) {
        throw new ConflictException({
          code: "over_refund",
          message: `Só resta ${formatBRL(left)} para reembolsar neste pedido.`,
        });
      }
      await tx.refund.create({
        data: {
          id: refundId,
          orderId,
          amountCents,
          shippingCents,
          status: "pending",
          origin,
          reason: input.reason,
          actorId: admin.id,
          createdAt: now,
          // By the application's clock (the sweeps compare with it), not the database's.
          updatedAt: now,
          items: {
            create: lines.map((line) => ({
              id: uuidv7(now.getTime()),
              orderItemId: line.orderItemId,
              quantity: line.quantity,
              amountCents: line.amountCents,
              restock: line.restock,
            })),
          },
        },
      });
      await tx.orderEvent.create({
        data: {
          id: uuidv7(now.getTime()),
          orderId,
          type: "refund_requested",
          actorId: admin.id,
          data: { refundId, amountCents },
          createdAt: now,
        },
      });
      await this.audit.record(
        tx,
        admin,
        origin === "cancellation" ? "order.cancel_paid" : "order.refund",
        {
          type: "order",
          id: orderId,
        },
        { number: order.number, amountCents, reason: input.reason },
      );
    });
    await this.submit(refundId);
    return refundId;
  }

  /**
   * Cancels a paid order that hasn't shipped: everything that's left goes back (money, and goods to
   * stock), and the order closes once Stripe has accepted the refund.
   */
  async cancelPaid(admin: AuthUser, orderId: string, scope: Prisma.OrderWhereInput): Promise<void> {
    const order = await this.db.order.findFirst({
      where: { id: orderId, ...scope },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(NOT_FOUND);
    if (order.status !== "paid" && order.status !== "preparing") {
      throw new ConflictException({
        code: "already_shipped",
        message: "Pedido já enviado: reembolse os itens devolvidos em vez de cancelar.",
      });
    }
    const refunded = await this.refundedUnits(this.db, orderId);
    const items = order.items
      .map((item) => ({ item, left: item.quantity - (refunded.get(item.id) ?? 0) }))
      .filter(({ left }) => left > 0)
      .map(({ item, left }) => ({
        orderItemId: item.id,
        quantity: left,
        restock: item.kind === "physical",
      }));
    const shippingRefunded = await this.db.refund.aggregate({
      where: { orderId, status: { in: [...COUNTED] } },
      _sum: { shippingCents: true },
    });
    const shipping = order.shippingCents > 0 && (shippingRefunded._sum.shippingCents ?? 0) === 0;
    if (items.length === 0 && !shipping) {
      // Everything was refunded already: only the order is left to close.
      await this.close(order.id, admin.id);
      return;
    }
    await this.request(
      admin,
      orderId,
      { items, shipping, reason: "Pedido cancelado pela loja" },
      scope,
      "cancellation",
    );
  }

  /**
   * Sends a refund to Stripe, or finds it there if an earlier try got through without an answer. A
   * refusal is final (the row fails); a network failure leaves it pending for the sweep.
   */
  async submit(refundId: string): Promise<void> {
    const row = await this.db.refund.findUnique({ where: { id: refundId }, include: { order: true } });
    if (!row || row.stripeRefundId || row.status !== "pending" || !row.order.paymentIntentId) return;
    const paymentIntentId = row.order.paymentIntentId;
    let refund: GatewayRefund;
    try {
      const stale = this.clock.now().getTime() - row.createdAt.getTime() > LOOK_FIRST_AFTER_MS;
      const found = stale
        ? (await this.gateway.listRefunds(paymentIntentId)).find(
            (candidate) => candidate.metadata["refundId"] === row.id,
          )
        : undefined;
      refund =
        found ??
        (await this.gateway.createRefund({
          paymentIntentId,
          amountCents: row.amountCents,
          metadata: { refundId: row.id, orderId: row.orderId, env: this.env.PAYMENTS_ENV },
          idempotencyKey: `refund:${row.id}`,
        }));
    } catch (error) {
      if (error instanceof GatewayRefused) {
        await this.apply(row.id, { status: "failed", failureReason: error.message });
        return;
      }
      this.logger.warn(`refund ${row.id} not sent yet: ${error instanceof Error ? error.message : error}`);
      // Tried: the sweep tries again after its interval.
      await this.db.refund.update({ where: { id: row.id }, data: { updatedAt: this.clock.now() } });
      return;
    }
    await this.apply(row.id, refund);
  }

  /**
   * An order's refunds and disputes, as Stripe has them now: our rows settle, Dashboard refunds become
   * rows, disputes mark the order.
   */
  async reconcile(orderId: string): Promise<void> {
    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (!order?.paymentIntentId) return;
    const [stripeRefunds, disputes] = await Promise.all([
      this.gateway.listRefunds(order.paymentIntentId),
      this.gateway.listDisputes(order.paymentIntentId),
    ]);
    const local = await this.db.refund.findMany({ where: { orderId } });
    for (const refund of [...stripeRefunds].reverse()) {
      const ours =
        local.find((row) => row.stripeRefundId === refund.id) ??
        local.find((row) => row.id === refund.metadata["refundId"]);
      if (ours) {
        if (ours.stripeRefundId !== refund.id || ours.status !== refund.status)
          await this.apply(ours.id, refund);
      } else if (!refund.metadata["refundId"] && order.amountPaidCents > 0) {
        // (An order with nothing paid on record had a late payment refunded whole when it closed: that
        // refund lives in its history, not here.)
        await this.adopt(order, refund);
      }
    }
    const latest = disputes[0];
    if (latest && latest.status !== order.disputeStatus) {
      const now = this.clock.now();
      const type =
        order.disputeStatus === null
          ? "dispute_opened"
          : OPEN_DISPUTES.has(latest.status)
            ? "dispute_updated"
            : "dispute_closed";
      await transaction(this.db, async (tx) => {
        await tx.order.update({ where: { id: orderId }, data: { disputeStatus: latest.status } });
        await tx.orderEvent.create({
          data: {
            id: uuidv7(now.getTime()),
            orderId,
            type,
            data: { status: latest.status, reason: latest.reason, amountCents: latest.amountCents },
            createdAt: now,
          },
        });
      });
      this.logger.warn(`order ${order.number}: dispute ${latest.status}`);
    }
  }

  /** Our row, brought in line with Stripe's refund: its status and what follows from it. */
  private async apply(
    refundId: string,
    refund: Pick<GatewayRefund, "status" | "failureReason"> & { id?: string },
  ): Promise<void> {
    const now = this.clock.now();
    let succeeded = false;
    await transaction(this.db, async (tx) => {
      const [row] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
      if (!row) return;
      const current = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
        include: { items: true, order: true },
      });
      if (current.status === "failed" || current.status === "canceled") return; // final
      const status = refund.status;
      await tx.refund.update({
        where: { id: refundId },
        data: {
          status,
          stripeRefundId: current.stripeRefundId ?? refund.id ?? null,
          failureReason: refund.failureReason?.slice(0, 200) ?? null,
          updatedAt: now,
        },
      });
      const accepted = status === "pending" || status === "requires_action" || status === "succeeded";
      // Goods back to stock once Stripe has the refund (only those the admin said came back).
      if (accepted) {
        for (const item of current.items) {
          if (item.restock === 0 || item.restocked) continue;
          const line = await tx.orderItem.findUniqueOrThrow({ where: { id: item.orderItemId } });
          await this.stock.move(tx, {
            variantId: line.variantId,
            sandboxId: current.order.sandboxId,
            kind: "restock",
            quantity: item.restock,
            orderId: current.orderId,
            reason: current.reason ?? "Reembolso",
          });
          await tx.refundItem.update({ where: { id: item.id }, data: { restocked: true } });
        }
        if (current.origin === "cancellation") await this.closeIn(tx, current.orderId, current.actorId);
      }
      if (status === "succeeded" && current.status !== "succeeded") {
        succeeded = true;
        await tx.orderEvent.create({
          data: {
            id: uuidv7(now.getTime()),
            orderId: current.orderId,
            type: "refunded",
            data: { refundId, amountCents: current.amountCents, origin: current.origin },
            createdAt: now,
          },
        });
        await this.outbox.add(
          tx,
          REFUND_EVENTS.succeeded,
          { refundId },
          { sandboxId: current.order.sandboxId },
        );
      }
      if (status === "failed" || status === "canceled") {
        await tx.orderEvent.create({
          data: {
            id: uuidv7(now.getTime()),
            orderId: current.orderId,
            type: "refund_failed",
            data: { refundId, amountCents: current.amountCents, reason: refund.failureReason ?? null },
            createdAt: now,
          },
        });
      }
    });
    if (succeeded) this.outbox.committed();
  }

  /** A refund made in Stripe's Dashboard: a row of ours, so totals and the order's history agree with Stripe. */
  private async adopt(order: Order, refund: GatewayRefund): Promise<void> {
    const now = this.clock.now();
    const id = uuidv7(now.getTime());
    try {
      await transaction(this.db, async (tx) => {
        await tx.refund.create({
          data: {
            id,
            orderId: order.id,
            stripeRefundId: refund.id,
            amountCents: refund.amountCents,
            status: refund.status,
            origin: "stripe",
            reason: "Feito no painel do Stripe",
            failureReason: refund.failureReason,
            createdAt: now,
            updatedAt: now,
          },
        });
        if (refund.status === "succeeded") {
          await tx.orderEvent.create({
            data: {
              id: uuidv7(now.getTime()),
              orderId: order.id,
              type: "refunded",
              data: { refundId: id, amountCents: refund.amountCents, origin: "stripe" },
              createdAt: now,
            },
          });
          await this.outbox.add(
            tx,
            REFUND_EVENTS.succeeded,
            { refundId: id },
            { sandboxId: order.sandboxId },
          );
        }
      });
      this.outbox.committed();
    } catch (error) {
      // Adopted at the same moment by another reconciliation.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  /** Refunds still pending for a while: sent again if they never got to Stripe, asked about otherwise. */
  private async recheck(now: Date): Promise<number> {
    const due = await this.db.refund.findMany({
      where: {
        status: { in: ["pending", "requires_action"] },
        updatedAt: { lte: new Date(now.getTime() - REFUND_RECHECK_MS) },
      },
      orderBy: { updatedAt: "asc" },
      take: 10,
    });
    let checked = 0;
    for (const row of due) {
      try {
        if (row.stripeRefundId) await this.reconcile(row.orderId);
        else await this.submit(row.id);
        checked += 1;
      } catch (error) {
        this.logger.warn(
          `checking refund ${row.id} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
      // Whatever came of it, the next look waits the interval.
      await this.db.refund.updateMany({
        where: { id: row.id, status: { in: ["pending", "requires_action"] } },
        data: { updatedAt: now },
      });
    }
    return checked;
  }

  /** The order, locked: refunds on one order are decided one at a time. */
  private async locked(tx: Tx, orderId: string, scope: Prisma.OrderWhereInput): Promise<Order> {
    const order = await tx.order.findFirst({ where: { id: orderId, ...scope } });
    if (!order) throw new NotFoundException(NOT_FOUND);
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  /** The asked-for lines, checked against what's left of each, with their money. */
  private async linesOf(tx: Tx, order: Order, input: RefundInput) {
    if (input.items.length === 0) return [];
    const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
    const refunded = await this.refundedUnits(tx, order.id);
    return input.items.map((asked) => {
      const item = items.find((candidate) => candidate.id === asked.orderItemId);
      if (!item)
        throw new NotFoundException({ code: "not_found", message: "Item não encontrado neste pedido." });
      const already = refunded.get(item.id) ?? 0;
      if (asked.quantity > item.quantity - already) {
        throw new ConflictException({
          code: "over_refund",
          message: `Só ${item.quantity - already} unidade(s) de “${item.title}” podem ser reembolsadas.`,
        });
      }
      return {
        orderItemId: item.id,
        quantity: asked.quantity,
        amountCents: lineRefundCents(
          item.lineTotalCents - item.discountCents,
          item.quantity,
          already,
          asked.quantity,
        ),
        restock: asked.restock && item.kind === "physical" ? asked.quantity : 0,
      };
    });
  }

  private async refundedUnits(db: Tx, orderId: string): Promise<Map<string, number>> {
    const rows = await db.refundItem.groupBy({
      by: ["orderItemId"],
      where: { refund: { orderId, status: { in: [...COUNTED] } } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((row) => [row.orderItemId, row._sum.quantity ?? 0]));
  }

  /** A paid order not yet shipped closes as cancelled (its refund already holds everything). */
  private async closeIn(tx: Tx, orderId: string, actorId: string | null): Promise<void> {
    const now = this.clock.now();
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: { in: ["paid", "preparing"] } },
      data: { status: "canceled", closedAt: now },
    });
    if (count === 0) return;
    await tx.orderEvent.create({
      data: {
        id: uuidv7(now.getTime()),
        orderId,
        type: "canceled",
        actorId,
        data: { reason: "refunded" },
        createdAt: now,
      },
    });
  }

  private async close(orderId: string, actorId: string): Promise<void> {
    await transaction(this.db, (tx) => this.closeIn(tx, orderId, actorId));
  }
}
