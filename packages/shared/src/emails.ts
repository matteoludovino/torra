import { z } from "zod";

/**
 * Email someone can turn off, by kind. Account email (confirming the address, resetting a password) and
 * receipts (purchase, payment, refund) always go.
 */
export const EMAIL_CATEGORIES = ["orders"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const EMAIL_CATEGORY_LABELS: Record<EmailCategory, { label: string; description: string }> = {
  orders: {
    label: "Andamento dos pedidos",
    description: "Quando o pedido entra em preparo, é enviado (com o rastreio) e é entregue.",
  },
};

/** true = receives that kind. */
export const emailPreferences = z.object(
  Object.fromEntries(EMAIL_CATEGORIES.map((category) => [category, z.boolean()])) as Record<
    EmailCategory,
    z.ZodBoolean
  >,
);
export type EmailPreferences = z.infer<typeof emailPreferences>;

export const unsubscribeInput = z.object({ token: z.string().min(10).max(300) });

/**
 * The category an unsubscribe link is for, read without checking its signature (the page shows it
 * before asking; the API checks the signature when acting).
 */
export function unsubscribeCategory(token: string): EmailCategory | null {
  const [body] = token.split(".");
  try {
    const decoded = atob((body ?? "").replace(/-/g, "+").replace(/_/g, "/"));
    const category = decoded.split(":")[1];
    return (EMAIL_CATEGORIES as readonly string[]).includes(category ?? "")
      ? (category as EmailCategory)
      : null;
  } catch {
    return null;
  }
}
