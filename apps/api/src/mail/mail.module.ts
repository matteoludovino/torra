import { Module } from "@nestjs/common";
import { EmailsController } from "./emails.controller.ts";
import { Mailer } from "./mailer.service.ts";
import { UnsubscribeTokens } from "./unsubscribe.ts";

@Module({ controllers: [EmailsController], providers: [Mailer, UnsubscribeTokens], exports: [Mailer] })
export class MailModule {}
