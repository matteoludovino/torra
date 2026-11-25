"use client";

import type { Me } from "@torra/shared";
import type { ReactNode } from "react";
import { useMe, useRequireMe } from "@/lib/session";
import { Notice } from "./ui/notice";

/** Renders its children with the signed-in account; sends anyone else to sign in. */
export function RequireSession({ children }: { children: (me: Me) => ReactNode }) {
  const me = useRequireMe();
  const { error } = useMe();
  if (me) return children(me);
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {error ? (
        <Notice tone="error">Não foi possível falar com o servidor. Recarregue a página em instantes.</Notice>
      ) : (
        <div aria-busy className="grid gap-4">
          <div className="h-8 w-64 animate-pulse rounded bg-stone-200" />
          <div className="h-40 animate-pulse rounded-2xl bg-stone-200/70" />
        </div>
      )}
    </main>
  );
}
