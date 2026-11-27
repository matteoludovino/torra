import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
} from "@nestjs/common";
import type { DemoEmail, DemoPersona, DemoStatus, Me } from "@torra/shared";
import type { FastifyReply } from "fastify";
import { AdminOrders } from "../admin/admin-orders.service.ts";
import type { AuthUser } from "../auth/auth-user.ts";
import { Sessions } from "../auth/sessions.service.ts";
import { uuidv7 } from "../common/ids.ts";
import { RateLimiter } from "../common/rate-limiter.ts";
import { transaction } from "../common/transactions.ts";
import { ENV, type Env } from "../env.ts";
import { Orders } from "../orders/orders.service.ts";
import { OutboxService } from "../outbox/outbox.service.ts";
import { PaymentGateway } from "../payments/gateway.ts";
import { Payments } from "../payments/payments.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Profiles } from "../profiles/profiles.service.ts";
import { DEMO_LIFETIME_MS, Sandboxes } from "../sandbox/sandboxes.service.ts";
import { Clock } from "../time/clock.ts";

/** New demos per client address. */
const DEMOS_PER_IP = { max: 5, windowMs: 3_600_000 };
export const DEMO_EVENTS = { seed: "demo.seed" } as const;

const PEOPLE: Record<DemoPersona, string> = { customer: "Marina Costa", admin: "Equipe da demo" };

const ADDRESS = {
  recipient: "Marina Costa",
  cep: "01310100",
  street: "Avenida Paulista",
  number: "1578",
  complement: null,
  district: "Bela Vista",
  city: "São Paulo",
  uf: "SP" as const,
};

/**
 * The demo's starting story, told through the same services customers and admins use (same rules,
 * same database invariants, real test payments when Stripe is configured): one order delivered (to
 * refund), one paid and waiting to ship, one waiting for payment (to pay with a test card).
 */
const STORY: {
  items: [sku: string, quantity: number][];
  coupon?: string;
  service?: "economico" | "expresso";
  pay: boolean;
  deliver?: string;
}[] = [
  {
    items: [
      ["MANT-250-G", 2],
      ["COAD-02-BR", 1],
    ],
    coupon: "BEMVINDO10",
    service: "expresso",
    pay: true,
    deliver: "QB123456789BR",
  },
  { items: [["CHAL-1L", 1]], pay: true },
  {
    items: [
      ["CURSO-COADO", 1],
      ["EBOOK-GELADO", 1],
    ],
    pay: false,
  },
];

/**
 * One-click demos. A visitor gets a corner of the store of their own (a sandbox, gone after a day) with
 * two people in it, a customer and the admin of that corner, and is signed in as the one they picked;
 * they can switch without starting over. The demo opens at once; its orders are written right after, in
 * the background. Its emails are kept for the visitor to read, never sent.
 */
