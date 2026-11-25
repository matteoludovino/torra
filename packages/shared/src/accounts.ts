import { z } from "zod";

/** Emails are compared and stored trimmed and lower-cased. */
export const email = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase())
  .pipe(z.email());

/** Length is what matters (no composition rules); the upper bound keeps hashing cheap. */
export const password = z.string().min(8).max(128);

export const personName = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .transform((value) => value.replace(/\s+/g, " "));

/** One-time tokens (email verification, password reset): 256 random bits, base64url. */
export const oneTimeToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const signupInput = z.object({ name: personName, email, password });
export type SignupInput = z.input<typeof signupInput>;

export const loginInput = z.object({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.input<typeof loginInput>;

/** Resend the verification email, or ask for a password reset. */
export const emailInput = z.object({ email });

export const verifyInput = z.object({ token: oneTimeToken });

export const resetInput = z.object({ token: oneTimeToken, password });
export type ResetInput = z.input<typeof resetInput>;

export const updateAccountInput = z.object({ name: personName });

export const role = z.enum(["customer", "admin"]);
