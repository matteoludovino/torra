"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useMe, useSetMe } from "@/lib/session";
import { Button, ButtonLink } from "./ui/button";

export function SiteHeader() {
  const { data: me, isPending } = useMe();
  const setMe = useSetMe();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      setLeaving(false);
      router.push("/");
    }
  }

  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight text-brand-900"
        >
          <span aria-hidden className="size-2.5 rounded-full bg-brand-600" />
          Torra
        </Link>
        {/* On phones the page links take a row of their own, under the logo and the account buttons. */}
        <nav
          aria-label="Principal"
          className="order-last flex basis-full items-center gap-4 pt-1 pb-1 sm:order-none sm:basis-auto sm:p-0"
        >
          <Link href="/loja" className="text-sm text-stone-700 hover:text-stone-900">
            Loja
          </Link>
          {me?.role === "admin" ? (
            <Link href="/admin" className="text-sm text-stone-700 hover:text-stone-900">
              Admin
            </Link>
          ) : null}
        </nav>
        <nav aria-label="Conta" className="ml-auto flex items-center gap-2">
          {isPending ? null : me ? (
            <>
              <Link href="/conta" className="text-sm text-stone-700 hover:text-stone-900">
                {me.name}
              </Link>
              <Button variant="ghost" onClick={logout} busy={leaving}>
                Sair
              </Button>
            </>
          ) : (
            <>
              <ButtonLink href="/entrar" variant="ghost">
                Entrar
              </ButtonLink>
              <ButtonLink href="/cadastro">Criar conta</ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
