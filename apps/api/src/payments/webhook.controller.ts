import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  type RawBodyRequest,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import Stripe from "stripe";
import { AnyOrigin, Public } from "../auth/auth-user.ts";
import { ENV, type Env } from "../env.ts";
import { Payments } from "./payments.service.ts";

/**
 * Stripe's webhook. The signature is checked on the raw body (with a 5-minute tolerance against replays);
 * the event is kept once and handled later through the outbox, so Stripe gets its 200 at once. What the
 * event says is never used beyond which object it's about: the order asks Stripe for the current state.
 */
@Controller("payments")
export class WebhookController {
  constructor(
    private readonly payments: Payments,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @AnyOrigin()
  @Post("webhook")
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers("stripe-signature") signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!request.rawBody || !signature) {
      throw new BadRequestException({ code: "bad_signature", message: "Assinatura ausente." });
    }
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(request.rawBody, signature, this.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new BadRequestException({ code: "bad_signature", message: "Assinatura inválida." });
    }
    // This code only ever deals with test mode.
    if (event.livemode) {
      throw new BadRequestException({ code: "live_mode", message: "Eventos do modo real não são aceitos." });
    }
    const object = event.data.object as { id?: unknown };
    await this.payments.receive({
      id: event.id,
      type: event.type,
      objectId: typeof object.id === "string" ? object.id : "",
    });
    return { received: true };
  }
}
