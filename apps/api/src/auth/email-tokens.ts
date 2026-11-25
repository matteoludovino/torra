import { Injectable } from "@nestjs/common";
import { uuidv7 } from "../common/ids.ts";
import { hashToken, newToken } from "../common/secrets.ts";
import type { EmailTokenPurpose } from "../generated/prisma/client.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";

const HOUR = 60 * 60 * 1000;
export const TOKEN_LIFETIME: Record<EmailTokenPurpose, number> = {
  verify_email: 48 * HOUR,
  reset_password: 1 * HOUR,
};

/** Links sent by email: random, stored hashed, valid for a while, usable once. */
@Injectable()
export class EmailTokens {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** A new token; the plain value exists only in the email that carries it. */
  async issue(userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const token = newToken();
    const now = this.clock.now();
    await this.db.emailToken.create({
      data: {
        id: uuidv7(now.getTime()),
        tokenHash: hashToken(token),
        userId,
        purpose,
        createdAt: now,
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIME[purpose]),
      },
    });
    return token;
  }

  /**
   * Uses a token up and returns its user, or null if it's unknown, expired or already used. The
   * conditional update makes "used once" hold even for two clicks at the same moment.
   */
  async consume(tx: Tx, token: string, purpose: EmailTokenPurpose): Promise<string | null> {
    const now = this.clock.now();
    const found = await tx.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!found || found.purpose !== purpose || found.expiresAt <= now) return null;
    const { count } = await tx.emailToken.updateMany({
      where: { id: found.id, usedAt: null },
      data: { usedAt: now },
    });
    if (count === 0) return null;
    // The other links of the same kind stop working too.
    await tx.emailToken.updateMany({
      where: { userId: found.userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    return found.userId;
  }
}
