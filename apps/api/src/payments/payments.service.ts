import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import type { PaymentStart } from "@torra/shared";
import { randomBytes } from "node:crypto";
import type { AuthUser } from "../auth/auth-user.ts";
import { uuidv7 } from "../common/ids.ts";
import { transaction } from "../common/transactions.ts";
import { ENV, type Env } from "../env.ts";
import type { Order } from "../generated/prisma/client.ts";
import { OutboxService } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Scheduler } from "../scheduler/scheduler.service.ts";
import { Clock } from "../time/clock.ts";
import { FakeGateway, type FakeOutcome } from "./fake.gateway.ts";
import { PaymentGateway, UnexpectedIntentState, type Intent } from "./gateway.ts";

export const PAYMENT_EVENTS = { received: "payment.event", paid: "order.paid" } as const;

/** How long before Stripe is asked again about a payment nobody told us about (webhooks can be lost). */
export const RECHECK_MS = 2 * 60_000;

const NOT_FOUND = { code: "not_found", message: "Pedido não encontrado." };
const NOT_PENDING = { code: "not_pending", message: "Este pedido não está mais aguardando pagamento." };

/** What letting go of an order's PaymentIntent came to. */
export type Release = "released" | "paid" | "processing";

/**
 * Payments. One function decides an order's payment state, `reconcile`: it always asks Stripe for the
 * PaymentIntent as it is now, and never trusts what an event says. Webhooks, the payment page's return
 * and a sweep only make it run, so a lost, repeated or late event changes nothing.
 *
 * Stripe is never called inside a database transaction (those are retried and hold locks): write and
 * commit, call Stripe, then a conditional update.
 */
