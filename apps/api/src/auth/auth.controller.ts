import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { emailInput, loginInput, resetInput, signupInput, verifyInput, type Me } from "@torra/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { ZodPipe } from "../common/zod.pipe.ts";
import { Accounts } from "./accounts.service.ts";
import { CurrentUser, Public, type AuthUser } from "./auth-user.ts";
import { Sessions } from "./sessions.service.ts";

/** What resend and "forgot password" always answer, whatever the address. */
export interface Accepted {
  ok: true;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly accounts: Accounts,
    private readonly sessions: Sessions,
  ) {}

  @Public()
  @Post("signup")
  signup(
    @Body(new ZodPipe(signupInput)) body: z.infer<typeof signupInput>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Me> {
    return this.accounts.signup(body, request.ip, reply);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(
    @Body(new ZodPipe(loginInput)) body: z.infer<typeof loginInput>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Me> {
    return this.accounts.login(body, request.ip, reply);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.end(reply, user.sessionId);
  }

  @Public()
  @Post("verify")
  @HttpCode(200)
  verify(
    @Body(new ZodPipe(verifyInput)) body: z.infer<typeof verifyInput>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Me> {
    return this.accounts.verify(body.token, request.ip, reply);
  }

  @Public()
  @Post("resend-verification")
  @HttpCode(202)
  async resend(
    @Body(new ZodPipe(emailInput)) body: z.infer<typeof emailInput>,
    @Req() request: FastifyRequest,
  ): Promise<Accepted> {
    await this.accounts.resendVerification(body.email, request.ip);
    return { ok: true };
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(202)
  async forgot(
    @Body(new ZodPipe(emailInput)) body: z.infer<typeof emailInput>,
    @Req() request: FastifyRequest,
  ): Promise<Accepted> {
    await this.accounts.forgotPassword(body.email, request.ip);
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  reset(
    @Body(new ZodPipe(resetInput)) body: z.infer<typeof resetInput>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Me> {
    return this.accounts.resetPassword(body, request.ip, reply);
  }
}
