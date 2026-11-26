import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CartsModule } from "../cart/carts.module.ts";
import { MailModule } from "../mail/mail.module.ts";
import { ProfilesController } from "../profiles/profiles.controller.ts";
import { Profiles } from "../profiles/profiles.service.ts";
import { Sandboxes } from "../sandbox/sandboxes.service.ts";
import { AccountEmails } from "./account-emails.ts";
import { Accounts } from "./accounts.service.ts";
import { AuthController } from "./auth.controller.ts";
import { EmailTokens } from "./email-tokens.ts";
import { SandboxWriteLimitGuard, OriginGuard, SessionGuard } from "./guards.ts";
import { Passwords } from "./passwords.ts";
import { Sessions } from "./sessions.service.ts";

/** Accounts, sessions and sandboxes. Its guards apply to every route of the API, in this order. */
@Module({
  imports: [MailModule, CartsModule],
  controllers: [AuthController, ProfilesController],
  providers: [
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: SandboxWriteLimitGuard },
    Accounts,
    AccountEmails,
    EmailTokens,
    Passwords,
    Profiles,
    Sandboxes,
    Sessions,
  ],
  exports: [Sessions, Profiles, Sandboxes],
})
export class AccountsModule {}
