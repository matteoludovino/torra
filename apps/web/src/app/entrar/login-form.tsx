"use client";

import { loginInput, type Me } from "@torra/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard, TextLink } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { validate, type FieldErrors } from "@/lib/forms";
import { nextPath, useRedirectSignedIn, useSetMe } from "@/lib/session";

export function LoginForm() {
  useRedirectSignedIn();
  const router = useRouter();
  const setMe = useSetMe();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { data, errors } = validate(loginInput, values);
    setErrors(errors ?? {});
    setFailure(null);
    if (!data) return;
    setBusy(true);
    try {
      const me = await api<Me>("/auth/login", { body: data });
      setMe(me);
      router.replace(nextPath());
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error : new ApiFailure(0, "unknown", "Algo deu errado."));
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Entrar"
      footer={
        <>
          Ainda não tem conta? <TextLink href="/cadastro">Criar conta</TextLink>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4">
        {failure ? (
          <Notice tone="error">
            <p>{failure.message}</p>
          </Notice>
        ) : null}
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
          error={errors.email}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
          error={errors.password}
          hint={<TextLink href="/esqueci-senha">Esqueci minha senha</TextLink>}
        />
        <Button type="submit" busy={busy}>
          Entrar
        </Button>
      </form>
    </AuthCard>
  );
}
