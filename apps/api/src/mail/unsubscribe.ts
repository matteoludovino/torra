import { Inject, Injectable } from "@nestjs/common";
import { EMAIL_CATEGORIES, type EmailCategory } from "@torra/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV, type Env } from "../env.ts";

/**
 * Unsubscribe links: "<userId>:<category>" signed with HMAC-SHA256. They act without a session (from an
 * email client's one-click button, too), so the signature is what proves the link came from us. They
 * don't expire: an old email's link should still work.
 */
@Injectable()
export class UnsubscribeTokens {
  constructor(@Inject(ENV) private readonly env: Env) {}

  sign(userId: string, category: EmailCategory): string {
    const body = Buffer.from(`${userId}:${category}`).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  verify(token: string): { userId: string; category: EmailCategory } | null {
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const [userId, category] = Buffer.from(body, "base64url").toString().split(":");
    if (!userId || !(EMAIL_CATEGORIES as readonly string[]).includes(category ?? "")) return null;
    return { userId, category: category as EmailCategory };
  }

  private mac(body: string): string {
    return createHmac("sha256", this.env.SIGNING_SECRET).update(`unsubscribe:${body}`).digest("base64url");
  }
}
