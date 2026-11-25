import "server-only";
import { cookies } from "next/headers";

/** The API, reached directly from the server (not through the rewrite). Read at runtime. */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8050";

export type ServerResult<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "unavailable" };

/**
 * A GET from a server component, as the visitor: their session cookie goes along, since what someone
 * may see depends on who they are (a demo visitor sees their own sandbox). A short timeout: a sleeping
 * free instance gets an honest "waking up" page instead of a hanging one.
 */
export async function serverGet<T>(path: string): Promise<ServerResult<T>> {
  const session = (await cookies()).get("torra_session")?.value;
  try {
    const response = await fetch(`${API_ORIGIN}/api${path}`, {
      headers: session ? { cookie: `torra_session=${session}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "ok", data: (await response.json()) as T };
  } catch {
    return { status: "unavailable" };
  }
}
