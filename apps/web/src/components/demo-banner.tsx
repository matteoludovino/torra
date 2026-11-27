"use client";

import { DEMO_PERSONAS, DEMO_PERSONA_LABELS } from "@torra/shared";
import Link from "next/link";
import { personaOf, useDemoReady, useEnterDemo } from "@/lib/demo";
import { useMe } from "@/lib/session";

/** For demo visitors: who they are now, the other persona one click away, and the demo's inbox. */
export function DemoBanner() {
  const { data: me } = useMe();
  const { enter, busy, failure } = useEnterDemo();
  const ready = useDemoReady(Boolean(me?.demo));
  if (!me?.demo) return null;
  const current = personaOf(me);
  return (
    <div className="border-b border-brand-100 bg-brand-50 text-sm text-brand-950">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2">
        <span>
          <strong className="font-semibold">Demonstração</strong> · você é {me.name} (
          {DEMO_PERSONA_LABELS[current].label.toLowerCase()})
        </span>
        {DEMO_PERSONAS.filter((persona) => persona !== current).map((persona) => (
          <button
            key={persona}
            type="button"
            onClick={() => enter(persona)}
            disabled={busy !== null}
            className="rounded-md border border-brand-200 bg-white px-2 py-0.5 font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-60"
          >
            Trocar para {DEMO_PERSONA_LABELS[persona].label.toLowerCase()}
          </button>
        ))}
        <Link href="/demo/emails" className="font-medium text-brand-800 underline-offset-2 hover:underline">
          E-mails da demo
        </Link>
        {!ready ? (
          <span role="status" className="flex items-center gap-1.5 text-brand-800">
            <span
              aria-hidden
              className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent"
            />
            Preparando os pedidos de exemplo…
          </span>
        ) : null}
        {failure ? (
          <span role="alert" className="text-red-700">
            {failure}
          </span>
        ) : null}
      </div>
    </div>
  );
}
