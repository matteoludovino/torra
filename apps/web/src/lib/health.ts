import { healthResponse, isSupportedVersion } from "@torra/shared";

export type ServerState = "online" | "offline" | "outdated";

/** Pings the API (which also wakes a sleeping instance) and checks it speaks a version we understand. */
export async function checkServer(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ServerState> {
  try {
    const response = await fetcher("/api/health", { cache: "no-store", signal });
    if (!response.ok) return "offline";
    const parsed = healthResponse.safeParse(await response.json());
    if (!parsed.success) return "offline";
    return isSupportedVersion(parsed.data.version) ? "online" : "outdated";
  } catch {
    return "offline";
  }
}
