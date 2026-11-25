"use client";

import { signupInput } from "@torra/shared";
import { useState, type FormEvent } from "react";
import { AuthCard, TextLink } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { serverFieldErrors, validate, type FieldErrors } from "@/lib/forms";
import type { Me } from "@torra/shared";
import { useRouter } from "next/navigation";
import { nextPath, useRedirectSignedIn, useSetMe } from "@/lib/session";

export function SignupForm() {
  useRedirectSignedIn();
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setMe = useSetMe();
  const router = useRouter();

  const change = (field: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { data, errors } = validate(signupInput, values);
    setErrors(errors ?? {});
    setFailure(null);
    if (!data) return;
    setBusy(true);
    try {
      const me = await api<Me>("/auth/signup", { body: data });
      setMe(me);
      router.replace(nextPath());
    } catch (error) {
      setErrors(serverFieldErrors(error));
      setFailure(error instanceof ApiFailure ? error.message : "Algo deu errado. Tente de novo.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Crie sua conta"
      intro="Para comprar, acompanhar seus pedidos e baixar seus cursos."
      footer={
        <>
          Já tem conta? <TextLink href="/entrar">Entrar</TextLink>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4">
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        <TextField
          label="Nome"
          autoComplete="name"
          value={values.name}
          onChange={change("name")}
          error={errors.name}
        />
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={change("email")}
          error={errors.email}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={change("password")}
          error={errors.password}
          hint="Pelo menos 8 caracteres. Uma frase longa é mais segura que símbolos."
        />
        <Button type="submit" busy={busy}>
          Criar conta
        </Button>
      </form>
    </AuthCard>
  );
}
