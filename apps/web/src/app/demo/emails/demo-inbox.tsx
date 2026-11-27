"use client";

import type { DemoEmail } from "@torra/shared";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { RequireSession } from "@/components/require-session";
import { Notice } from "@/components/ui/notice";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";

/** The emails the demo's people got: the real thing would have sent them; the demo keeps them here. */
export function DemoInbox() {
  return (
    <RequireSession>
      {(me) => (
        <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10 [&>*]:min-w-0">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">E-mails da demo</h1>
            <p className="text-stone-600">
              O que a cliente e a equipe da sua demonstração receberiam por e-mail. Nada sai daqui.
            </p>
          </div>
          {me.demo ? <Inbox /> : <Notice tone="info">Esta caixa existe só nas demonstrações.</Notice>}
        </main>
      )}
    </RequireSession>
  );
}

function Inbox() {
  const { data, error } = useQuery({
    queryKey: ["demo", "emails"],
    queryFn: () => api<DemoEmail[]>("/demo/emails"),
    refetchInterval: 10_000,
  });
  if (error) return <Notice tone="error">Não foi possível carregar os e-mails.</Notice>;
  if (!data) return <div aria-busy className="h-40 animate-pulse rounded-2xl bg-stone-200/70" />;
  if (data.length === 0)
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-stone-600">
        Nenhum e-mail ainda.
      </p>
    );
  return (
    <ul className="grid gap-2">
      {data.map((email) => (
        <li key={email.id} className="min-w-0">
          <details className="group rounded-2xl border border-stone-200 bg-white shadow-sm">
            <summary className="grid cursor-pointer gap-0.5 px-4 py-3 marker:content-none">
              <span className="font-medium text-stone-900 group-open:text-brand-700">{email.subject}</span>
              <span className="text-sm text-stone-500">
                Para {email.to} · {ago(email.createdAt)}
              </span>
            </summary>
            <div className="border-t border-stone-100 px-4 py-3 text-sm whitespace-pre-wrap text-stone-800 [overflow-wrap:anywhere]">
              <Linked text={email.text} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Plain text with its addresses clickable (as an email client would show them). */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part} className="text-brand-700 underline-offset-2 hover:underline">
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
