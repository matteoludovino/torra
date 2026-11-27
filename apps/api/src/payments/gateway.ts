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
  /** Ours: refundId (the local row), orderId, env. Empty for one made in Stripe's Dashboard. */
  metadata: Record<string, string>;
  /** Why it failed, as Stripe says (e.g. "expired_or_canceled_card"). */
  failureReason: string | null;
}

/** A chargeback: the customer's bank took the money back, pending evidence. */
export interface Dispute {
  id: string;
  /** warning_needs_response, needs_response, under_review, won, lost… */
  status: string;
  amountCents: number;
  reason: string;
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
  /**
   * Pays a PaymentIntent with Stripe's test Visa (pm_card_visa), from the server: the one-click demo's
   * starting story is made of real test payments. Test mode only, as everything here.
   */
  abstract payWithTestCard(id: string): Promise<Intent>;
  /** Every refund of a PaymentIntent (ours and the Dashboard's), newest first. */
  abstract listRefunds(paymentIntentId: string): Promise<Refund[]>;
  abstract listDisputes(paymentIntentId: string): Promise<Dispute[]>;
}

/** Stripe refused a request for good (not a network failure): retrying the same won't help. */
export class GatewayRefused extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}
