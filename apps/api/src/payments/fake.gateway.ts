import { randomBytes } from "node:crypto";
import {
  IntentNotFound,
  PaymentGateway,
  UnexpectedIntentState,
  type CreateIntent,
  type CreateRefund,
  type Dispute,
  GatewayRefused,
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
  readonly refunds: FakeRefund[] = [];
  private readonly byKey = new Map<string, string>();
  private sequence = 0;
  /** Requests made, by kind (tests check that nothing reaches the gateway inside transactions, etc.). */
  readonly calls = { create: 0, retrieve: 0, cancel: 0, refund: 0, list: 0 };

  async createIntent(input: CreateIntent): Promise<Intent> {
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

  async retrieveIntent(id: string): Promise<Intent> {
    this.calls.retrieve += 1;
    return Promise.resolve({ ...this.intent(id) });
  }

  async cancelIntent(id: string): Promise<Intent> {
    this.calls.cancel += 1;
    const intent = this.intent(id);
    if (intent.status === "succeeded" || intent.status === "processing") {
      return Promise.reject(new UnexpectedIntentState({ ...intent }));
    }
    intent.status = "canceled";
    return Promise.resolve({ ...intent });
  }

  async createRefund(input: CreateRefund): Promise<Refund> {
    this.calls.refund += 1;
    if (this.failNextRefund) {
      const failure = this.failNextRefund;
      this.failNextRefund = null;
      if (failure === "network") throw new Error("connect ETIMEDOUT");
      throw new GatewayRefused(failure, "charge_disputed");
    }
    const known = this.refunds.find((refund) => refund.id === this.byKey.get(input.idempotencyKey));
    if (known) return copy(known);
    // As Stripe answers a PaymentIntent it doesn't know: resource_missing, a refusal.
    const intent = this.intents.get(input.paymentIntentId);
    if (!intent)
      throw new GatewayRefused(`No such payment_intent: '${input.paymentIntentId}'`, "resource_missing");
    const left = intent.amountReceivedCents - this.refunded(intent.id);
    const amountCents = input.amountCents ?? left;
    if (intent.status !== "succeeded" || amountCents > left) {
      throw new GatewayRefused(
        "Refund amount is greater than unrefunded amount on charge",
        "amount_too_large",
      );
    }
    const refund: FakeRefund = {
      id: `re_fake_${randomBytes(6).toString("hex")}`,
      status: this.refundsSettle ? "succeeded" : "pending",
      amountCents,
      metadata: { ...input.metadata },
      failureReason: null,
      paymentIntentId: intent.id,
    };
    this.refunds.unshift(refund);
    this.byKey.set(input.idempotencyKey, refund.id);
    if (this.loseNextRefundResponse) {
      // Stripe made it, but the answer never arrived.
      this.loseNextRefundResponse = false;
      throw new Error("socket hang up");
    }
    return copy(refund);
  }

  async listRefunds(paymentIntentId: string): Promise<Refund[]> {
    this.calls.list += 1;
    return this.refunds.filter((refund) => refund.paymentIntentId === paymentIntentId).map(copy);
  }

  async listDisputes(paymentIntentId: string): Promise<Dispute[]> {
    return this.disputes
      .filter((dispute) => dispute.paymentIntentId === paymentIntentId)
      .map((dispute) => ({
        id: dispute.id,
        status: dispute.status,
        amountCents: dispute.amountCents,
        reason: dispute.reason,
      }));
  }

  /** Refunds settle at once (succeeded), or stay pending until `settleRefund` (as some banks take days). */
  refundsSettle = true;
  /** The next refund: refused by Stripe ("charge disputed"), or lost to the network before Stripe sees it. */
  failNextRefund: string | "network" | null = null;
  /** The next refund is made, but its response is lost (the retry must find it, not make another). */
  loseNextRefundResponse = false;
  readonly disputes: (Dispute & { paymentIntentId: string })[] = [];

  /** A pending refund settles, or fails later (an expired card, say: the money stays with the store). */
  settleRefund(id: string, outcome: "succeeded" | "failed"): void {
    const refund = this.refunds.find((candidate) => candidate.id === id)!;
    refund.status = outcome;
    refund.failureReason = outcome === "failed" ? "expired_or_canceled_card" : null;
  }

  /** A refund made by hand in Stripe's Dashboard (no metadata of ours). */
  refundInDashboard(paymentIntentId: string, amountCents: number): Refund {
    const refund: FakeRefund = {
      id: `re_fake_${randomBytes(6).toString("hex")}`,
      status: "succeeded",
      amountCents,
      metadata: {},
      failureReason: null,
      paymentIntentId,
    };
    this.refunds.unshift(refund);
    return copy(refund);
  }

  /** The customer's bank opens a dispute (then it's under review, then won or lost). */
  dispute(paymentIntentId: string, status: string): Dispute {
    const existing = this.disputes.find((dispute) => dispute.paymentIntentId === paymentIntentId);
    if (existing) {
      existing.status = status;
      return { ...existing };
    }
    const dispute = {
      id: `dp_fake_${randomBytes(6).toString("hex")}`,
      status,
      amountCents: this.intent(paymentIntentId).amountReceivedCents,
      reason: "fraudulent",
      paymentIntentId,
    };
    this.disputes.push(dispute);
    return { ...dispute };
  }

  private refunded(paymentIntentId: string): number {
    return this.refunds
      .filter(
        (refund) =>
          refund.paymentIntentId === paymentIntentId &&
          refund.status !== "failed" &&
          refund.status !== "canceled",
      )
      .reduce((sum, refund) => sum + refund.amountCents, 0);
  }

  /** Stripe keeps idempotency keys for 24 hours: after that, the same key makes a new object. */
  forgetKeys(): void {
    this.byKey.clear();
  }

  /** Forgets everything (between tests). */
  reset(): void {
    this.intents.clear();
    this.refunds.length = 0;
    this.disputes.length = 0;
    this.byKey.clear();
    this.refundsSettle = true;
    this.failNextRefund = null;
    this.loseNextRefundResponse = false;
    Object.assign(this.calls, { create: 0, retrieve: 0, cancel: 0, refund: 0, list: 0 });
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
    if (!intent) throw new IntentNotFound(id);
    return intent;
  }
}

type FakeRefund = Refund & { paymentIntentId: string };

function copy(refund: FakeRefund): Refund {
  return {
    id: refund.id,
    status: refund.status,
    amountCents: refund.amountCents,
    metadata: { ...refund.metadata },
    failureReason: refund.failureReason,
  };
}