@Injectable()
export class Payments implements OnModuleInit {
  private readonly logger = new Logger("Payments");

  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly gateway: PaymentGateway,
    private readonly outbox: OutboxService,
    private readonly scheduler: Scheduler,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.outbox.handle(PAYMENT_EVENTS.received, async ({ payload }) => {
      const { type, objectId } = payload as { type: string; objectId: string };
      if (!type.startsWith("payment_intent.")) return; // refunds and disputes: stage 8
      const order = await this.db.order.findUnique({ where: { paymentIntentId: objectId } });
      // Unknown: another deployment's payment in a shared Stripe sandbox, or one being created right now
      // (the page and the sweep will catch up with it).
      if (order) await this.reconcile(order.id);
    });
    this.scheduler.register({
      name: "payment-check",
      run: (now) => this.recheck(now),
      nextDueAt: async (now) => {
        const [row] = await this.db.$queryRaw<{ due: Date | null }[]>`
          SELECT min("paymentCheckedAt") + make_interval(secs => ${RECHECK_MS / 1000}) AS due
          FROM orders
          WHERE status = 'pending_payment' AND "paymentIntentId" IS NOT NULL AND "expiresAt" > ${now}`;
        return row?.due ?? null;
      },
    });
  }

  /**
   * Starts (or resumes) paying for the customer's order: the PaymentIntent's client secret for the card
   * form, or, for an order that costs nothing, the order settled at once.
   */
  async start(user: AuthUser, orderId: string): Promise<PaymentStart> {
    const order = await this.owned(user, orderId);
    if (order.status !== "pending_payment" || order.expiresAt <= this.clock.now()) {
      throw new ConflictException(NOT_PENDING);
    }
    if (order.totalCents === 0) {
      await this.markPaid(order, null);
      return { kind: "free" };
    }
    const intent = await this.ensureIntent(order);
    if (intent.status === "succeeded" || intent.status === "processing") {
      await this.reconcile(order.id);
      return { kind: "settled" };
    }
    return {
      kind: this.gateway.kind,
      clientSecret: intent.clientSecret,
      publishableKey: this.env.STRIPE_PUBLISHABLE_KEY ?? null,
      amountCents: intent.amountCents,
    };
  }

  /** Asks Stripe now (the payment page, back from the card form). */
  async sync(user: AuthUser, orderId: string): Promise<void> {
    await this.reconcile((await this.owned(user, orderId)).id);
  }

  /**
   * Before an order waiting for payment is closed (cancelled, replaced, expired): its PaymentIntent is
   * cancelled, so nobody can pay for a closed order. If it was paid meanwhile, the order is marked paid
   * instead; if the payment is processing, it can't be closed yet.
   */
  async release(order: Order): Promise<Release> {
    if (!order.paymentIntentId) return "released";
    try {
      await this.gateway.cancelIntent(order.paymentIntentId);
      return "released";
    } catch (error) {
      if (!(error instanceof UnexpectedIntentState)) throw error;
      await this.reconcile(order.id);
      return error.intent.status === "succeeded" ? "paid" : "processing";
    }
  }

  /** The one place an order's payment state is decided: from the PaymentIntent as Stripe has it now. */
  async reconcile(orderId: string): Promise<void> {
    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (!order?.paymentIntentId) return;
    const intent = await this.gateway.retrieveIntent(order.paymentIntentId);
    const now = this.clock.now();
    await this.db.order.update({ where: { id: order.id }, data: { paymentCheckedAt: now } });

    const problem = this.mismatch(order, intent);
    if (problem) {
      if (!order.paymentProblem) {
        this.logger.error(`order ${order.number}: ${problem} (PaymentIntent ${intent.id})`);
        await transaction(this.db, async (tx) => {
          await tx.order.update({ where: { id: order.id }, data: { paymentProblem: problem } });
          await tx.orderEvent.create({
            data: {
              id: uuidv7(now.getTime()),
              orderId: order.id,
              type: "payment_problem",
              data: { problem },
              createdAt: now,
            },
          });
        });
      }
      return;
    }
    if (intent.status === "succeeded") {
      if (order.status === "pending_payment") await this.markPaid(order, intent);
      else if (order.status === "canceled" || order.status === "expired")
        await this.refundOrphan(order, intent);
    } else if (intent.status === "processing" && order.status === "pending_payment") {
      const told = await this.db.orderEvent.count({
        where: { orderId: order.id, type: "payment_processing" },
      });
      if (told === 0) {
        await this.db.orderEvent.create({
          data: { id: uuidv7(now.getTime()), orderId: order.id, type: "payment_processing", createdAt: now },
        });
      }
    }
  }

  /** A verified webhook event: kept once (Stripe may resend it), handled through the outbox (retried). */
  async receive(event: { id: string; type: string; objectId: string }): Promise<void> {
    const now = this.clock.now();
    const fresh = await transaction(this.db, async (tx) => {
      const { count } = await tx.paymentEvent.createMany({
        data: [{ id: event.id, type: event.type, objectId: event.objectId, receivedAt: now }],
        skipDuplicates: true,
      });
      if (count > 0) {
        await this.outbox.add(tx, PAYMENT_EVENTS.received, {
          eventId: event.id,
          type: event.type,
          objectId: event.objectId,
        });
      }
      return count > 0;
    });
    if (fresh) this.outbox.committed();
  }

  /**
   * The fake gateway's card form (development, tests, end-to-end runs): what the customer did, then the
   * event Stripe would send, through the same path as a real webhook.
   */
  async simulate(user: AuthUser, orderId: string, outcome: FakeOutcome): Promise<{ error: string | null }> {
    if (!(this.gateway instanceof FakeGateway)) throw new NotFoundException(NOT_FOUND);
    const order = await this.owned(user, orderId);
    if (!order.paymentIntentId) {
      throw new ConflictException({ code: "no_payment", message: "Comece o pagamento antes." });
    }
    const intent = this.gateway.settle(order.paymentIntentId, outcome);
    const type =
      intent.status === "succeeded"
        ? "payment_intent.succeeded"
        : intent.status === "processing"
          ? "payment_intent.processing"
          : intent.status === "requires_action"
            ? "payment_intent.requires_action"
            : "payment_intent.payment_failed";
    await this.receive({ id: `evt_fake_${randomBytes(8).toString("hex")}`, type, objectId: intent.id });
    return { error: intent.lastError };
  }

  /**
   * Orders waiting for payment that Stripe hasn't been asked about for a while: asked again. Past their
   * hold they're the expiry sweep's (which asks Stripe too). Counts only the ones that got an answer, so
   * an unreachable Stripe doesn't keep the scheduler going round.
   */
  private async recheck(now: Date): Promise<number> {
    const due = await this.db.order.findMany({
      where: {
        status: "pending_payment",
        paymentIntentId: { not: null },
        paymentCheckedAt: { lte: new Date(now.getTime() - RECHECK_MS) },
        expiresAt: { gt: now },
      },
      orderBy: { paymentCheckedAt: "asc" },
      take: 10,
    });
    let checked = 0;
    for (const order of due) {
      try {
        await this.reconcile(order.id);
        checked += 1;
      } catch (error) {
        this.logger.warn(
          `checking order ${order.number} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return checked;
  }

  /** The order's PaymentIntent, created once (by an idempotency key), or a new one if Stripe cancelled it. */
  private async ensureIntent(order: Order): Promise<Intent> {
    let attempt = order.paymentAttempt;
    if (order.paymentIntentId) {
      const intent = await this.gateway.retrieveIntent(order.paymentIntentId);
      if (intent.status !== "canceled") return intent;
      attempt += 1;
    }
    const intent = await this.gateway.createIntent({
      amountCents: order.totalCents,
      description: `Pedido #${order.number} · Torra`,
      metadata: {
        orderId: order.id,
        orderNumber: String(order.number),
        sandboxId: order.sandboxId,
        env: this.env.PAYMENTS_ENV,
      },
      idempotencyKey: `pi:${order.id}:${attempt}`,
    });
    const { count } = await this.db.order.updateMany({
      where: { id: order.id, status: "pending_payment", paymentIntentId: order.paymentIntentId },
      data: { paymentIntentId: intent.id, paymentAttempt: attempt, paymentCheckedAt: this.clock.now() },
    });
    if (count === 0) {
      const current = await this.db.order.findUnique({ where: { id: order.id } });
      // Another request stored it first (the same key gave both the same PaymentIntent).
      if (current?.paymentIntentId === intent.id) return intent;
      // The order closed meanwhile: nobody may pay this one.
      await this.gateway.cancelIntent(intent.id).catch(() => undefined);
      throw new ConflictException(NOT_PENDING);
    }
    return intent;
  }

  /**
   * Paid: by its PaymentIntent, or free. The units it held are sold (the reservation stays), its lines
   * leave the cart, and a receipt goes out.
   */
  private async markPaid(order: Order, intent: Intent | null): Promise<void> {
    const now = this.clock.now();
    const done = await transaction(this.db, async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: "pending_payment", paymentIntentId: intent?.id ?? null },
        data: {
          status: "paid",
          paidAt: now,
          amountPaidCents: intent?.amountReceivedCents ?? 0,
          latestChargeId: intent?.latestChargeId ?? null,
        },
      });
      if (count === 0) return false;
      await tx.orderEvent.create({
        data: {
          id: uuidv7(now.getTime()),
          orderId: order.id,
          type: "paid",
          data: { method: intent ? "card" : "free" },
          createdAt: now,
        },
      });
      if (order.cartId) {
        const items = await tx.orderItem.findMany({
          where: { orderId: order.id },
          select: { variantId: true },
        });
        await tx.cartItem.deleteMany({
          where: { cartId: order.cartId, variantId: { in: items.map((item) => item.variantId) } },
        });
      }
      await this.outbox.add(tx, PAYMENT_EVENTS.paid, { orderId: order.id }, { sandboxId: order.sandboxId });
      return true;
    });
    if (done) {
      this.outbox.committed();
      return;
    }
    // Already paid (another path got there first), or closed meanwhile: a payment for a closed order.
    const current = await this.db.order.findUnique({ where: { id: order.id } });
    if (intent && (current?.status === "canceled" || current?.status === "expired")) {
      await this.refundOrphan(current, intent);
    }
  }

  /**
   * A payment for an order that is no longer waiting for it (its PaymentIntent was paid as it closed):
   * refunded in full, once (the idempotency key and the event make sure of it).
   */
  private async refundOrphan(order: Order, intent: Intent): Promise<void> {
    const done = await this.db.orderEvent.count({
      where: { orderId: order.id, type: "late_payment_refunded" },
    });
    if (done > 0) return;
    const refund = await this.gateway.createRefund({
      paymentIntentId: intent.id,
      metadata: { orderId: order.id, reason: "order_closed", env: this.env.PAYMENTS_ENV },
      idempotencyKey: `orphan:${intent.id}`,
    });
    this.logger.warn(`order ${order.number} was ${order.status} when paid: refunded (${refund.id})`);
    const now = this.clock.now();
    await this.db.orderEvent.create({
      data: {
        id: uuidv7(now.getTime()),
        orderId: order.id,
        type: "late_payment_refunded",
        data: { refundId: refund.id, amountCents: refund.amountCents },
        createdAt: now,
      },
    });
  }

  /** Why this PaymentIntent can't pay this order, if it can't: never paid on a mismatch. */
  private mismatch(order: Order, intent: Intent): string | null {
    if (intent.metadata["orderId"] !== order.id) return "o pagamento é de outro pedido";
    if (intent.metadata["env"] !== this.env.PAYMENTS_ENV) return "o pagamento é de outro ambiente";
    if (intent.currency !== "brl") return `moeda ${intent.currency}`;
    if (intent.amountCents !== order.totalCents) return `valor ${intent.amountCents} ≠ ${order.totalCents}`;
    return null;
  }

  private async owned(user: AuthUser, orderId: string): Promise<Order> {
    const order = await this.db.order.findFirst({ where: { id: orderId, userId: user.id } });
    if (!order) throw new NotFoundException(NOT_FOUND);
    return order;
  }
}
