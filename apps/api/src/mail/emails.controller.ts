import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, Query } from "@nestjs/common";
import {
  EMAIL_CATEGORIES,
  emailPreferences,
  unsubscribeInput,
  type EmailCategory,
  type EmailPreferences,
} from "@torra/shared";
import type { z } from "zod";
import { AnyOrigin, CurrentUser, Public, type AuthUser } from "../auth/auth-user.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { UnsubscribeTokens } from "./unsubscribe.ts";

/** Which emails a person gets: their preferences page, and the links in the emails themselves. */
@Controller()
export class EmailsController {
  constructor(
    private readonly db: PrismaService,
    private readonly tokens: UnsubscribeTokens,
  ) {}

  @Get("me/email-preferences")
  async preferences(@CurrentUser() user: AuthUser): Promise<EmailPreferences> {
    const { emailOptOuts } = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { emailOptOuts: true },
    });
    return toPreferences(emailOptOuts);
  }

  @Put("me/email-preferences")
  async update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(emailPreferences)) body: EmailPreferences,
  ): Promise<EmailPreferences> {
    const optOuts = EMAIL_CATEGORIES.filter((category) => !body[category]);
    await this.db.user.update({ where: { id: user.id }, data: { emailOptOuts: optOuts } });
    return toPreferences(optOuts);
  }

  /** From the page an email's link opens (the person confirms there). */
  @Public()
  @Post("email/unsubscribe")
  @HttpCode(200)
  async unsubscribe(
    @Body(new ZodPipe(unsubscribeInput)) body: z.infer<typeof unsubscribeInput>,
  ): Promise<{ category: EmailCategory }> {
    return this.optOut(body.token, true);
  }

  /** Changed their mind on that same page. */
  @Public()
  @Post("email/resubscribe")
  @HttpCode(200)
  async resubscribe(
    @Body(new ZodPipe(unsubscribeInput)) body: z.infer<typeof unsubscribeInput>,
  ): Promise<{ category: EmailCategory }> {
    return this.optOut(body.token, false);
  }

  /** RFC 8058: the email client's own "unsubscribe" button posts here, from no web page at all. */
  @Public()
  @AnyOrigin()
  @Post("email/unsubscribe/one-click")
  @HttpCode(200)
  async oneClick(@Query("token") token: string | undefined): Promise<{ category: EmailCategory }> {
    return this.optOut(token ?? "", true);
  }

  private async optOut(token: string, out: boolean): Promise<{ category: EmailCategory }> {
    const link = this.tokens.verify(token);
    if (!link) {
      throw new BadRequestException({
        code: "invalid_link",
        message: "Este link de descadastro não é válido.",
      });
    }
    // Idempotent both ways: clicking twice changes nothing.
    await this.db.$executeRaw`
      UPDATE users SET "emailOptOuts" = CASE
        WHEN ${out} THEN array_append(array_remove(COALESCE("emailOptOuts", '{}'), ${link.category}), ${link.category})
        ELSE array_remove(COALESCE("emailOptOuts", '{}'), ${link.category}) END
      WHERE id = ${link.userId}::uuid`;
    return { category: link.category };
  }
}

function toPreferences(optOuts: string[]): EmailPreferences {
  return Object.fromEntries(
    EMAIL_CATEGORIES.map((category) => [category, !optOuts.includes(category)]),
  ) as EmailPreferences;
}
