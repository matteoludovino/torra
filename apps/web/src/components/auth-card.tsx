import Link from "next/link";
import type { ReactNode } from "react";

/** The narrow centred card that sign-up, sign-in and the email links share. */
export function AuthCard({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto grid w-full max-w-md gap-6 px-4 py-12 sm:py-16">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro ? <div className="text-stone-600">{intro}</div> : null}
      </div>
      <div className="grid gap-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">{children}</div>
      {footer ? <div className="text-center text-sm text-stone-600">{footer}</div> : null}
    </main>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-brand-700 underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
