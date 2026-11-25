import type { EmailCategory } from "@torra/shared";

/**
 * Which category an email kind belongs to; null for email people can't turn off (their account,
 * receipts).
 */
export function categoryOf(kind: string): EmailCategory | null {
  if (kind.startsWith("order_progress_")) return "orders";
  return null;
}
