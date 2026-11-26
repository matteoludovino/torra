import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { MAX_PER_LINE, type CartIssue, type CartLine, type CartView } from "@torra/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser } from "../auth/auth-user.ts";
import { Stock } from "../catalog/stock.service.ts";
import { uuidv7 } from "../common/ids.ts";
import { RateLimiter } from "../common/rate-limiter.ts";
import { hashToken, newToken } from "../common/secrets.ts";
import { transaction } from "../common/transactions.ts";
import { ENV, type Env } from "../env.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { visibleTo } from "../sandbox/scope.ts";
import { Scheduler } from "../scheduler/scheduler.service.ts";
import { Clock } from "../time/clock.ts";

export const CART_COOKIE = "torra_cart";
const DAY = 24 * 60 * 60 * 1000;
/** A visitor's cart nobody touched for this long is removed (and its cookie lasts as long). */
const VISITOR_CART_LIFETIME_MS = 30 * DAY;
/** Visitors have no sandbox write budget: theirs is per address. */
const VISITOR_WRITES = { max: 60, windowMs: 60_000 };

const itemInclude = { variant: { include: { product: true } } } satisfies Prisma.CartItemInclude;
type Item = Prisma.CartItemGetPayload<{ include: typeof itemInclude }>;

/** Whose cart: a customer's (in their sandbox) or a visitor's (the shared catalog only). */
type Owner = { kind: "customer"; userId: string; sandboxId: string } | { kind: "visitor" };

/**
 * Carts. Prices always come from the catalog: a line only remembers the price the customer saw, to tell
 * them when it changed. Quantities are checked against what's available in the customer's corner of the
 * store, but nothing is held until an order is placed.
 */
