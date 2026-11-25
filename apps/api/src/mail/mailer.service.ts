import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { uuidv7 } from "../common/ids.ts";
import { ENV, type Env } from "../env.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";
import { EMAIL_CATEGORY_LABELS } from "@torra/shared";
import { categoryOf } from "./categories.ts";
import { withUnsubscribe, type Email } from "./templates.ts";
import { UnsubscribeTokens } from "./unsubscribe.ts";

export interface Recipient {
  userId: string;
  email: string;
  sandboxId: string | null;
}

/**
 * Sends email over SMTP (Mailpit locally). Customers get real email (every customer has a sandbox; only a
 * demo's, which expires, keeps its email for the visitor to read in the demo's inbox). Without an SMTP
 * server, everything is kept. Called from outbox handlers, so a failure here is retried later.
 */
@Injectable()
export class Mailer implements OnModuleDestroy {
  private readonly logger = new Logger("Mailer");
  private readonly transport: Transporter | null;

  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly tokens: UnsubscribeTokens,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.transport = env.SMTP_URL ? createTransport(env.SMTP_URL) : null;
  }

  /**
   * Sends (or keeps) one email. An email someone can turn off isn't sent if they did, and carries a
   * signed unsubscribe link, plus the one-click headers email clients show as an "unsubscribe" button.
   */
  async send(to: Recipient, kind: string, original: Email): Promise<void> {
    const category = categoryOf(kind);
    let email = withUnsubscribe(original, null);
    let headers: Record<string, string> = {};
    if (category) {
      const person = await this.db.user.findUnique({
        where: { id: to.userId },
        select: { emailOptOuts: true },
      });
      if (person?.emailOptOuts.includes(category)) return;
      const token = this.tokens.sign(to.userId, category);
      const oneClick = new URL(`/api/email/unsubscribe/one-click?token=${token}`, this.env.WEB_URL).href;
      email = withUnsubscribe(original, {
        label: EMAIL_CATEGORY_LABELS[category].label,
        unsubscribe: new URL(`/descadastro#t=${token}`, this.env.WEB_URL).href,
        preferences: new URL("/conta/emails", this.env.WEB_URL).href,
      });
      headers = {
        "List-Unsubscribe": `<${oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    }
    if (this.transport && !(await this.inDemo(to.sandboxId))) {
      await this.transport.sendMail({
        from: this.env.MAIL_FROM,
        to: to.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers,
      });
      this.logger.log(`sent ${kind} to user ${to.userId}`);
      return;
    }
    const now = this.clock.now();
    await this.db.sentEmail.create({
      data: {
        id: uuidv7(now.getTime()),
        sandboxId: to.sandboxId,
        userId: to.userId,
        to: to.email,
        kind,
        subject: email.subject,
        text: email.text,
        html: email.html,
        createdAt: now,
      },
    });
  }

  /** A demo's sandbox expires (a customer's doesn't); one already gone counts as a demo: never send. */
  private async inDemo(sandboxId: string | null): Promise<boolean> {
    if (!sandboxId) return false;
    const sandbox = await this.db.sandbox.findUnique({
      where: { id: sandboxId },
      select: { expiresAt: true },
    });
    return !sandbox || sandbox.expiresAt !== null;
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }
}
