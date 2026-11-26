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
  })
  .refine((env) => env.NODE_ENV !== "production" || env.SIGNING_SECRET, {
    path: ["SIGNING_SECRET"],
    message: "required in production (at least 32 characters)",
  })
  .transform((env) => ({
    ...env,
    SIGNING_SECRET: env.SIGNING_SECRET ?? "development-only-signing-secret-not-for-production",
  }));

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
