import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import {
  chargeable,
  computeTotals,
  quoteShipping,
  type CartView,
  type OrderSummary,
  type OrderView,
  type placeOrderInput,
} from "@torra/shared";
import type { z } from "zod";
import type { AuthUser } from "../auth/auth-user.ts";
import { Carts } from "../cart/carts.service.ts";
import { OutOfStock, Stock } from "../catalog/stock.service.ts";
import { AddressLookup } from "../checkout/address-lookup.ts";
import { Coupons, type CouponCheck } from "../checkout/coupons.service.ts";
import { uuidv7 } from "../common/ids.ts";
import { expectChanged, isUniqueViolation, transaction } from "../common/transactions.ts";
import type { Order, Prisma } from "../generated/prisma/client.ts";
import { OutboxService, type Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Scheduler } from "../scheduler/scheduler.service.ts";
import { Clock } from "../time/clock.ts";
import { Payments, RECHECK_MS } from "../payments/payments.service.ts";
import { Downloads } from "./downloads.ts";
import { orderInclude, summaryOf, viewOf } from "./views.ts";

type PlaceInput = z.infer<typeof placeOrderInput>;

/** How long an order holds its stock and coupon while waiting for payment. */
export const HOLD_MS = 30 * 60_000;
export const ORDER_EVENTS = { placed: "order.placed", expired: "order.expired" } as const;
const NOT_FOUND = { code: "not_found", message: "Pedido não encontrado." };

/**
 * Orders. Placing one freezes the cart's lines at today's prices, holds their stock (in the customer's
 * corner of the store) and the coupon, all in one transaction under the cart's lock: a double click gets
 * the same order, and a change of shipping or coupon replaces the waiting order with a new one. An order
 * not paid in time expires, and gives back what it held.
 *
 * Locks are always taken in the same order: the cart, stock levels (by variant id), the coupon.
 */
