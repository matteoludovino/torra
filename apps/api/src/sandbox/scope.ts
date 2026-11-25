import { Prisma } from "../generated/prisma/client.ts";

/**
 * The one rule of isolation, for every read: the shared store (no sandbox) plus the viewer's own sandbox
 * (every customer has one). Never another customer's.
 */
export function visibleTo(viewer: { sandboxId: string | null } | null) {
  const sandboxId = viewer?.sandboxId ?? null;
  return sandboxId === null ? { sandboxId: null } : { OR: [{ sandboxId: null }, { sandboxId }] };
}

/** The same rule for hand-written SQL: `column` is the row's sandbox column (e.g. `p."sandboxId"`). */
export function visibleToSql(viewer: { sandboxId: string | null } | null, column: string): Prisma.Sql {
  const sandboxId = viewer?.sandboxId ?? null;
  const col = Prisma.raw(column);
  return sandboxId === null
    ? Prisma.sql`${col} IS NULL`
    : Prisma.sql`(${col} IS NULL OR ${col} = ${sandboxId}::uuid)`;
}
