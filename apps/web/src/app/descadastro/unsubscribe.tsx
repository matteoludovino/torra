"use client";

import { EMAIL_CATEGORY_LABELS, unsubscribeCategory } from "@torra/shared";
import { useEffect, useRef, useState } from "react";
import { AuthCard, TextLink } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { takeFragmentToken } from "@/lib/session";

type State = "asking" | "out" | "in";

/**
 * The "unsubscribe" link of an email: /descadastro#t=… It asks before acting (link scanners open
 * links on their own), works without signing in, and can be undone right here.
 */
export function Unsubscribe() {
  // Read once on the client; the token then leaves the address bar.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<State>("asking");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Once, even when development runs effects twice: the first read erases the token from the address.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setToken(takeFragmentToken());
  }, []);

  const category = token ? unsubscribeCategory(token) : null;
  const label = category ? EMAIL_CATEGORY_LABELS[category].label.toLowerCase() : null;

  async function act(path: "/email/unsubscribe" | "/email/resubscribe", next: State) {
    if (!token) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(path, { body: { token } });
      setState(next);
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : "Não foi possível concluir. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  if (token === undefined) return <AuthCard title="Descadastrar">{null}</AuthCard>;
  if (!token || !category) {
    return (
      <AuthCard title="Link incompleto">
        <Notice tone="error">Abra o link de novo pelo e-mail, sem cortar o final.</Notice>
        <p className="text-sm text-stone-600">
          Ou ajuste tudo em <TextLink href="/conta/emails">preferências de e-mail</TextLink>.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Descadastrar">
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      {state === "out" ? (
        <>
          <Notice tone="success">Pronto: você não vai mais receber e-mails de {label}.</Notice>
          <Button variant="secondary" busy={busy} onClick={() => act("/email/resubscribe", "in")}>
            Desfazer
          </Button>
        </>
      ) : state === "in" ? (
        <Notice tone="success">Tudo certo: você volta a receber e-mails de {label}.</Notice>
      ) : (
        <>
          <p className="text-stone-700">Parar de receber e-mails de {label}?</p>
          <Button busy={busy} onClick={() => act("/email/unsubscribe", "out")}>
            Descadastrar
          </Button>
        </>
      )}
      <p className="text-sm text-stone-600">
        Outras escolhas em <TextLink href="/conta/emails">preferências de e-mail</TextLink> (pede para
        entrar).
      </p>
    </AuthCard>
  );
}
