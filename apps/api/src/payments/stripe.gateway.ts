import Stripe from "stripe";
import {
  PaymentGateway,
  UnexpectedIntentState,
  type CreateIntent,
  type CreateRefund,
  type Intent,
  type IntentStatus,
  type Refund,
} from "./gateway.ts";

/**
 * The API version this code was written against, fixed (the webhook endpoint in the Dashboard uses the
 * same one, so event payloads have the shape the SDK's types describe).
 */
export const STRIPE_API_VERSION = "2026-10-28.endive" as const;

/** Stripe's test mode limits requests per account: the API stays well under it, everywhere at once. */
const MIN_SPACING_MS = 100;

/** Stripe in test mode, through the official SDK. Never called inside a database transaction. */
export class StripeGateway extends PaymentGateway {
  readonly kind = "stripe" as const;
  private readonly stripe: Stripe;
  private nextSlot = 0;

  constructor(secretKey: string) {
    super();
    this.stripe = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 15_000,
      appInfo: { name: "Torra", url: "https://github.com/matteoludovino/torra" },
    });
  }

  async createIntent(input: CreateIntent): Promise<Intent> {
    await this.slot();
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: "brl",
        // Cards only: 3-D Secure, declines, refunds and disputes all have test cards.
        allowed_payment_method_types: ["card"],
        description: input.description,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return toIntent(intent);
  }

  async retrieveIntent(id: string): Promise<Intent> {
    await this.slot();
    return toIntent(await this.stripe.paymentIntents.retrieve(id));
  }

  async cancelIntent(id: string): Promise<Intent> {
    await this.slot();
    try {
      return toIntent(await this.stripe.paymentIntents.cancel(id));
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeError) || error.code !== "payment_intent_unexpected_state") {
        throw error;
      }
      // Already cancelled is what we wanted; anything else (succeeded, processing) the caller handles.
      const intent = await this.retrieveIntent(id);
      if (intent.status === "canceled") return intent;
      throw new UnexpectedIntentState(intent);
    }
  }

  async createRefund(input: CreateRefund): Promise<Refund> {
    await this.slot();
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        ...(input.amountCents === undefined ? {} : { amount: input.amountCents }),
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      id: refund.id,
      status: (refund.status ?? "pending") as Refund["status"],
      amountCents: refund.amount,
    };
  }

  /** Spaces requests out (in this process) to stay under the test mode's rate limit. */
  private async slot(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + MIN_SPACING_MS;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}

/**
 * Statuses this code knows. One Stripe adds later reads as "requires_action": not paid, and still
 * cancellable, the safe side until the code learns it.
 */
const KNOWN = new Set<string>([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
  "requires_capture",
  "canceled",
  "succeeded",
]);

function toIntent(intent: Stripe.PaymentIntent): Intent {
  const charge = intent.latest_charge;
  return {
    id: intent.id,
    status: KNOWN.has(intent.status) ? (intent.status as IntentStatus) : "requires_action",
    amountCents: intent.amount,
    amountReceivedCents: intent.amount_received,
    currency: intent.currency,
    clientSecret: intent.client_secret ?? "",
    latestChargeId: typeof charge === "string" ? charge : (charge?.id ?? null),
    metadata: intent.metadata,
    lastError: intent.last_payment_error?.message ?? null,
  };
}
