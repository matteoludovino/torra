import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ENV, type Env } from "../env.ts";
import { Mailer } from "../mail/mailer.service.ts";
import { resetPassword, verifyEmail } from "../mail/templates.ts";
import { OutboxService } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { EmailTokens } from "./email-tokens.ts";

/** Outbox events about accounts. Each carries only a user id: tokens are minted when the email is sent. */
export const ACCOUNT_EVENTS = {
  verifyRequested: "account.verify_requested",
  resetRequested: "account.reset_requested",
} as const;

/**
 * Sends the account emails. Tokens are created here rather than in the request, so no usable link is
 * ever stored in plain text in the outbox; a retry simply mints another one.
 */
@Injectable()
export class AccountEmails implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly outbox: OutboxService,
    private readonly tokens: EmailTokens,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.outbox.handle(ACCOUNT_EVENTS.verifyRequested, async ({ payload }) => {
      const user = await this.user(payload);
      if (!user || user.emailVerifiedAt || user.suspendedAt) return;
      const token = await this.tokens.issue(user.id, "verify_email");
      await this.mailer.send(
        this.recipient(user),
        "verify_email",
        verifyEmail(user.name, this.link("/verificar", token)),
      );
    });
    this.outbox.handle(ACCOUNT_EVENTS.resetRequested, async ({ payload }) => {
      const user = await this.user(payload);
      if (!user || user.suspendedAt) return;
      const token = await this.tokens.issue(user.id, "reset_password");
      await this.mailer.send(
        this.recipient(user),
        "reset_password",
        resetPassword(user.name, this.link("/redefinir-senha", token)),
      );
    });
  }

  /** The token goes in the fragment: browsers don't send it to any server or in a Referer. */
  private link(path: string, token: string): string {
    const url = new URL(path, this.env.WEB_URL);
    url.hash = `t=${token}`;
    return url.href;
  }

  private user(payload: unknown) {
    const { userId } = payload as { userId: string };
    return this.db.user.findUnique({ where: { id: userId } });
  }

  private recipient(user: { id: string; email: string; sandboxId: string | null }) {
    return { userId: user.id, email: user.email, sandboxId: user.sandboxId };
  }
}
