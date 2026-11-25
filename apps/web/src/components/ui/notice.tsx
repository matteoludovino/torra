import type { ReactNode } from "react";

const tones = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  info: "border-brand-200 bg-brand-50 text-brand-900",
};

/**
 * A message about the whole form or page. Errors interrupt screen readers and successes wait their turn;
 * "info" is standing text, not news, so it isn't announced.
 */
export function Notice({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : tone === "success" ? "status" : undefined}
      className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
