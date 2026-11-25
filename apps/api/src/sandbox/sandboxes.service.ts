import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { uuidv7 } from "../common/ids.ts";
import { transaction } from "../common/transactions.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Scheduler } from "../scheduler/scheduler.service.ts";
import { Clock } from "../time/clock.ts";

/** How long a one-click demo lasts. */
export const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;
const BATCH = 5;

/**
 * Sandboxes: every customer's private corner of the store. A signed-up customer's is kept; a demo's goes
 * after a day, and with it everything written in it (its people and, through them, everything they own;
 * its emails and outbox events; its audit trail).
 */
@Injectable()
export class Sandboxes implements OnModuleInit {
  private readonly logger = new Logger("Sandboxes");

  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "sandbox-expiry",
      run: (now) => this.expire(now),
      nextDueAt: async () =>
        (
          await this.db.sandbox.findFirst({
            where: { expiresAt: { not: null } },
            orderBy: { expiresAt: "asc" },
            select: { expiresAt: true },
          })
        )?.expiresAt ?? null,
    });
  }

  /** A new sandbox, in the caller's transaction: kept (`lifetimeMs` null) or gone after `lifetimeMs`. */
  async create(tx: Tx, lifetimeMs: number | null): Promise<string> {
    const now = this.clock.now();
    const { id } = await tx.sandbox.create({
      data: {
        id: uuidv7(now.getTime()),
        createdAt: now,
        expiresAt: lifetimeMs === null ? null : new Date(now.getTime() + lifetimeMs),
      },
    });
    return id;
  }

  /** Demo sandboxes alive right now: the demo's global cap counts these. */
  activeDemos(now = this.clock.now()): Promise<number> {
    return this.db.sandbox.count({ where: { expiresAt: { gt: now } } });
  }

  /** Removes the demos whose day is over. */
  async expire(now: Date): Promise<number> {
    const due = await this.db.sandbox.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
      take: BATCH,
      select: { id: true },
    });
    for (const { id } of due) {
      try {
        await this.remove(id);
      } catch (error) {
        this.logger.error(`removing sandbox ${id} failed: ${error instanceof Error ? error.message : error}`);
        return 0; // try again on the next sweep, rather than spinning on the same one
      }
    }
    return due.length;
  }

  /**
   * One transaction. Append-only tables refuse deletes except under the purge setting, set here for this
   * transaction only. Then the sandbox itself: the rest cascades.
   */
  async remove(id: string): Promise<void> {
    await transaction(this.db, async (tx) => {
      await tx.$executeRaw`SELECT set_config('torra.purge', 'on', true)`;
      await tx.$executeRaw`DELETE FROM audit_entries WHERE "sandboxId" = ${id}::uuid`;
      await tx.sandbox.delete({ where: { id } });
    });
  }
}
