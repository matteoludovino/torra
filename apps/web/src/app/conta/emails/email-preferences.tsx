"use client";

import { EMAIL_CATEGORIES, EMAIL_CATEGORY_LABELS, type EmailPreferences } from "@torra/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { RequireSession } from "@/components/require-session";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";

/** Which kinds of email the person gets. Account email (confirmations, password) always goes. */
export function EmailPreferencesForm() {
  return (
    <RequireSession>
      {() => (
        <main className="mx-auto grid max-w-2xl gap-6 px-4 py-10">
          <div className="grid gap-1">
            <Link href="/conta" className="text-sm text-stone-600 hover:underline">
              ← Sua conta
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Preferências de e-mail</h1>
            <p className="text-stone-600">
              Escolha o que chega na sua caixa de entrada. Tudo continua aparecendo aqui na sua conta. E-mails
              da conta (confirmação, troca de senha) e os recibos (compra, pagamento, reembolso) sempre
              chegam.
            </p>
          </div>
          <Choices />
        </main>
      )}
    </RequireSession>
  );
}

function Choices() {
  const queries = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["me", "email-preferences"],
    queryFn: () => api<EmailPreferences>("/me/email-preferences"),
  });
  const [draft, setDraft] = useState<EmailPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (error) return <Notice tone="error">Não foi possível carregar suas preferências.</Notice>;
  if (!data) return <div aria-busy className="h-64 animate-pulse rounded-2xl bg-stone-200/70" />;
  const values = draft ?? data;

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const saved = await api<EmailPreferences>("/me/email-preferences", { method: "PUT", body: values });
      queries.setQueryData(["me", "email-preferences"], saved);
      setDraft(null);
      setResult({ tone: "success", text: "Preferências salvas." });
    } catch (failure) {
      setResult({
        tone: "error",
        text: failure instanceof ApiFailure ? failure.message : "Não foi possível salvar.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}
      <fieldset className="grid gap-4">
        <legend className="sr-only">Receber e-mails de</legend>
        {EMAIL_CATEGORIES.map((category) => (
          <label key={category} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={values[category]}
              onChange={(event) => {
                setResult(null);
                setDraft({ ...values, [category]: event.target.checked });
              }}
              className="mt-1 size-4 shrink-0 accent-brand-600"
            />
            <span className="grid gap-0.5">
              <span className="font-medium text-stone-900">{EMAIL_CATEGORY_LABELS[category].label}</span>
              <span className="text-sm text-stone-600">{EMAIL_CATEGORY_LABELS[category].description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button busy={busy} onClick={save} disabled={!draft}>
          Salvar preferências
        </Button>
      </div>
    </div>
  );
}
