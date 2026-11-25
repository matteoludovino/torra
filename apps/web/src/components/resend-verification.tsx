"use client";

import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { Button } from "./ui/button";

/** "Didn't get it?": asks for another verification email (the answer is the same for any address). */
export function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [failure, setFailure] = useState<string | null>(null);

  async function resend() {
    setState("busy");
    setFailure(null);
    try {
      await api("/auth/resend-verification", { body: { email } });
      setState("sent");
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : "Não foi possível reenviar.");
      setState("idle");
    }
  }

  return (
    <div className="grid gap-2 text-sm text-stone-600">
      <p>Não chegou? Veja a caixa de spam ou peça outro link.</p>
      {state === "sent" ? (
        <p role="status" className="font-medium text-emerald-800">
          Pronto: se houver uma conta esperando confirmação, um novo link está a caminho.
        </p>
      ) : (
        <Button variant="secondary" onClick={resend} busy={state === "busy"} className="justify-self-start">
          Reenviar link
        </Button>
      )}
      {failure ? (
        <p role="alert" className="text-red-700">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
