import type { z } from "zod";
import { ApiFailure } from "./api";

export type FieldErrors = Record<string, string>;

/** Zod's issues in the words a form shows next to each field. */
export function messageFor(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "too_small":
      if (issue.origin === "string") {
        return issue.minimum === 1 ? "Preencha este campo." : `Use pelo menos ${issue.minimum} caracteres.`;
      }
      if (issue.origin === "array")
        return issue.minimum === 1 ? "Escolha pelo menos uma." : `Escolha pelo menos ${issue.minimum}.`;
      return "Valor baixo demais.";
    case "too_big":
      if (issue.origin === "string") return `Use no máximo ${issue.maximum} caracteres.`;
      if (issue.origin === "array") return `Escolha no máximo ${issue.maximum}.`;
      return "Valor alto demais.";
    case "invalid_format":
      return issue.format === "email" ? "Digite um e-mail válido." : "Formato inválido.";
    default:
      return "Valor inválido.";
  }
}

/** Checks values with the shared schema; returns the parsed data or an error per field. */
export function validate<T extends z.ZodType>(
  schema: T,
  values: unknown,
): { data: z.output<T>; errors: null } | { data: null; errors: FieldErrors } {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { data: parsed.data, errors: null };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const path = String(issue.path[0] ?? "");
    const value = (values as Record<string, unknown> | null)?.[path];
    errors[path] ??=
      typeof value === "string" && value.trim() === "" ? "Preencha este campo." : messageFor(issue);
  }
  return { data: null, errors };
}

/** A server-side validation failure, by field (the client checks first, so this is rare). */
export function serverFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiFailure)) return {};
  return Object.fromEntries(error.fields.map((field) => [field.path.split(".")[0], "Confira este campo."]));
}

/** The same errors without one field's (it changed, so its old error no longer applies). */
export function without(errors: FieldErrors, field: string): FieldErrors {
  if (!(field in errors)) return errors;
  const rest = { ...errors };
  delete rest[field];
  return rest;
}
