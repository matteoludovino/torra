import { ConflictException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.ts";
import type { PrismaService } from "../prisma/prisma.service.ts";
import type { Tx } from "../outbox/outbox.service.ts";

/**
 * The one transition rule: a state change is an UPDATE … WHERE status IN (allowed from-states), and
 * touching no row means someone else changed it first. Call with the count of `updateMany`.
 */
export function expectChanged(count: number, conflict: { code: string; message: string }): void {
  if (count === 0) throw new ConflictException(conflict);
}

/** True for errors PostgreSQL asks to retry: serialization failure (40001) and deadlock (40P01). */
function retryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return true;
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
  return /40001|40P01|deadlock detected|could not serialize/.test(text);
}

/** An interactive transaction, run again (up to three times) when PostgreSQL asks for a retry. */
export async function transaction<T>(db: PrismaService, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(work);
    } catch (error) {
      if (attempt >= 3 || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }
}

/** A unique index said no (two requests creating the same thing at once). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
