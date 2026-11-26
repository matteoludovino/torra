import { randomBytes } from "node:crypto";
import {
  PaymentGateway,
  UnexpectedIntentState,
  type CreateIntent,
  type CreateRefund,
  type Intent,
  type Refund,
} from "./gateway.ts";

/** What a simulated customer does with the card form. */
export type FakeOutcome =
  /** Paid. */
  | "succeed"
  /** Declined: the PaymentIntent waits for another card. */
  | "decline"
  /** Accepted, not settled yet (a bank's confirmation pending). */
  | "process"
  /** Asked for 3-D Secure, and the customer never finished it. */
  | "require_action";

/**
 * A payment gateway in memory, deterministic, for development, tests and end-to-end runs: it keeps
 * PaymentIntents and refunds the way Stripe would (idempotency keys included), and its outcomes are set
 * by `settle`, as a customer paying would. Lost when the process stops.
 */
export class FakeGateway extends PaymentGateway {
  readonly kind = "fake" as const;
  readonly intents = new Map<string, Intent>();
  readonly refunds: (Refund & { paymentIntentId: string })[] = [];
  private readonly byKey = new Map<string, string>();
  private sequence = 0;
  /** Requests made, by kind (tests check that nothing reaches the gateway inside transactions, etc.). */
  readonly calls = { create: 0, retrieve: 0, cancel: 0, refund: 0 };

  createIntent(input: CreateIntent): Promise<Intent> {
    this.calls.create += 1;
    const known = this.byKey.get(input.idempotencyKey);
    if (known) return Promise.resolve({ ...this.intents.get(known)! });
    const id = `pi_fake_${(++this.sequence).toString().padStart(6, "0")}${randomBytes(4).toString("hex")}`;
    const intent: Intent = {
      id,
      status: "requires_payment_method",
      amountCents: input.amountCents,
      amountReceivedCents: 0,
      currency: "brl",
      clientSecret: `${id}_secret_${randomBytes(8).toString("hex")}`,
      latestChargeId: null,
      metadata: { ...input.metadata },
      lastError: null,
    };
    this.intents.set(id, intent);
    this.byKey.set(input.idempotencyKey, id);
    return Promise.resolve({ ...intent });
  }

  retrieveIntent(id: string): Promise<Intent> {
    this.calls.retrieve += 1;
    return Promise.resolve({ ...this.intent(id) });
  }

  cancelIntent(id: string): Promise<Intent> {
    this.calls.cancel += 1;
    const intent = this.intent(id);
    if (intent.status === "succeeded" || intent.status === "processing") {
      return Promise.reject(new UnexpectedIntentState({ ...intent }));
    }
    intent.status = "canceled";
    return Promise.resolve({ ...intent });
  }

  createRefund(input: CreateRefund): Promise<Refund> {
    this.calls.refund += 1;
    const known = this.refunds.find((refund) => refund.id === this.byKey.get(input.idempotencyKey));
    if (known) return Promise.resolve({ id: known.id, status: known.status, amountCents: known.amountCents });
    const intent = this.intent(input.paymentIntentId);
    const refunded = this.refunds
      .filter((refund) => refund.paymentIntentId === intent.id)
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const refund = {
      id: `re_fake_${randomBytes(6).toString("hex")}`,
      status: "succeeded" as const,
      amountCents: input.amountCents ?? intent.amountReceivedCents - refunded,
      paymentIntentId: intent.id,
    };
    this.refunds.push(refund);
    this.byKey.set(input.idempotencyKey, refund.id);
    return Promise.resolve({ id: refund.id, status: refund.status, amountCents: refund.amountCents });
  }

  /** Forgets everything (between tests). */
  reset(): void {
    this.intents.clear();
    this.refunds.length = 0;
    this.byKey.clear();
    Object.assign(this.calls, { create: 0, retrieve: 0, cancel: 0, refund: 0 });
  }

  /** The customer's card form, simulated: what happened to this PaymentIntent. */
  settle(id: string, outcome: FakeOutcome): Intent {
    const intent = this.intent(id);
    if (intent.status === "canceled" || intent.status === "succeeded") return { ...intent };
    intent.lastError = null;
    if (outcome === "succeed") {
      intent.status = "succeeded";
      intent.amountReceivedCents = intent.amountCents;
      intent.latestChargeId = `ch_fake_${randomBytes(6).toString("hex")}`;
    } else if (outcome === "decline") {
      intent.status = "requires_payment_method";
      intent.lastError = "Seu cartão foi recusado.";
    } else if (outcome === "process") {
      intent.status = "processing";
    } else {
      intent.status = "requires_action";
    }
    return { ...intent };
  }

  private intent(id: string): Intent {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`No such payment_intent: '${id}'`);
    return intent;
  }
}
