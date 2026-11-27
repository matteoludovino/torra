"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Notice } from "@/components/ui/notice";
import { useMe, useRequireMe } from "@/lib/session";

const SECTIONS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/produtos", label: "Produtos" },
  { href: "/admin/cupons", label: "Cupons" },
  { href: "/admin/clientes", label: "Clientes" },
  { href: "/admin/registro", label: "Registro" },
];

/**
 * The admin panel's frame: which store this is, and the sections. It always renders the page below it
 * (Next validates every page segment); each page checks access itself, with `AdminOnly`.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const admin = me?.role === "admin";
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
      {admin ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {me.demo ? "Painel da demo" : "Painel da loja"}
            </h1>
            {me.demo ? (
              <p className="text-sm text-stone-600">
                Só esta demonstração: os produtos, cupons e estoque daqui não mudam a loja de verdade.
              </p>
            ) : null}
          </div>
          {/* The current path is runtime data on dynamic routes: the tabs wait for it, without blocking. */}
          <Suspense fallback={<Tabs active={null} />}>
            <CurrentTabs />
          </Suspense>
        </>
      ) : null}
      <main className="grid gap-6">{children}</main>
    </div>
  );
}

function CurrentTabs() {
  return <Tabs active={usePathname()} />;
}

function Tabs({ active }: { active: string | null }) {
  return (
    <nav aria-label="Seções do painel" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul className="flex gap-1 border-b border-stone-200">
        {SECTIONS.map((section) => {
          const current =
            active !== null &&
            (section.href === "/admin" ? active === "/admin" : active.startsWith(section.href));
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={`-mb-px block border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
                  current
                    ? "border-brand-600 font-medium text-brand-900"
                    : "border-transparent text-stone-600 hover:text-stone-900"
                }`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A page of the panel: signed in (or off to sign in), and an admin (or told it isn't for them). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const me = useRequireMe();
  const { error } = useMe();
  if (error)
    return (
      <Notice tone="error">Não foi possível falar com o servidor. Recarregue a página em instantes.</Notice>
    );
  if (!me) return <Loading />;
  if (me.role !== "admin") return <Notice tone="error">Esta área é só para a equipe da loja.</Notice>;
  return children;
}

/** A white card with a title, the panel's basic block. */
export function Card({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Loading() {
  return <div aria-busy className="h-48 animate-pulse rounded-2xl bg-stone-200/70" />;
}