@Injectable()
export class Orders implements OnModuleInit {
  private readonly logger = new Logger("Orders");

  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly carts: Carts,
    private readonly coupons: Coupons,
    private readonly addresses: AddressLookup,
    private readonly stock: Stock,
    private readonly outbox: OutboxService,
    private readonly scheduler: Scheduler,
    private readonly payments: Payments,
    private readonly downloads: Downloads,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "order-expiry",
      run: (now) => this.expireDue(now),
      // An order Stripe was asked about after it expired (its payment was processing) waits for the
      // payment check's interval before it's tried again.
      nextDueAt: async () => {
        const [row] = await this.db.$queryRaw<{ due: Date | null }[]>`
          SELECT min(CASE WHEN "paymentCheckedAt" >= "expiresAt"
                          THEN "paymentCheckedAt" + make_interval(secs => ${RECHECK_MS / 1000})
                          ELSE "expiresAt" END) AS due
          FROM orders WHERE status = 'pending_payment'`;
        return row?.due ?? null;
      },
    });
  }

  async place(user: AuthUser, input: PlaceInput): Promise<OrderView> {
    const sandboxId = customerSandbox(user);
    if (input.address) await this.checkState(input.address);
    let orderId: string;
    try {
      orderId = await this.closing((released) =>
        transaction(this.db, (tx) => this.placeIn(tx, user, sandboxId, input, released)),
      );
    } catch (error) {
      // The cart's lock serializes a customer's checkouts, so the unique indexes (one waiting order per
      // cart, one live use of a "once per customer" coupon) are a backstop that shouldn't fire.
      if (!isUniqueViolation(error)) throw error;
      throw new ConflictException({
        code: "concurrent_checkout",
        message: "Outro pedido foi feito ao mesmo tempo. Confira seus pedidos e tente de novo.",
      });
    }
    this.outbox.committed();
    return this.view(user, orderId);
  }

  private async placeIn(
    tx: Tx,
    user: AuthUser,
    sandboxId: string,
    input: PlaceInput,
    released: string | null,
  ): Promise<string> {
    const [cart] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM carts WHERE "userId" = ${user.id}::uuid FOR UPDATE`;
    const view = await this.carts.lines(tx, cart?.id ?? null, sandboxId);
    if (!cart || view.lines.length === 0) {
      throw new ConflictException({ code: "empty_cart", message: "Seu carrinho está vazio." });
    }
    if (!view.ready) {
      throw new ConflictException({
        code: "cart_not_ready",
        message: "Alguns itens do carrinho mudaram: confira o carrinho antes de continuar.",
      });
    }
    const physical = view.lines.some((line) => line.product.kind === "physical");
    const address = physical ? input.address : undefined;
    if (physical && !address) {
      throw new BadRequestException({ code: "needs_address", message: "Informe o endereço de entrega." });
    }
    const service = physical ? (input.shippingService ?? "economico") : null;
    const now = this.clock.now();

    // The same order again (a double click, or back from the payment page): that one. Anything changed
    // (lines, prices, coupon, shipping, address): the waiting order gives way to a new one, and gives back
    // its stock and coupon first, so the new one can take them.
    const pending = await tx.order.findFirst({
      where: { cartId: cart.id, status: "pending_payment" },
      include: { items: true },
    });
    if (pending) {
      if (pending.expiresAt > now && sameOrder(pending, view, input.couponCode ?? null, service, address)) {
        return pending.id;
      }
      if (pending.expiresAt > now) await this.closeIn(tx, pending, "canceled", user.id, "replaced", released);
      else await this.closeIn(tx, pending, "expired", null, "not_paid", released);
    }

    // The coupon, as it stands now (checked again under its lock below, after the stock).
    let coupon: Extract<CouponCheck, { ok: true }> | null = null;
    if (input.couponCode) {
      const check = await this.coupons.check(
        tx,
        input.couponCode,
        { userId: user.id, sandboxId },
        view.subtotalCents,
        now,
      );
      if (!check.ok) throw new ConflictException({ code: "coupon_problem", message: check.problem });
      coupon = check;
    }
    const keyed = view.lines.map((line) => ({
      key: line.variantId,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
    }));
    const products = computeTotals({ lines: keyed, discount: coupon?.discount ?? null, shippingCents: 0 });
    const weight = view.lines.reduce((sum, line) => sum + (line.weightGrams ?? 0) * line.quantity, 0);
    const shipping = address
      ? quoteShipping(address.uf, weight, products.subtotalCents - products.discountCents).find(
          (option) => option.service === service,
        )!
      : null;
    const totals = computeTotals({
      lines: keyed,
      discount: coupon?.discount ?? null,
      shippingCents: shipping?.priceCents ?? 0,
    });
    if (!chargeable(totals.totalCents)) {
      throw new ConflictException({
        code: "below_minimum",
        message: "O total ficou abaixo de R$ 0,50, o mínimo que dá para cobrar no cartão.",
      });
    }

    const id = uuidv7(now.getTime());
    await tx.order.create({
      data: {
        id,
        userId: user.id,
        sandboxId,
        cartId: cart.id,
        email: user.email,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        shippingCents: totals.shippingCents,
        totalCents: totals.totalCents,
        couponId: coupon?.coupon.id ?? null,
        couponCode: coupon?.coupon.code ?? null,
        shippingService: shipping?.service ?? null,
        shippingDaysMin: shipping?.daysMin ?? null,
        shippingDaysMax: shipping?.daysMax ?? null,
        recipient: address?.recipient ?? null,
        cep: address?.cep ?? null,
        street: address?.street ?? null,
        streetNumber: address?.number ?? null,
        complement: address?.complement ?? null,
        district: address?.district ?? null,
        city: address?.city ?? null,
        uf: address?.uf ?? null,
        expiresAt: new Date(now.getTime() + HOLD_MS),
        createdAt: now,
        items: {
          create: view.lines.map((line, position) => ({
            id: uuidv7(now.getTime()),
            variantId: line.variantId,
            kind: line.product.kind,
            title: line.product.title,
            options: line.options.map((option) => option.value).join(" · "),
            sku: line.sku,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            lineTotalCents: line.lineTotalCents,
            discountCents: totals.lines[position]!.discountCents,
            weightGrams: line.weightGrams,
            position,
          })),
        },
        events: { create: { id: uuidv7(now.getTime()), type: "placed", actorId: user.id, createdAt: now } },
      },
    });

    // Stock, in variant id order.
    const toHold = view.lines
      .filter((line) => line.product.kind === "physical")
      .sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
    for (const line of toHold) {
      try {
        await this.stock.move(tx, {
          variantId: line.variantId,
          sandboxId,
          kind: "reserve",
          quantity: -line.quantity,
          orderId: id,
        });
      } catch (error) {
        if (!(error instanceof OutOfStock)) throw error;
        throw new ConflictException({
          code: "out_of_stock",
          message: `“${line.product.title}” acabou de esgotar. Confira o carrinho.`,
        });
      }
    }

    // Then the coupon, under its lock: its limits are checked again now that nobody else can use it.
    // NO KEY UPDATE, not UPDATE: the order row inserted above already holds a KEY SHARE lock on the
    // coupon (its foreign key), which FOR UPDATE would wait on, deadlocking two checkouts at once.
    if (coupon) {
      await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${coupon.coupon.id}::uuid FOR NO KEY UPDATE`;
      const again = await this.coupons.check(
        tx,
        coupon.coupon.code,
        { userId: user.id, sandboxId },
        view.subtotalCents,
        now,
      );
      if (!again.ok) throw new ConflictException({ code: "coupon_problem", message: again.problem });
      await tx.couponRedemption.create({
        data: {
          id: uuidv7(now.getTime()),
          couponId: coupon.coupon.id,
          userId: user.id,
          sandboxId,
          orderId: id,
          exclusive: coupon.coupon.oncePerCustomer,
          createdAt: now,
        },
      });
    }
    await this.outbox.add(tx, ORDER_EVENTS.placed, { orderId: id }, { sandboxId });
    return id;
  }

  /**
   * Shipping is priced by the address's state, so it must be the CEP's (as the quote priced it). Asked
   * before the transaction (an outside call never runs under its locks); if the directory doesn't answer,
   * the typed state stands, as it does for the quote.
   */
  private async checkState(address: NonNullable<PlaceInput["address"]>): Promise<void> {
    const found = await this.addresses.lookup(address.cep);
    if ("unavailable" in found) return;
    if (!found.found) {
      throw new BadRequestException({ code: "unknown_cep", message: "CEP não encontrado." });
    }
    if (found.address.uf !== address.uf) {
      throw new BadRequestException({
        code: "state_mismatch",
        message: `Este CEP é de ${found.address.uf}: confira o estado.`,
      });
    }
  }

  /** The customer gives up on an order waiting for payment: its stock and coupon go back. */
  async cancel(user: AuthUser, id: string): Promise<OrderView> {
    await this.closing((released) =>
      transaction(this.db, async (tx) => {
        const order = await this.owned(tx, user, id);
        if (order.expiresAt <= this.clock.now()) {
          await this.closeIn(tx, order, "expired", null, "not_paid", released);
        } else await this.closeIn(tx, order, "canceled", user.id, "customer", released);
      }),
    );
    return this.view(user, id);
  }

  /** Orders past their hold, each closed in its own transaction (a failure doesn't hold up the rest). */
  async expireDue(now: Date): Promise<number> {
    const due = await this.db.order.findMany({
      where: {
        status: "pending_payment",
        expiresAt: { lte: now },
        // Asked about after it expired (a payment processing): again only after a while.
        OR: [
          { paymentCheckedAt: null },
          { paymentCheckedAt: { lt: this.db.order.fields.expiresAt } },
          { paymentCheckedAt: { lte: new Date(now.getTime() - RECHECK_MS) } },
        ],
      },
      orderBy: { expiresAt: "asc" },
      take: 20,
    });
    let expired = 0;
    for (const order of due) {
      try {
        await this.closing((released) =>
          transaction(this.db, async (tx) => {
            await this.closeIn(tx, order, "expired", null, "not_paid", released);
            await this.outbox.add(
              tx,
              ORDER_EVENTS.expired,
              { orderId: order.id },
              { sandboxId: order.sandboxId },
            );
          }),
        );
        expired += 1;
      } catch (error) {
        // Paid, cancelled or with a payment processing: nothing to do now.
        if (!(error instanceof ConflictException)) {
          this.logger.error(
            `expiring order ${order.number} failed: ${error instanceof Error ? error.message : error}`,
          );
          // Tried after its expiry: the next try waits the payment check's interval (Stripe down, say,
          // mustn't keep the scheduler going round every second).
          await this.db.order.updateMany({
            where: { id: order.id, status: "pending_payment" },
            data: { paymentCheckedAt: this.clock.now() },
          });
        }
      }
    }
    if (expired > 0) this.outbox.committed();
    return expired;
  }

  async mine(user: AuthUser): Promise<OrderSummary[]> {
    const orders = await this.db.order.findMany({
      where: { userId: user.id },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const now = this.clock.now();
    return orders.map((order) => summaryOf(order, order._count.items, now));
  }

  async view(user: AuthUser, id: string): Promise<OrderView> {
    const order = await this.owned(this.db, user, id);
    const full = await this.db.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    // Past its hold, it shows as expired right away; the sweep gives the stock back.
    if (full.status === "pending_payment" && full.expiresAt <= this.clock.now()) this.scheduler.kick();
    return viewOf(full, this.clock.now(), (itemId) => this.downloads.link(itemId));
  }

  /**
   * Runs work that closes an order waiting for payment. Its PaymentIntent, if it has one, is let go of
   * first, outside any transaction (Stripe is never called in one): then the work runs again, now allowed
   * to close it. If the order was paid meanwhile, or its payment is processing, it stays open.
   */
  private async closing<T>(work: (released: string | null) => Promise<T>): Promise<T> {
    let released: string | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        return await work(released);
      } catch (error) {
        if (!(error instanceof Unreleased) || attempt >= 3) throw error;
        const outcome = await this.payments.release(error.order);
        if (outcome === "paid") {
          throw new ConflictException({
            code: "already_paid",
            message: `O pedido #${error.order.number} acabou de ser pago: confira seus pedidos.`,
          });
        }
        if (outcome === "processing") {
          throw new ConflictException({
            code: "payment_processing",
            message: `O pagamento do pedido #${error.order.number} está em processamento: aguarde a confirmação.`,
          });
        }
        released = error.order.paymentIntentId;
      }
    }
  }

  /**
   * Closes an order waiting for payment (cancelled or expired): its stock goes back to the customer's
   * corner of the store, its coupon use is released. Only from pending_payment: anything else is a 409.
   */
  private async closeIn(
    tx: Tx,
    order: Order,
    to: "canceled" | "expired",
    actorId: string | null,
    reason: string,
    released: string | null,
  ) {
    const now = this.clock.now();
    // Only with the PaymentIntent let go of (or none): a payable order is never closed.
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: "pending_payment", paymentIntentId: released },
      data: { status: to, closedAt: now },
    });
    if (count === 0) {
      const current = await tx.order.findUnique({ where: { id: order.id } });
      if (current?.status === "pending_payment") throw new Unreleased(current);
    }
    expectChanged(count, { code: "not_pending", message: "Este pedido não está mais aguardando pagamento." });
    const held = await tx.stockMovement.findMany({
      where: { orderId: order.id, kind: "reserve" },
      orderBy: { variantId: "asc" },
    });
    for (const movement of held) {
      await this.stock.move(tx, {
        variantId: movement.variantId,
        sandboxId: movement.sandboxId,
        kind: "release",
        quantity: -movement.quantity,
        orderId: order.id,
      });
    }
    await tx.couponRedemption.updateMany({
      where: { orderId: order.id, releasedAt: null },
      data: { releasedAt: now },
    });
    await tx.orderEvent.create({
      data: {
        id: uuidv7(now.getTime()),
        orderId: order.id,
        type: to,
        actorId,
        data: { reason },
        createdAt: now,
      },
    });
  }

  /** The customer's own order; anyone else's is a 404. */
  private async owned(db: Tx, user: AuthUser, id: string): Promise<Order> {
    const order = await db.order.findFirst({ where: { id, userId: user.id } });
    if (!order) throw new NotFoundException(NOT_FOUND);
    return order;
  }
}

