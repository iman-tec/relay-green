"use client";

/*
 * Engineer-side: subscribes to the live queue of QUEUED sessions.
 *
 * Strategy:
 *   1. Initial fetch via list_queue() RPC (RLS-checked).
 *   2. Subscribe to ALL guest_calls UPDATEs and re-filter client-side. We
 *      could narrow with a filter clause but the queue is small enough
 *      that broad subscription + client filter is simpler and resilient.
 *   3. On any change to a row that's queued or recently un-queued, refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

export type EngineerQueueState = {
  queue: GuestCall[];
  loading: boolean;
  error: string | null;
  claim: (sessionId: string) => Promise<GuestCall | null>;
  refresh: () => Promise<void>;
};

export function useEngineerQueue(): EngineerQueueState {
  const [queue, setQueue] = useState<GuestCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    const sb = supabaseRef.current;
    setError(null);
    const { data, error: e } = await sb.rpc("list_queue");
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setQueue((data as GuestCall[]) ?? []);
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime subscription — any guest_calls change triggers refetch
  useEffect(() => {
    const sb = supabaseRef.current;
    const ch = sb
      .channel("relay-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guest_calls" },
        () => {
          void refresh();
        }
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      sb.removeChannel(ch);
      channelRef.current = null;
    };
  }, [refresh]);

  const claim = useCallback(
    async (sessionId: string): Promise<GuestCall | null> => {
      const sb = supabaseRef.current;
      const { data, error: e } = await sb.rpc("claim_session", {
        _session_id: sessionId,
      });
      if (e) {
        const msg = e.message ?? "";
        if (msg.includes("ALREADY_CLAIMED")) {
          setError("Another engineer just took this one.");
        } else if (msg.includes("NOT_AUTHORIZED")) {
          setError("You don't have engineer access.");
        } else {
          setError(msg);
        }
        setTimeout(() => setError(null), 4000);
        return null;
      }
      const row = (Array.isArray(data) ? data[0] : data) as GuestCall;
      return row ?? null;
    },
    []
  );

  return { queue, loading, error, claim, refresh };
}
