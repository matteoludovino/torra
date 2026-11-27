/**
 * The payment gateway, as the rest of the API knows it: Stripe in test mode, or a deterministic fake for
 * development, tests and end-to-end runs. Only what the store needs, in its own words; the adapters map
 * to and from Stripe's objects.
 */

/** A PaymentIntent's state, as Stripe names it. */
export type IntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

export interface Intent {
  id: string;
  status: IntentStatus;
  amountCents: number;
  /** What was actually charged (equals the amount once succeeded). */
  amountReceivedCents: number;
  currency: string;
  /** Handed to the customer's browser only, to confirm with Stripe.js. */
  clientSecret: string;
  latestChargeId: string | null;
  metadata: Record<string, string>;
  /** Why the last attempt failed (a declined card), in the customer's words, if it did. */
  lastError: string | null;
}

export interface CreateIntent {
  amountCents: number;
  description: string;
  metadata: Record<string, string>;
  /** The same key returns the same PaymentIntent (Stripe keeps keys for 24 hours). */
  idempotencyKey: string;
}

export interface Refund {
  id: string;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
  amountCents: number;
}

export interface CreateRefund {
  paymentIntentId: string;
  /** Omitted: what's left of the payment. */
  amountCents?: number;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

/** Cancelling a PaymentIntent that can't be (it succeeded, or is processing): the state it's in. */
export class UnexpectedIntentState extends Error {
  constructor(readonly intent: Intent) {
    super(`PaymentIntent ${intent.id} is ${intent.status}`);
  }
}

/** No such PaymentIntent (Stripe's resource_missing): it can't be paid, or cancelled. */
export class IntentNotFound extends Error {
  constructor(readonly id: string) {
    super(`No such payment_intent: '${id}'`);
  }
}

export abstract class PaymentGateway {
  abstract readonly kind: "stripe" | "fake";
  abstract createIntent(input: CreateIntent): Promise<Intent>;
  abstract retrieveIntent(id: string): Promise<Intent>;
  /** Throws UnexpectedIntentState when the PaymentIntent is past cancelling. */
  abstract cancelIntent(id: string): Promise<Intent>;
  abstract createRefund(input: CreateRefund): Promise<Refund>;
}
