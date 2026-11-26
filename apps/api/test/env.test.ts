import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.ts";

const base = { DATABASE_URL: "postgresql://localhost/torra" };
const stripe = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_PUBLISHABLE_KEY: "pk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123",
};

describe("payments configuration", () => {
  it("uses the fake gateway without Stripe keys, Stripe with them", () => {
    expect(loadEnv(base).PAYMENT_GATEWAY).toBe("fake");
    expect(loadEnv({ ...base, ...stripe }).PAYMENT_GATEWAY).toBe("stripe");
  });

  it("never takes live keys", () => {
    expect(() => loadEnv({ ...base, ...stripe, STRIPE_SECRET_KEY: "sk_live_abc123" })).toThrow(
      /test-mode secret key/,
    );
    expect(() => loadEnv({ ...base, ...stripe, STRIPE_PUBLISHABLE_KEY: "pk_live_abc123" })).toThrow(
      /test-mode publishable key/,
    );
  });

  it("requires Stripe in production, and the publishable key with the secret one", () => {
    const production = { ...base, NODE_ENV: "production", SIGNING_SECRET: "x".repeat(32) };
    expect(() => loadEnv(production)).toThrow(/Stripe's three test-mode values/);
    expect(loadEnv({ ...production, ...stripe }).PAYMENT_GATEWAY).toBe("stripe");
    expect(() => loadEnv({ ...base, STRIPE_SECRET_KEY: "sk_test_abc123" })).toThrow(/STRIPE_PUBLISHABLE_KEY/);
  });
});
