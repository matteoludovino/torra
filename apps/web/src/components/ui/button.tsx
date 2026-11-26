import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

const styles = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600 disabled:bg-brand-400 [&:disabled:not([aria-busy])]:bg-stone-300 [&:disabled:not([aria-busy])]:text-stone-600",
  secondary:
    "border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 focus-visible:outline-stone-500 disabled:text-stone-400",
  ghost: "text-stone-700 hover:bg-stone-200/60 focus-visible:outline-stone-500",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed";

type Variant = keyof typeof styles;

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      className={`${base} ${styles[variant]} ${className}`}
      disabled={busy || button.disabled}
      aria-busy={busy || undefined}
      {...button}
    >
      {busy ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...link
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${styles[variant]} ${className}`} {...link} />;
}
