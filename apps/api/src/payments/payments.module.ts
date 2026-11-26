import { Module } from "@nestjs/common";
import { ENV, type Env } from "../env.ts";
import { FakeGateway } from "./fake.gateway.ts";
import { PaymentGateway } from "./gateway.ts";
import { Payments } from "./payments.service.ts";
import { StripeGateway } from "./stripe.gateway.ts";
import { WebhookController } from "./webhook.controller.ts";

/** Payments: the gateway (Stripe in test mode, or the fake), reconciliation, Stripe's webhook. */
@Module({
  controllers: [WebhookController],
  providers: [
    {
      provide: PaymentGateway,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.PAYMENT_GATEWAY === "stripe" ? new StripeGateway(env.STRIPE_SECRET_KEY!) : new FakeGateway(),
    },
    Payments,
  ],
  exports: [Payments, PaymentGateway],
})
export class PaymentsModule {}
