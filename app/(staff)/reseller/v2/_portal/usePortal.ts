"use client";

/* Fetches GET /api/reseller/portal once for the command center, with a manual
 * refetch (after onboarding a company, etc.). Shared by Overview + Program. */

import { useCallback, useEffect, useState } from "react";
import type { PortalPayload } from "./types";

export function usePortal() {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `load` awaits before any setState, so the mount effect doesn't synchronously
  // set state (avoids cascading-render lint). `refetch` is for event handlers,
  // where flipping to a loading state up-front is fine.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reseller/portal", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status}).`);
      }
      setData((await res.json()) as PortalPayload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your portal.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    return load();
  }, [load]);

  useEffect(() => {
    // Fetch on mount. `load` awaits before any setState; the rule is
    // conservative about effect-reachable setState — this is the intended
    // fetch-on-mount pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { data, loading, error, refetch };
}
