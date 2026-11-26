import { Body, Controller, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import { FAKE_OUTCOMES, type OrderView, type PaymentStart } from "@torra/shared";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { CurrentUser, Public, type AuthUser } from "../auth/auth-user.ts";
import { uuidParam } from "../common/params.ts";
import { RateLimiter } from "../common/rate-limiter.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { Payments } from "../payments/payments.service.ts";
import { Downloads } from "./downloads.ts";
import { Orders } from "./orders.service.ts";

const orderId = uuidParam("Pedido não encontrado.");
const simulateInput = z.object({ outcome: z.enum(FAKE_OUTCOMES) });

/** Paying for an order, and downloading what was bought. */
@Controller()
export class OrderPaymentsController {
  constructor(
    private readonly payments: Payments,
    private readonly orders: Orders,
    private readonly downloads: Downloads,
    private readonly limiter: RateLimiter,
  ) {}

  /** The card form's PaymentIntent (created once), or a free order settled. */
  @Post("orders/:id/payment")
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<PaymentStart> {
    this.limiter.hit(`payments:start:${user.id}`, { max: 20, windowMs: 10 * 60_000 });
    return this.payments.start(user, id);
  }

  /** Back from the card form: asks Stripe now, and answers with the order as it stands. */
  @Post("orders/:id/payment/sync")
  @HttpCode(200)
  async sync(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<OrderView> {
    this.limiter.hit(`payments:sync:${user.id}`, { max: 30, windowMs: 60_000 });
    await this.payments.sync(user, id);
    return this.orders.view(user, id);
  }

  /** The fake gateway's card form (404 with Stripe). */
  @Post("orders/:id/payment/simulate")
  @HttpCode(200)
  simulate(
    @CurrentUser() user: AuthUser,
    @Param("id", orderId) id: string,
    @Body(new ZodPipe(simulateInput)) body: z.infer<typeof simulateInput>,
  ): Promise<{ error: string | null }> {
    return this.payments.simulate(user, id, body.outcome);
  }

  /** A purchased file, by its signed link (no session needed: it opens as a plain link). */
  @Public()
  @Get("downloads/:token")
  async download(@Param("token") token: string, @Res() reply: FastifyReply): Promise<void> {
    const file = await this.downloads.file(token);
    await reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${file.name}"`)
      .header("cache-control", "private, no-store")
      .send(file.body);
  }
}
