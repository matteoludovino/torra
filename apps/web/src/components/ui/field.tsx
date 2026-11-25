import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

const control =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-xs outline-none transition placeholder:text-stone-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/20 disabled:bg-stone-100";

interface Common {
  label: string;
  error?: string;
  hint?: ReactNode;
}

function Frame({ id, label, error, hint, children }: Common & { id: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-stone-800">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-stone-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled input with its error (announced with the field) or a hint below. */
export function TextField({
  label,
  error,
  hint,
  className = "",
  ...input
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        className={`${control} ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...input}
      />
    </Frame>
  );
}

export function TextArea({
  label,
  error,
  hint,
  ...input
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} error={error} hint={hint}>
      <textarea
        id={id}
        className={`${control} min-h-28`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...input}
      />
    </Frame>
  );
}

export function Select({
  label,
  error,
  hint,
  children,
  ...select
}: Common & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} error={error} hint={hint}>
      <select id={id} className={control} aria-invalid={error ? true : undefined} {...select}>
        {children}
      </select>
    </Frame>
  );
}
