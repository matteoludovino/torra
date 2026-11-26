import type { Me } from "@torra/shared";
import { createApp } from "../src/bootstrap.ts";
import { uuidv7 } from "../src/common/ids.ts";
import { hashToken, newToken } from "../src/common/secrets.ts";
import { loadEnv } from "../src/env.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { seedId } from "../src/seed/seed.ts";
import type { Clock } from "../src/time/clock.ts";

export const ORIGIN = "http://localhost:3040";

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    DATABASE_URL: process.env["DATABASE_URL"]!,
    WEB_ORIGINS: ORIGIN,
    SCHEDULER: "off",
    ...overrides,
  });
}

export function testApp(overrides: Record<string, string> = {}, { clock }: { clock?: Clock } = {}) {
  return createApp(testEnv(overrides), { logger: false, clock });
}

/** Empties every table that tests write (the schema stays). */
export async function resetDb(db: PrismaService): Promise<void> {
  // Append-only tables (the audit log, stock movements) are cleared the one way the database allows (a purge, for this
  // transaction only).
  await db.$transaction([
    db.$executeRawUnsafe(`SELECT set_config('torra.purge', 'on', true)`),
    db.$executeRawUnsafe(
      `TRUNCATE users, sandboxes, sessions, email_tokens, sent_emails, outbox_events, audit_entries,
        products, variants, stock_levels, stock_movements, carts, cart_items, coupons, coupon_redemptions, orders, order_items, order_events RESTART IDENTITY CASCADE`,
    ),
  ]);
}

let addresses = 0;

/**
 * A browser for tests: its own client address (rate limits are per address), the web app's Origin on
 * every request, and a cookie jar.
 */
export class Browser {
  readonly ip = `10.0.${Math.floor(++addresses / 250)}.${addresses % 250}`;
  /** Every cookie the API set (the session's, the visitor cart's), sent back as a browser would. */
  readonly cookies = new Map<string, string>();

  constructor(private readonly app: App) {}

  /** The session cookie, for tests that swap it by hand. */
  get cookie(): string | null {
    return this.cookies.get("torra_session") ?? null;
  }
  set cookie(value: string | null) {
    if (value) this.cookies.set("torra_session", value);
    else this.cookies.delete("torra_session");
  }

  async request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) {
    const jar = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: { origin: ORIGIN, ...(jar ? { cookie: jar } : {}) },
      ...(payload ? { payload } : {}),
    });
    for (const set of response.cookies) {
      if (set.value) this.cookies.set(set.name, set.value);
      else this.cookies.delete(set.name);
    }
    return response;
  }

  get = (url: string) => this.request("GET", url);
  post = (url: string, payload?: object) => this.request("POST", url, payload ?? {});
  put = (url: string, payload: object) => this.request("PUT", url, payload);
  patch = (url: string, payload: object) => this.request("PATCH", url, payload);
  delete = (url: string) => this.request("DELETE", url);
}

export type App = Awaited<ReturnType<typeof testApp>>;

/** The emails kept for an address (no SMTP in tests), oldest first, after the outbox has run. */
export async function emailsTo(app: App, to: string) {
  await app.get(Scheduler).runOnce();
  return app.get(PrismaService).sentEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });
}

/** The token in the last emailed link of a kind ("#t=…"). */
export async function linkToken(app: App, to: string, kind: string): Promise<string> {
  const emails = (await emailsTo(app, to)).filter((email) => email.kind === kind);
  const match = emails.at(-1)?.text.match(/#t=([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error(`no ${kind} link sent to ${to}`);
  return match[1]!;
}

/** Signs up (which signs in, in a new sandbox of their own) and returns the browser. */
export async function customer(app: App, name = "Ana Souza", email = `ana.${addresses}@exemplo.com`) {
  const browser = new Browser(app);
  const response = await browser.post("/api/auth/signup", { name, email, password: PASSWORD });
  if (response.statusCode !== 201) throw new Error(`signup failed: ${response.body}`);
  const me = response.json() as Me;
  const { sandboxId } = await app.get(PrismaService).user.findUniqueOrThrow({ where: { id: me.id } });
  return { browser, email, me, sandboxId: sandboxId! };
}

export const PASSWORD = "senha-boa-123";

/**
 * Someone written straight to the database, signed in through a session row: an admin of the store (no
 * sandbox) or of a demo's sandbox, or a customer (in the given sandbox, or a new one of their own).
 */
export async function directUser(
  app: App,
  { sandboxId = null as string | null, name = "Bruno Lima", role = "customer" as "customer" | "admin" } = {},
) {
  const db = app.get(PrismaService);
  const id = uuidv7();
  if (role === "customer" && !sandboxId) {
    sandboxId = (await db.sandbox.create({ data: { id: uuidv7() } })).id;
  }
  await db.user.create({
    data: { id, email: `${id}@teste.torra`, name, role, sandboxId, emailVerifiedAt: new Date() },
  });
  const token = newToken();
  await db.session.create({
    data: {
      id: uuidv7(),
      tokenHash: hashToken(token),
      userId: id,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    },
  });
  const browser = new Browser(app);
  browser.cookie = token;
  return { id, browser, sandboxId };
}

/** A signed-in admin of the store itself (no sandbox), or of a demo's sandbox. */
export async function admin(app: App, sandboxId: string | null = null) {
  return directUser(app, { sandboxId, name: "Admin", role: "admin" });
}

/**
 * A real order to hang stock movements or a coupon use on, in a sandbox (by a customer of it, made here
 * unless given): one seeded e-book, already cancelled. Needs the seeded catalog.
 */
export async function bareOrder(app: App, sandboxId: string, userId?: string): Promise<string> {
  const db = app.get(PrismaService);
  if (!userId) {
    userId = uuidv7();
    await db.user.create({
      data: { id: userId, email: `${userId}@teste.torra`, name: "Cliente", role: "customer", sandboxId },
    });
  }
  const id = uuidv7();
  await db.order.create({
    data: {
      id,
      userId,
      sandboxId,
      email: `${userId}@teste.torra`,
      status: "canceled",
      subtotalCents: 2900,
      discountCents: 0,
      shippingCents: 0,
      totalCents: 2900,
      expiresAt: new Date(),
      closedAt: new Date(),
      createdAt: new Date(),
      items: {
        create: {
          id: uuidv7(),
          variantId: seedId("variant:EBOOK-GELADO"),
          kind: "digital",
          title: "E-book",
          options: "",
          sku: "EBOOK-GELADO",
          unitPriceCents: 2900,
          quantity: 1,
          lineTotalCents: 2900,
          discountCents: 0,
          position: 0,
        },
      },
    },
  });
  return id;
}
