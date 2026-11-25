import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { uuidv7 } from "../common/ids.ts";
import { hashToken, newToken } from "../common/secrets.ts";
import { ENV, type Env } from "../env.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";
import type { AuthUser } from "./auth-user.ts";

export const SESSION_COOKIE = "torra_session";
const DAY = 24 * 60 * 60 * 1000;
const LIFETIME_MS = 30 * DAY;
/** A session used with less than this left is extended to the full lifetime again. */
const RENEW_BELOW_MS = 15 * DAY;

/**
 * Sessions are rows; the browser holds a random token in an httpOnly, SameSite=Lax cookie, and only its
 * hash is stored. Signing out deletes the row; resetting the password deletes all of a user's rows.
 */
@Injectable()
export class Sessions {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Creates a session (inside the caller's transaction, if any) and sets its cookie. */
  async start(reply: FastifyReply, userId: string, tx: Tx = this.db): Promise<void> {
    const token = newToken();
    const now = this.clock.now();
    await tx.session.create({
      data: {
        id: uuidv7(now.getTime()),
        tokenHash: hashToken(token),
        userId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + LIFETIME_MS),
      },
    });
    this.setCookie(reply, token);
  }

  /** The user behind the request's cookie, or null (no cookie, unknown, expired or suspended). */
  async resolve(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    const now = this.clock.now();
    if (!session || session.expiresAt <= now || session.user.suspendedAt) {
      this.clearCookie(reply);
      return null;
    }
    if (session.expiresAt.getTime() - now.getTime() < RENEW_BELOW_MS) {
      await this.db.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(now.getTime() + LIFETIME_MS) },
      });
      this.setCookie(reply, token);
    }
    const { user } = session;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      sandboxId: user.sandboxId,
      sessionId: session.id,
    };
  }

  async end(reply: FastifyReply, sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
    this.clearCookie(reply);
  }

  private setCookie(reply: FastifyReply, token: string): void {
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.env.NODE_ENV === "production",
      path: "/",
      maxAge: LIFETIME_MS / 1000,
    });
  }

  private clearCookie(reply: FastifyReply): void {
    void reply.clearCookie(SESSION_COOKIE, { path: "/" });
  }
}