@Injectable()
export class Carts implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly stock: Stock,
    private readonly limiter: RateLimiter,
    private readonly scheduler: Scheduler,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "visitor-carts",
      run: async (now) => {
        const { count } = await this.db.cart.deleteMany({
          where: { userId: null, updatedAt: { lte: new Date(now.getTime() - VISITOR_CART_LIFETIME_MS) } },
        });
        return count;
      },
      nextDueAt: async () => {
        const oldest = await this.db.cart.findFirst({
          where: { userId: null },
          orderBy: { updatedAt: "asc" },
          select: { updatedAt: true },
        });
        return oldest ? new Date(oldest.updatedAt.getTime() + VISITOR_CART_LIFETIME_MS) : null;
      },
    });
  }

  async view(viewer: AuthUser | null, request: FastifyRequest): Promise<CartView> {
    const owner = this.owner(viewer, { writing: false });
    const cart = owner ? await this.find(this.db, owner, request) : null;
    return this.render(cart?.id ?? null, owner?.kind === "customer" ? owner.sandboxId : null);
  }

  /** Adds units of a variant (a digital product stays at one). The line takes the current price as seen. */
  async add(
    viewer: AuthUser | null,
    request: FastifyRequest,
    reply: FastifyReply,
    variantId: string,
    quantity: number,
  ): Promise<CartView> {
    const owner = this.writer(viewer, request);
    const cartId = await transaction(this.db, async (tx) => {
      const cart = (await this.find(tx, owner, request)) ?? (await this.create(tx, owner, reply));
      const variant = await this.sellable(tx, owner, variantId);
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });
      const wanted = variant.product.kind === "digital" ? 1 : (existing?.quantity ?? 0) + quantity;
      await this.checkQuantity(tx, owner, variant, wanted);
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
        create: {
          cartId: cart.id,
          variantId,
          quantity: wanted,
          seenPriceCents: variant.priceCents,
          createdAt: this.clock.now(),
        },
        update: { quantity: wanted, seenPriceCents: variant.priceCents },
      });
      await this.touch(tx, cart.id);
      return cart.id;
    });
    return this.render(cartId, sandboxOf(owner));
  }

  /** Sets a line's quantity; 0 removes it. */
  async setQuantity(
    viewer: AuthUser | null,
    request: FastifyRequest,
    variantId: string,
    quantity: number,
  ): Promise<CartView> {
    const owner = this.writer(viewer, request);
    const cartId = await transaction(this.db, async (tx) => {
      const cart = await this.find(tx, owner, request);
      const item = cart
        ? await tx.cartItem.findUnique({
            where: { cartId_variantId: { cartId: cart.id, variantId } },
            include: itemInclude,
          })
        : null;
      if (!cart || !item)
        throw new NotFoundException({ code: "not_in_cart", message: "Este item não está no carrinho." });
      if (quantity === 0) {
        await tx.cartItem.delete({ where: { cartId_variantId: { cartId: cart.id, variantId } } });
      } else {
        if (item.variant.product.kind === "digital" && quantity !== 1) {
          throw new ConflictException({
            code: "one_per_customer",
            message: "Produtos digitais: uma unidade basta.",
          });
        }
        await this.checkQuantity(tx, owner, item.variant, quantity);
        await tx.cartItem.update({
          where: { cartId_variantId: { cartId: cart.id, variantId } },
          data: { quantity },
        });
      }
      await this.touch(tx, cart.id);
      return cart.id;
    });
    return this.render(cartId, sandboxOf(owner));
  }

  /** The customer saw the new prices: lines stop flagging them. */
  async acknowledgePrices(viewer: AuthUser | null, request: FastifyRequest): Promise<CartView> {
    const owner = this.writer(viewer, request);
    const cart = await this.find(this.db, owner, request);
    if (cart) {
      await this.db.$executeRaw`
        UPDATE cart_items i SET "seenPriceCents" = v."priceCents"
        FROM variants v WHERE v.id = i."variantId" AND i."cartId" = ${cart.id}::uuid`;
      await this.touch(this.db, cart.id);
    }
    return this.render(cart?.id ?? null, sandboxOf(owner));
  }

  /**
   * After signing in: a visitor's cart (from its cookie) moves into the account's. Quantities add up,
   * within the per-line limit; availability shows on the cart as usual. The visitor cart and its cookie go.
   */
  async adopt(request: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
    const token = request.cookies[CART_COOKIE];
    if (!token) return;
    void reply.clearCookie(CART_COOKIE, { path: "/" });
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user?.sandboxId || user.role !== "customer") return;
    const owner: Owner = { kind: "customer", userId, sandboxId: user.sandboxId };
    await transaction(this.db, async (tx) => {
      const visitor = await tx.cart.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { items: true },
      });
      if (!visitor) return;
      const cart = (await this.find(tx, owner, request)) ?? (await this.create(tx, owner, reply));
      for (const item of visitor.items) {
        const existing = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId: cart.id, variantId: item.variantId } },
          include: itemInclude,
        });
        if (existing) {
          const total = existing.variant.product.kind === "digital" ? 1 : existing.quantity + item.quantity;
          await tx.cartItem.update({
            where: { cartId_variantId: { cartId: cart.id, variantId: item.variantId } },
            data: { quantity: Math.min(total, MAX_PER_LINE) },
          });
        } else {
          await tx.cartItem.create({ data: { ...item, cartId: cart.id } });
        }
      }
      await tx.cart.delete({ where: { id: visitor.id } });
      await this.touch(tx, cart.id);
    });
  }

  /**
   * Who owns the cart this request means. Someone signed in without a sandbox (the store's own admins)
   * doesn't shop: their orders would take the shared catalog's stock.
   */
  private owner(viewer: AuthUser | null, { writing }: { writing: boolean }): Owner | null {
    if (!viewer) return { kind: "visitor" };
    if (!viewer.sandboxId) {
      if (!writing) return null;
      throw new ForbiddenException({
        code: "admins_dont_shop",
        message: "Contas de administração não fazem compras. Use uma conta de cliente.",
      });
    }
    return { kind: "customer", userId: viewer.id, sandboxId: viewer.sandboxId };
  }

  private writer(viewer: AuthUser | null, request: FastifyRequest): Owner {
    const owner = this.owner(viewer, { writing: true })!;
    if (owner.kind === "visitor") this.limiter.hit(`cart:ip:${request.ip}`, VISITOR_WRITES);
    return owner;
  }

  private async find(db: Tx, owner: Owner, request: FastifyRequest) {
    if (owner.kind === "customer") return db.cart.findUnique({ where: { userId: owner.userId } });
    const token = request.cookies[CART_COOKIE];
    return token ? db.cart.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
  }

  private async create(tx: Tx, owner: Owner, reply: FastifyReply) {
    const now = this.clock.now();
    if (owner.kind === "customer") {
      // Two first adds at once: one creates the cart, the other finds it.
      await tx.$executeRaw`
        INSERT INTO carts (id, "userId", "sandboxId", "createdAt", "updatedAt")
        VALUES (${uuidv7(now.getTime())}::uuid, ${owner.userId}::uuid, ${owner.sandboxId}::uuid, ${now}, ${now})
        ON CONFLICT ("userId") DO NOTHING`;
      return tx.cart.findUniqueOrThrow({ where: { userId: owner.userId } });
    }
    const token = newToken();
    const cart = await tx.cart.create({
      data: { id: uuidv7(now.getTime()), tokenHash: hashToken(token), createdAt: now, updatedAt: now },
    });
    void reply.setCookie(CART_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.env.NODE_ENV === "production",
      path: "/",
      maxAge: VISITOR_CART_LIFETIME_MS / 1000,
    });
    return cart;
  }

  /** A variant the owner can see and buy now: active, of an active product. */
  private async sellable(tx: Tx, owner: Owner, variantId: string) {
    const variant = await tx.variant.findFirst({
      where: {
        id: variantId,
        active: true,
        product: { active: true },
        ...visibleTo({ sandboxId: sandboxOf(owner) }),
      },
      include: { product: true },
    });
    if (!variant) throw new NotFoundException({ code: "not_found", message: "Produto não encontrado." });
    return variant;
  }

  private async checkQuantity(
    tx: Tx,
    owner: Owner,
    variant: { id: string; product: { kind: string } },
    quantity: number,
  ): Promise<void> {
    if (quantity > MAX_PER_LINE) {
      throw new ConflictException({
        code: "max_per_line",
        message: `Até ${MAX_PER_LINE} unidades de cada item por pedido.`,
      });
    }
    if (variant.product.kind !== "physical") return;
    const available = (await this.stock.available(tx, [variant.id], sandboxOf(owner))).get(variant.id) ?? 0;
    if (quantity > available) {
      throw new ConflictException({
        code: "insufficient_stock",
        message: available === 0 ? "Este item esgotou." : `Só há ${available} em estoque.`,
        available,
      });
    }
  }

  private async touch(db: Tx, cartId: string): Promise<void> {
    await db.cart.update({ where: { id: cartId }, data: { updatedAt: this.clock.now() } });
  }

  /** The cart as the customer sees it: current prices, what's left, and what needs their attention. */
  private async render(cartId: string | null, sandboxId: string | null): Promise<CartView> {
    const items: Item[] = cartId
      ? await this.db.cartItem.findMany({
          where: { cartId },
          include: itemInclude,
          orderBy: { createdAt: "asc" },
        })
      : [];
    const physical = items
      .filter((item) => item.variant.product.kind === "physical")
      .map((item) => item.variantId);
    const available = await this.stock.available(this.db, physical, sandboxId);
    const lines = items.map((item): CartLine => {
      const { variant } = item;
      const left = variant.product.kind === "physical" ? (available.get(variant.id) ?? 0) : null;
      return {
        variantId: variant.id,
        product: {
          slug: variant.product.slug,
          title: variant.product.title,
          art: variant.product.art,
          kind: variant.product.kind,
        },
        options: variant.product.optionNames.map((name, i) => ({ name, value: variant.optionValues[i]! })),
        quantity: item.quantity,
        unitPriceCents: variant.priceCents,
        seenPriceCents: item.seenPriceCents,
        lineTotalCents: variant.priceCents * item.quantity,
        weightGrams: variant.weightGrams,
        available: left,
        maxQuantity: variant.product.kind === "digital" ? 1 : Math.min(MAX_PER_LINE, left ?? 0),
        issue: issueOf(item, left),
      };
    });
    return {
      lines,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
      ready: lines.length > 0 && lines.every((line) => line.issue === null),
    };
  }
}

function issueOf(item: Item, available: number | null): CartIssue | null {
  const { variant } = item;
  if (!variant.active || !variant.product.active || available === 0) return "unavailable";
  if (available !== null && item.quantity > available) return "insufficient";
  if (item.seenPriceCents !== variant.priceCents) return "price_changed";
  return null;
}

function sandboxOf(owner: Owner): string | null {
  return owner.kind === "customer" ? owner.sandboxId : null;
}