@Injectable()
export class Demo implements OnModuleInit {
  private readonly logger = new Logger("Demo");

  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly sandboxes: Sandboxes,
    private readonly sessions: Sessions,
    private readonly profiles: Profiles,
    private readonly orders: Orders,
    private readonly payments: Payments,
    private readonly gateway: PaymentGateway,
    private readonly adminOrders: AdminOrders,
    private readonly outbox: OutboxService,
    private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.outbox.handle(DEMO_EVENTS.seed, async ({ payload }) => {
      await this.tellStory((payload as { sandboxId: string }).sandboxId);
    });
  }

  /**
   * Signs in as `persona`: in the viewer's own demo if they're in one (switching), otherwise in a new
   * one, within the per-address and global limits. Someone signed in to a real account is asked to sign
   * out first (a demo isn't started on top of it).
   */
  async enter(viewer: AuthUser | null, persona: DemoPersona, ip: string, reply: FastifyReply): Promise<Me> {
    let sandboxId: string | null = null;
    if (viewer) {
      const sandbox = viewer.sandboxId
        ? await this.db.sandbox.findUnique({ where: { id: viewer.sandboxId } })
        : null;
      if (!sandbox?.expiresAt) {
        throw new ConflictException({
          code: "signed_in",
          message: "Saia da sua conta para abrir a demonstração.",
        });
      }
      sandboxId = sandbox.id;
    } else {
      this.limiter.check(`demo:ip:${ip}`, DEMOS_PER_IP);
      if ((await this.sandboxes.activeDemos()) >= this.env.DEMO_MAX_SANDBOXES) {
        throw new ServiceUnavailableException({
          code: "demo_full",
          message: "A demonstração está cheia agora. Tente de novo em alguns minutos.",
        });
      }
      this.limiter.hit(`demo:ip:${ip}`, DEMOS_PER_IP);
      sandboxId = await this.build();
    }
    const person = await this.db.user.findFirstOrThrow({
      where: { sandboxId, email: emailOf(persona, sandboxId) },
      select: { id: true },
    });
    if (viewer) await this.db.session.deleteMany({ where: { id: viewer.sessionId } });
    await this.sessions.start(reply, person.id);
    return this.profiles.me(person.id);
  }

  /** The emails the demo's people got (none leave the server): the demo's inbox. */
  async emails(viewer: AuthUser): Promise<DemoEmail[]> {
    if (!viewer.sandboxId) return [];
    const emails = await this.db.sentEmail.findMany({
      where: { sandboxId: viewer.sandboxId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    const people = await this.db.user.findMany({
      where: { sandboxId: viewer.sandboxId },
      select: { id: true, name: true },
    });
    const names = new Map(people.map((person) => [person.id, person.name]));
    return emails.map((email) => ({
      id: email.id,
      to: (email.userId && names.get(email.userId)) ?? email.to,
      subject: email.subject,
      text: email.text,
      createdAt: email.createdAt.toISOString(),
    }));
  }

  /** Whether the demo's orders are written yet (or their writing gave up). */
  async status(viewer: AuthUser): Promise<DemoStatus> {
    if (!viewer.sandboxId) return { ready: true };
    const event = await this.db.outboxEvent.findFirst({
      where: { type: DEMO_EVENTS.seed, sandboxId: viewer.sandboxId },
      select: { processedAt: true, failedAt: true },
    });
    return { ready: !event || event.processedAt !== null || event.failedAt !== null };
  }

  /** A new demo: its sandbox, its two people, a coupon of its own; the story follows in the background. */
  private async build(): Promise<string> {
    const now = this.clock.now();
    const sandboxId = await transaction(this.db, async (tx) => {
      const id = await this.sandboxes.create(tx, DEMO_LIFETIME_MS);
      for (const persona of ["customer", "admin"] as const) {
        await tx.user.create({
          data: {
            id: uuidv7(now.getTime()),
            email: emailOf(persona, id),
            name: PEOPLE[persona],
            role: persona,
            emailVerifiedAt: now,
            sandboxId: id,
            createdAt: now,
          },
        });
      }
      await tx.coupon.create({
        data: {
          id: uuidv7(now.getTime()),
          sandboxId: id,
          code: "DEMO15",
          kind: "percent",
          value: 15,
          createdAt: now,
        },
      });
      await this.outbox.add(tx, DEMO_EVENTS.seed, { sandboxId: id }, { sandboxId: id });
      return id;
    });
    this.outbox.committed();
    this.logger.log(`demo sandbox ${sandboxId} opened`);
    return sandboxId;
  }

  /** The starting story (once: a retry after a failure doesn't tell it twice). */
  private async tellStory(sandboxId: string): Promise<void> {
    if ((await this.db.order.count({ where: { sandboxId } })) > 0) return;
    const [customer, admin] = await Promise.all(
      (["customer", "admin"] as const).map((persona) =>
        this.db.user.findFirstOrThrow({ where: { sandboxId, email: emailOf(persona, sandboxId) } }),
      ),
    );
    const shopper = actor(customer!, sandboxId);
    const demoAdmin = { user: actor(admin!, sandboxId), scope: "demo" as const, sandboxId };
    const cart = await this.db.cart.upsert({
      where: { userId: customer!.id },
      create: {
        id: uuidv7(this.clock.now().getTime()),
        userId: customer!.id,
        sandboxId,
        updatedAt: this.clock.now(),
      },
      update: {},
    });

    for (const chapter of STORY) {
      const variants = await this.db.variant.findMany({
        where: { sku: { in: chapter.items.map(([sku]) => sku) }, sandboxId: null, active: true },
      });
      if (variants.length === 0) continue;
      const now = this.clock.now();
      for (const [sku, quantity] of chapter.items) {
        const variant = variants.find((candidate) => candidate.sku === sku);
        if (!variant) continue;
        await this.db.cartItem.upsert({
          where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
          create: {
            cartId: cart.id,
            variantId: variant.id,
            quantity,
            seenPriceCents: variant.priceCents,
            createdAt: now,
          },
          update: { quantity, seenPriceCents: variant.priceCents },
        });
      }
      const ships = variants.some((variant) => variant.weightGrams !== null);
      const order = await this.orders.place(shopper, {
        address: ships ? ADDRESS : undefined,
        shippingService: chapter.service,
        couponCode: chapter.coupon,
      });
      if (!chapter.pay) continue;
      await this.payments.start(shopper, order.id);
      const { paymentIntentId } = await this.db.order.findUniqueOrThrow({ where: { id: order.id } });
      await this.gateway.payWithTestCard(paymentIntentId!);
      await this.payments.reconcile(order.id);
      if (chapter.deliver) {
        await this.adminOrders.prepare(demoAdmin, order.id);
        await this.adminOrders.ship(demoAdmin, order.id, chapter.deliver);
        await this.adminOrders.deliver(demoAdmin, order.id);
      }
    }
    this.logger.log(`demo sandbox ${sandboxId}: story told`);
  }
}

function emailOf(persona: DemoPersona, sandboxId: string): string {
  return `${persona}.${sandboxId}@demo.torra.invalid`;
}

/** Someone acting in the demo's sandbox, without a browser session. */
function actor(
  user: { id: string; name: string; email: string; role: "customer" | "admin" },
  sandboxId: string,
): AuthUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role, sandboxId, sessionId: "" };
}
