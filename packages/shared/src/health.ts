import { z } from "zod";

/**
 * Version of the API contract. The API accepts this version and the one before it, so a deploy (API
 * first, then web) never strands an open tab; anything older is told to reload.
 */
export const API_VERSION = 1;

export function isSupportedVersion(version: number): boolean {
  return version === API_VERSION || version === API_VERSION - 1;
}

/** `GET /api/health`: answers without touching the database, so it doubles as a cheap wake-up call. */
export const healthResponse = z.object({
  status: z.literal("ok"),
  version: z.number().int(),
});
export type HealthResponse = z.infer<typeof healthResponse>;
