"use client";

import { password as passwordSchema, type Me } from "@torra/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { AuthCard, TextLink } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { validate, type FieldErrors } from "@/lib/forms";
import { takeFragmentToken, useSetMe } from "@/lib/session";

const form = z.object({ password: passwordSchema, confirm: z.string() });

/** The link from the reset email: /redefinir-senha#t=… */
export function ResetForm() {
  const router = useRouter();
  const setMe = useSetMe();
  // undefined: not read yet (first render, also on the server); null: the link had none.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Read once: in development the effect runs twice, and the fragment is gone the second time.
  const read = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (read.current === undefined) read.current = takeFragmentToken();
    setToken(read.current);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { data, errors } = validate(form, values);
    const mismatch: FieldErrors =
      data && data.password !== data.confirm ? { confirm: "As senhas não são iguais." } : {};
    setErrors({ ...errors, ...mismatch });
    setFailure(null);
    if (!data || "confirm" in mismatch || !token) return;
    setBusy(true);
    try {
      const me = await api<Me>("/auth/reset-password", { body: { token, password: data.password } });
      setMe(me);
      router.replace("/conta");
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : "Algo deu errado. Tente de novo.");
      setBusy(false);
    }
  }

  if (token === null) {
    return (
      <AuthCard title="Nova senha" footer={<TextLink href="/esqueci-senha">Pedir um novo link</TextLink>}>
        <Notice tone="error">
          Este link está incompleto. Abra-o de novo pelo e-mail, sem cortar o final.
        </Notice>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Crie uma senha nova"
      intro="Ao salvar, você entra e sai de todos os outros dispositivos."
      footer={failure ? <TextLink href="/esqueci-senha">Pedir um novo link</TextLink> : undefined}
    >
      <form onSubmit={submit} noValidate className="grid gap-4">
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        <TextField
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
          error={errors.password}
          hint="Pelo menos 8 caracteres."
        />
        <TextField
          label="Repita a senha"
          type="password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={(event) => setValues({ ...values, confirm: event.target.value })}
          error={errors.confirm}
        />
        <Button type="submit" busy={busy} disabled={token === undefined}>
          Salvar e entrar
        </Button>
      </form>
    </AuthCard>
  );
}
