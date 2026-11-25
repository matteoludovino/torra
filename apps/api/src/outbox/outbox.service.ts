import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Scheduler } from "../scheduler/scheduler.service.ts";
import { Clock } from "../time/clock.ts";

/** Anything that can run queries: the client itself, or an interactive transaction. */
export type Tx = Prisma.TransactionClient;

export interface OutboxRecord {
  id: bigint;
  type: string;
  payload: unknown;
  sandboxId: string | null;
  attempts: number;
}

export type OutboxHandler = (event: OutboxRecord) => Promise<void>;

const BATCH = 20;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 8;

/**
 * The transactional outbox: `add` writes an event in the caller's transaction (it exists if and only if the
 * change committed); a sweep hands each due event to its handler once. Claiming uses FOR UPDATE SKIP LOCKED
 * plus a lease, so two sweeps (or two processes) never take the same row; failures retry with backoff.
 */
@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger("Outbox");
  private readonly handlers = new Map<string, OutboxHandler>();

  constructor(
    private readonly db: PrismaService,
    private readonly scheduler: Scheduler,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "outbox",
      run: (now) => this.drain(now),
      nextDueAt: async () => {
        const next = await this.db.outboxEvent.findFirst({
          where: { processedAt: null, failedAt: null },
          orderBy: { dueAt: "asc" },
          select: { dueAt: true, lockedUntil: true },
        });
        if (!next) return null;
        return next.lockedUntil && next.lockedUntil > next.dueAt ? next.lockedUntil : next.dueAt;
      },
    });
  }

  handle(type: string, handler: OutboxHandler): void {
    if (this.handlers.has(type)) throw new Error(`Outbox handler for ${type} registered twice`);
    this.handlers.set(type, handler);
  }

  /** Writes an event inside the caller's transaction. Call `committed()` once that transaction is done. */
  async add(
    tx: Tx,
    type: string,
    payload: Prisma.InputJsonValue,
    { dueAt, sandboxId = null }: { dueAt?: Date; sandboxId?: string | null } = {},
  ): Promise<void> {
    // Due "now" by the application's clock, the one sweeps compare with (not the database's).
    await tx.outboxEvent.create({ data: { type, payload, sandboxId, dueAt: dueAt ?? this.clock.now() } });
  }

  /** New events were committed: let the scheduler pick them up now. */
  committed(): void {
    this.scheduler.kick();
  }

  /** Handles up to one batch of due events; returns how many were taken. */
  async drain(now: Date): Promise<number> {
    const claimed = await this.db.$queryRaw<
      { id: bigint; type: string; payload: unknown; sandboxId: string | null; attempts: number }[]
    >`
      UPDATE outbox_events SET "lockedUntil" = ${new Date(now.getTime() + LEASE_MS)}
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "dueAt" <= ${now}
          AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
        ORDER BY "dueAt", id
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, "sandboxId", attempts`;

    for (const event of claimed) {
      const handler = this.handlers.get(event.type);
      try {
        if (!handler) throw new Error(`no handler for ${event.type}`);
        await handler(event);
        await this.db.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: now, lockedUntil: null },
        });
      } catch (error) {
        const attempts = event.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        const giveUp = attempts >= MAX_ATTEMPTS;
        this.logger.warn(`${event.type} #${event.id} failed (attempt ${attempts}): ${message}`);
        await this.db.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts,
            lastError: message.slice(0, 500),
            lockedUntil: null,
            // Backoff: 1, 2, 4… minutes, at most an hour.
            dueAt: new Date(now.getTime() + Math.min(2 ** (attempts - 1), 60) * 60_000),
            ...(giveUp ? { failedAt: now } : {}),
          },
        });
      }
    }
    return claimed.length;
  }
}
