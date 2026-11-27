"use client";

import type { DemoPersona, DemoStatus, Me } from "@torra/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "./api";
import { useSetMe } from "./session";

const HOME: Record<DemoPersona, string> = { customer: "/conta", admin: "/admin" };

/** Which of the demo's two people this account is. */
export function personaOf(me: Me): DemoPersona {
  return me.role === "admin" ? "admin" : "customer";
}

/**
 * Starts a demo as a persona, or switches to the other inside the current one. Everything cached for the
 * previous person is dropped, and the interface opens on the new person's side.
 */
export function useEnterDemo() {
  const setMe = useSetMe();
  const router = useRouter();
  const [busy, setBusy] = useState<DemoPersona | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function enter(persona: DemoPersona) {
    setBusy(persona);
    setFailure(null);
    try {
      const me = await api<Me>("/demo", { body: { persona } });
      setMe(null); // drops what the previous person's pages had loaded
      setMe(me);
      router.push(HOME[persona]);
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : "Não foi possível abrir a demonstração.");
    } finally {
      setBusy(null);
    }
  }

  return { enter, busy, failure };
}

/**
 * Whether the demo's orders are written yet (they're made in the background, seconds after it opens).
 * When they are, the pages that list orders load them again.
 */
export function useDemoReady(enabled: boolean): boolean {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ["demo", "status"],
    queryFn: () => api<DemoStatus>("/demo/status"),
    enabled,
    refetchInterval: (query) => (query.state.data?.ready ? false : 1500),
  });
  const ready = data?.ready ?? true;
  useEffect(() => {
    if (enabled && data?.ready) {
      void client.invalidateQueries({ queryKey: ["orders"] });
      void client.invalidateQueries({ queryKey: ["admin"] });
    }
  }, [enabled, data?.ready, client]);
  return ready;
}
