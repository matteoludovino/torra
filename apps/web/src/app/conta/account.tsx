"use client";

import { updateAccountInput, type Me } from "@torra/shared";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { RequireSession } from "@/components/require-session";
import { ResendVerification } from "@/components/resend-verification";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { serverFieldErrors, validate, type FieldErrors } from "@/lib/forms";
import { useSetMe } from "@/lib/session";
import { Orders } from "./orders";

/** The signed-in customer's account: their name, their address's confirmation, their email choices. */
export function Account() {
  return (
    <RequireSession>
      {(me) => (
        <main className="mx-auto grid max-w-2xl gap-6 px-4 py-10">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Olá, {me.name.split(" ")[0]}!</h1>
            <p className="text-stone-600">Seus dados, seus pedidos e o que chega no seu e-mail.</p>
          </div>
          {me.emailVerified ? null : (
            <Notice tone="info">
              <p>
                Confirme seu e-mail ({me.email}) pelo link que enviamos: é por ele que chegam os avisos dos
                seus pedidos.
              </p>
              <div className="mt-3">
                <ResendVerification email={me.email} />
              </div>
            </Notice>
          )}
          <NameForm me={me} />
          <Orders />
          <Link href="/conta/emails" className="text-sm font-medium text-brand-700 hover:underline">
            Preferências de e-mail
          </Link>
        </main>
      )}
    </RequireSession>
  );
}

function NameForm({ me }: { me: Me }) {
  const setMe = useSetMe();
  const [name, setName] = useState(me.name);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { data, errors } = validate(updateAccountInput, { name });
    setErrors(errors ?? {});
    setResult(null);
    if (!data) return;
    setBusy(true);
    try {
      setMe(await api<Me>("/me", { method: "PATCH", body: data }));
      setResult({ tone: "success", text: "Nome salvo." });
    } catch (error) {
      setErrors(serverFieldErrors(error));
      setResult({
        tone: "error",
        text: error instanceof ApiFailure ? error.message : "Não foi possível salvar.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <h2 className="font-semibold">Seus dados</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nome"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
        />
        <TextField label="E-mail" value={me.email} disabled hint="Só você e a equipe da Torra veem." />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy}>
          Salvar nome
        </Button>
        {result ? (
          result.tone === "error" ? (
            <Notice tone="error">{result.text}</Notice>
          ) : (
            <p role="status" className="text-sm font-medium text-emerald-800">
              {result.text}
            </p>
          )
        ) : null}
      </div>
    </form>
  );
}
