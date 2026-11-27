import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { GatewayRefused, UnexpectedIntentState } from "../src/payments/gateway.ts";
import { STRIPE_API_VERSION, StripeGateway } from "../src/payments/stripe.gateway.ts";

/**
 * The Stripe adapter against Stripe itself (test mode; the development/CI Stripe sandbox): what the fake
 * gateway imitates, checked for real. Needs STRIPE_SECRET_KEY (sk_test_…); without it, skipped with a
 * note. CI runs it on main, where the secret is available.
 */
// CI sets it to an empty string when the secret isn't available.
const key = process.env["STRIPE_SECRET_KEY"] || undefined;
if (!key) console.warn("Stripe contract tests skipped: STRIPE_SECRET_KEY (test mode) is not set.");
if (key && !/^(sk|rk)_test_/.test(key)) throw new Error("STRIPE_SECRET_KEY must be a test-mode key");

describe.skipIf(!key)("the Stripe adapter, against Stripe", { timeout: 90_000 }, () => {
  // The block is still read when skipped: a placeholder key that nothing uses.
  const secret = key ?? "sk_test_skipped";
  const gateway = new StripeGateway(secret);
  // Confirming is the browser's part (Stripe.js); here, Stripe's test payment methods stand in for it.
  const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  const metadata = { orderId: randomUUID(), env: "contract" };
  const create = (idempotencyKey = `contract:${randomUUID()}`) =>
    gateway.createIntent({ amountCents: 4990, description: "Contract test", metadata, idempotencyKey });

  it("creates a card PaymentIntent once per idempotency key", async () => {
    const idempotencyKey = `contract:${randomUUID()}`;
    const intent = await create(idempotencyKey);
    expect(intent).toMatchObject({
      status: "requires_payment_method",
      amountCents: 4990,
      amountReceivedCents: 0,
      currency: "brl",
      metadata,
      latestChargeId: null,
      lastError: null,
    });
    expect(intent.clientSecret).toMatch(/^pi_.+_secret_/);
    expect((await create(idempotencyKey)).id).toBe(intent.id);
  });

  it("reads a paid one, refuses to cancel it, and refunds it once per key", async () => {
    const intent = await create();
    await stripe.paymentIntents.confirm(intent.id, { payment_method: "pm_card_visa" });
    const paid = await gateway.retrieveIntent(intent.id);
    expect(paid).toMatchObject({ status: "succeeded", amountReceivedCents: 4990 });
    expect(paid.latestChargeId).toMatch(/^ch_|^py_/);

    const refused = await gateway.cancelIntent(intent.id).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(UnexpectedIntentState);
    expect((refused as UnexpectedIntentState).intent.status).toBe("succeeded");

    const idempotencyKey = `contract:${randomUUID()}`;
    const refund = await gateway.createRefund({ paymentIntentId: intent.id, metadata, idempotencyKey });
    expect(refund.amountCents).toBe(4990);
    expect(["succeeded", "pending"]).toContain(refund.status);
    expect((await gateway.createRefund({ paymentIntentId: intent.id, metadata, idempotencyKey })).id).toBe(
      refund.id,
    );
  });

  it("keeps a declined one waiting for another card, with the reason", async () => {
    const intent = await create();
    await expect(
      stripe.paymentIntents.confirm(intent.id, { payment_method: "pm_card_chargeDeclined" }),
    ).rejects.toThrow();
    const declined = await gateway.retrieveIntent(intent.id);
    expect(declined.status).toBe("requires_payment_method");
    expect(declined.lastError).toBeTruthy();
    // Then paid with another card: the same PaymentIntent.
    await stripe.paymentIntents.confirm(intent.id, { payment_method: "pm_card_visa" });
    expect((await gateway.retrieveIntent(intent.id)).status).toBe("succeeded");
  });

  /** Stripe settles some things a few seconds later: asks until `done`, for up to half a minute. */
  async function eventually<T>(ask: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const value = await ask();
      if (done(value) || attempt >= 15) return value;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  it("lists refunds with our metadata, and shows one that fails later", async () => {
    const intent = await create();
    // A card whose refunds fail after being accepted (4000 0000 0000 5126).
    await stripe.paymentIntents.confirm(intent.id, { payment_method: "pm_card_refundFail" });
    const refund = await gateway.createRefund({
      paymentIntentId: intent.id,
      amountCents: 1000,
      metadata: { ...metadata, refundId: "contract-refund" },
      idempotencyKey: `contract:${randomUUID()}`,
    });
    const listed = await eventually(
      () => gateway.listRefunds(intent.id),
      (refunds) => refunds[0]?.status === "failed",
    );
    expect(listed[0]).toMatchObject({
      id: refund.id,
      status: "failed",
      metadata: { refundId: "contract-refund" },
    });
    expect(listed[0]!.failureReason).toBeTruthy();
  });

  it("shows a dispute the bank opens", async () => {
    const intent = await create();
    // A card that is disputed as soon as it's charged (4000 0000 0000 0259).
    await stripe.paymentIntents.confirm(intent.id, { payment_method: "pm_card_createDispute" });
    const disputes = await eventually(
      () => gateway.listDisputes(intent.id),
      (found) => found.length > 0,
    );
    expect(disputes[0]).toMatchObject({
      amountCents: 4990,
      status: expect.stringMatching(/needs_response|warning/),
    });
    // A disputed charge can't be refunded: Stripe refuses, for good.
    await expect(
      gateway.createRefund({
        paymentIntentId: intent.id,
        metadata,
        idempotencyKey: `contract:${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(GatewayRefused);
  });

  it("pays one with the test card from the server (the demo's story)", async () => {
    const intent = await create();
    expect(await gateway.payWithTestCard(intent.id)).toMatchObject({
      status: "succeeded",
      amountReceivedCents: 4990,
    });
  });

  it("cancels one not paid, and cancelling again is fine", async () => {
    const intent = await create();
    expect((await gateway.cancelIntent(intent.id)).status).toBe("canceled");
    expect((await gateway.cancelIntent(intent.id)).status).toBe("canceled");
  });
});
