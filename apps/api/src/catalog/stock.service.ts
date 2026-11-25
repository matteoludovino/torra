import { ConflictException, Injectable } from "@nestjs/common";
import { uuidv7 } from "../common/ids.ts";
import { Prisma, type StockMovementKind } from "../generated/prisma/client.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";

export interface Movement {
  variantId: string;
  /** Whose stock moves: null for the shared catalog's, or a sandbox's own copy. */
  sandboxId: string | null;
  kind: Exclude<StockMovementKind, "copy">;
  /** Signed. */
  quantity: number;
  orderId?: string;
  reason?: string;
  actorId?: string;
}

/** Thrown when a movement would take a level below zero; says which variant. */
export class OutOfStock extends ConflictException {
  constructor(readonly variantId: string) {
    super({ code: "out_of_stock", message: "Não há unidades suficientes em estoque.", variantId });
  }
}

/**
 * Stock, as movements: levels follow by trigger and never go below zero (both enforced by the database).
 *
 * Copy-on-write per sandbox: the first time a sandbox moves stock of a shared variant, its own level
 * starts from the shared balance at that moment (a `copy` movement), and from then on only its own level
 * moves. Customers never touch the shared catalog's stock, and never each other's.
 */
@Injectable()
export class Stock {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Records one movement in the caller's transaction. Callers moving several variants do it in variant id
   * order (the locks below are taken in that order, so two transactions never wait on each other in a
   * circle).
   */
  async move(tx: Tx, movement: Movement): Promise<void> {
    if (movement.sandboxId) await this.detach(tx, movement.variantId, movement.sandboxId);
    const now = this.clock.now();
    try {
      // A savepoint, so a failed movement leaves the transaction usable (the caller decides what's next).
      await tx.$executeRaw`SAVEPOINT stock_move`;
      await tx.stockMovement.create({
        data: {
          id: uuidv7(now.getTime()),
          variantId: movement.variantId,
          sandboxId: movement.sandboxId,
          kind: movement.kind,
          quantity: movement.quantity,
          orderId: movement.orderId ?? null,
          reason: movement.reason ?? null,
          actorId: movement.actorId ?? null,
          createdAt: now,
        },
      });
      await tx.$executeRaw`RELEASE SAVEPOINT stock_move`;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT stock_move`;
      if (isBelowZero(error)) throw new OutOfStock(movement.variantId);
      throw error;
    }
  }

  /**
   * Units available, per variant, in a corner of the store: the sandbox's own level once it has one,
   * the shared level otherwise; 0 when neither exists.
   */
  async available(db: Tx, variantIds: string[], sandboxId: string | null): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    const rows = await db.$queryRaw<{ id: string; available: number }[]>`
      SELECT v.id, COALESCE(own.available, shared.available, 0)::int AS available
      FROM variants v
      LEFT JOIN stock_levels shared ON shared."variantId" = v.id AND shared."sandboxId" IS NULL
      LEFT JOIN stock_levels own ON own."variantId" = v.id AND own."sandboxId" = ${sandboxId}::uuid
      WHERE v.id IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))})`;
    return new Map(rows.map((row) => [row.id, row.available]));
  }

  /**
   * The sandbox's own level of a shared variant, created from the shared balance if it has none yet.
   * The shared level's row lock makes two first touches at once copy only once.
   */
  private async detach(tx: Tx, variantId: string, sandboxId: string): Promise<void> {
    const [variant] = await tx.$queryRaw<{ sandboxId: string | null }[]>`
      SELECT "sandboxId" FROM variants WHERE id = ${variantId}::uuid`;
    if (!variant || variant.sandboxId !== null) return; // the sandbox's own product: nothing to copy
    const [shared] = await tx.$queryRaw<{ available: number }[]>`
      SELECT available FROM stock_levels
      WHERE "variantId" = ${variantId}::uuid AND "sandboxId" IS NULL FOR UPDATE`;
    const [own] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_levels WHERE "variantId" = ${variantId}::uuid AND "sandboxId" = ${sandboxId}::uuid`;
    if (own || !shared || shared.available === 0) return;
    const now = this.clock.now();
    await tx.stockMovement.create({
      data: {
        id: uuidv7(now.getTime()),
        variantId,
        sandboxId,
        kind: "copy",
        quantity: shared.available,
        reason: "Cópia do estoque da loja",
        createdAt: now,
      },
    });
  }

  /** Every level equals the sum of its movements (an empty list means it does). */
  async reconcile(): Promise<{ variantId: string; sandboxId: string | null; level: number; sum: number }[]> {
    return this.db.$queryRaw`
      SELECT l."variantId", l."sandboxId", l.available AS level, COALESCE(SUM(m.quantity), 0)::int AS sum
      FROM stock_levels l
      LEFT JOIN stock_movements m
        ON m."variantId" = l."variantId" AND m."sandboxId" IS NOT DISTINCT FROM l."sandboxId"
      GROUP BY l.id
      HAVING l.available <> COALESCE(SUM(m.quantity), 0)`;
  }
}

function isBelowZero(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("stock_levels_available_nonnegative");
}
