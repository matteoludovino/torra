"use client";

import { emailInput } from "@torra/shared";
import { useState, type FormEvent } from "react";
import { AuthCard, TextLink } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { validate, type FieldErrors } from "@/lib/forms";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { data, errors } = validate(emailInput, { email });
    setErrors(errors ?? {});
    setFailure(null);
    if (!data) return;
    setBusy(true);
    try {
      await api("/auth/forgot-password", { body: data });
      setSent(true);
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : "Algo deu errado. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Esqueci minha senha"
      intro="Digite o e-mail da sua conta: enviamos um link para criar uma senha nova."
      footer={<TextLink href="/entrar">Voltar para entrar</TextLink>}
    >
      {sent ? (
        <Notice tone="success">
          Se houver uma conta com esse e-mail, o link já está a caminho. Ele vale por 1 hora.
        </Notice>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4">
          {failure ? <Notice tone="error">{failure}</Notice> : null}
          <TextField
            label="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
          />
          <Button type="submit" busy={busy}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
