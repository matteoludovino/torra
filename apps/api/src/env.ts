import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8050),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().min(1),
    /** Exact origins allowed to call the API (comma-separated). */
    WEB_ORIGINS: z
      .string()
      .default("http://localhost:3040")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Behind the web app's rewrite and the platform's proxy: trust X-Forwarded-For for client addresses. */
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    /** Run time-based work in this process (off in tests, which drive it by hand). */
    SCHEDULER: z
      .enum(["on", "off"])
      .default("on")
      .transform((value) => value === "on"),
    /** The web app's public address, for links in emails. */
    WEB_URL: z.url().default("http://localhost:3040"),
    /** Where email goes (smtp://localhost:1026 is Mailpit). Unset: emails are only kept in the database. */
    SMTP_URL: z.url().optional(),
    MAIL_FROM: z.string().default("Torra <nao-responda@torra.local>"),
    /** The postal directory that turns a CEP into an address (e2e points it nowhere, to test the fallback). */
    VIACEP_URL: z.url().default("https://viacep.com.br/ws"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "log", "debug", "verbose"]).default("log"),
    /** Demo sandboxes alive at once, across all visitors (each lasts a day). */
    DEMO_MAX_SANDBOXES: z.coerce.number().int().positive().default(200),
    /** Signs links that act without a session (unsubscribing, downloads). Required in
     * production; elsewhere a fixed development value. */
    SIGNING_SECRET: z.string().min(32).optional(),
    /**
     * Stripe, in test mode only: live keys are refused, so this code can never take real money. Unset, a
     * fake gateway stands in (development, tests and end-to-end runs pay with a simulated card).
     */
    STRIPE_SECRET_KEY: z
      .string()
      .regex(/^(sk|rk)_test_\w+$/, "a test-mode secret key (sk_test_… or rk_test_…)")
      .optional(),
    STRIPE_PUBLISHABLE_KEY: z
      .string()
      .regex(/^pk_test_\w+$/, "a test-mode publishable key (pk_test_…)")
      .optional(),
    /** Verifies webhook signatures (the endpoint's, or `stripe listen`'s, whsec_…). */
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .regex(/^whsec_\w+$/, "a webhook signing secret (whsec_…)")
      .optional(),
    /**
     * Which deployment a payment belongs to, written on every Stripe object: a Stripe sandbox shared by
     * two deployments (local and CI, say) sends each one events about the other's payments, which this
     * tells apart.
     */
    PAYMENTS_ENV: z
      .string()
      .regex(/^[a-z0-9-]{1,30}$/)
      .default("local"),
  })
  .refine((env) => env.NODE_ENV !== "production" || env.SIGNING_SECRET, {
    path: ["SIGNING_SECRET"],
    message: "required in production (at least 32 characters)",
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      (env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_WEBHOOK_SECRET),
    { path: ["STRIPE_SECRET_KEY"], message: "Stripe's three test-mode values are required in production" },
  )
  .refine((env) => !env.STRIPE_SECRET_KEY || env.STRIPE_PUBLISHABLE_KEY, {
    path: ["STRIPE_PUBLISHABLE_KEY"],
    message: "required with STRIPE_SECRET_KEY (the browser needs it for the card form)",
  })
  .transform((env) => ({
    ...env,
    SIGNING_SECRET: env.SIGNING_SECRET ?? "development-only-signing-secret-not-for-production",
    /** Stripe when a key is set; otherwise the fake gateway (never in production, by the rule above). */
    PAYMENT_GATEWAY: env.STRIPE_SECRET_KEY ? ("stripe" as const) : ("fake" as const),
    /** Without a webhook secret (the fake gateway, or Stripe before `stripe listen`), a fixed one. */
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET ?? FAKE_WEBHOOK_SECRET,
  }));

/** Signs the fake gateway's events, and test events, when no real webhook secret is configured. */
export const FAKE_WEBHOOK_SECRET = "whsec_development_only_not_a_stripe_secret";

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return parsed.data;
}

/** Injection token for the validated environment. */
export const ENV = Symbol("ENV");
