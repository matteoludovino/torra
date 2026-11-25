import { Injectable } from "@nestjs/common";
import type { AuditEntryView } from "@torra/shared";
import type { AuthUser } from "../auth/auth-user.ts";
import { uuidv7 } from "../common/ids.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";

/**
 * What admins did and read. Written in the same transaction as the action itself, so an action without
 * its entry can't happen; the database refuses to change or delete entries afterwards.
 */
@Injectable()
export class Audit {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
  ) {}

  async record(
    tx: Tx,
    actor: AuthUser,
    action: string,
    target: { type: string; id: string | null },
    details: Prisma.InputJsonObject = {},
  ): Promise<void> {
    const now = this.clock.now();
    await tx.auditEntry.create({
      data: {
        id: uuidv7(now.getTime()),
        actorId: actor.id,
        action,
        targetType: target.type,
        targetId: target.id,
        details,
        sandboxId: actor.sandboxId,
        createdAt: now,
      },
    });
  }

  /** The latest entries of the admin's own corner (real admins: the real marketplace). */
  async recent(admin: AuthUser, take = 100): Promise<AuditEntryView[]> {
    const entries = await this.db.auditEntry.findMany({
      where: { sandboxId: admin.sandboxId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
    const actors = await this.db.user.findMany({
      where: { id: { in: [...new Set(entries.map((entry) => entry.actorId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(actors.map((actor) => [actor.id, actor.name]));
    return entries.map((entry) => ({
      id: entry.id,
      actor: { id: entry.actorId, name: names.get(entry.actorId) ?? "—" },
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details as Record<string, unknown>,
      createdAt: entry.createdAt.toISOString(),
    }));
  }
}
