"use client";

import type { Me } from "@torra/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard, TextLink } from "@/components/auth-card";
import { Notice } from "@/components/ui/notice";
import { api, ApiFailure } from "@/lib/api";
import { takeFragmentToken, useSetMe } from "@/lib/session";

/** The link from the verification email: /verificar#t=… (the token never reaches a server log). */
export function VerifyEmail() {
  const router = useRouter();
  const setMe = useSetMe();
  const [failure, setFailure] = useState<string | null>(null);
  // Runs once, even when the effect runs twice in development: the token is erased from the address on
  // first read, and a second request would only find it used.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const verify = async () => {
      const token = takeFragmentToken();
      if (!token) {
        throw new ApiFailure(
          0,
          "incomplete",
          "Este link está incompleto. Abra-o de novo pelo e-mail, sem cortar o final.",
        );
      }
      return api<Me>("/auth/verify", { body: { token } });
    };
    verify()
      .then((me) => {
        setMe(me);
        router.replace("/conta");
      })
      .catch((error: unknown) =>
        setFailure(error instanceof ApiFailure ? error.message : "Não foi possível confirmar agora."),
      );
  }, [router, setMe]);

  return (
    <AuthCard title="Confirmar e-mail">
      {failure ? (
        <>
          <Notice tone="error">{failure}</Notice>
          <p className="text-sm text-stone-600">
            Para receber um novo link, <TextLink href="/entrar">entre com seu e-mail e senha</TextLink>: se a
            conta ainda não estiver confirmada, você poderá pedir outro.
          </p>
        </>
      ) : (
        <p role="status" className="text-stone-700">
          Confirmando seu e-mail…
        </p>
      )}
    </AuthCard>
  );
}