function customerSandbox(user: AuthUser): string {
  if (!user.sandboxId) {
    throw new ForbiddenException({
      code: "admins_dont_shop",
      message: "Contas de administração não fazem compras. Use uma conta de cliente.",
    });
  }
  return user.sandboxId;
}

/** Would placing this cart give the order already waiting? Same lines and prices, coupon, shipping, address. */
function sameOrder(
  pending: Prisma.OrderGetPayload<{ include: { items: true } }>,
  cart: CartView,
  couponCode: string | null,
  shippingService: string | null,
  address: PlaceInput["address"],
): boolean {
  const lines = (items: { variantId: string; quantity: number; unitPriceCents: number }[]) =>
    items
      .map((item) => `${item.variantId}:${item.quantity}:${item.unitPriceCents}`)
      .sort()
      .join(",");
  const where = (a: PlaceInput["address"]) =>
    a ? [a.recipient, a.cep, a.street, a.number, a.complement, a.district, a.city, a.uf] : [];
  const stored = pending.cep
    ? [
        pending.recipient,
        pending.cep,
        pending.street,
        pending.streetNumber,
        pending.complement,
        pending.district,
        pending.city,
        pending.uf,
      ]
    : [];
  return (
    lines(pending.items) === lines(cart.lines) &&
    pending.couponCode === couponCode &&
    pending.shippingService === shippingService &&
    JSON.stringify(stored) === JSON.stringify(where(address))
  );
}

/** Closing an order whose PaymentIntent hasn't been let go of yet (see `closing`). */
class Unreleased extends Error {
  constructor(readonly order: Order) {
    super(`order ${order.number} still has a live PaymentIntent`);
  }
}
