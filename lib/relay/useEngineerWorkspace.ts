"use client";

/*
 * Engineer-side workspace state — used by /dashboard and /inbox.
 *
 * Tracks:
 *   - my active sessions (claimed_by = me, not terminal)
 *   - the live queue (status = queued, anyone)
 *   - recent call log (last 40 calls, any status)
 *
 * All three streams subscribe to guest_calls UPDATEs and refetch on change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";
import { isTransientNetworkError } from "./transient";

// Coerce anything (Error, object, string, etc.) to a useful display string.
// Avoids the dreaded "[object Object]" Next.js error overlay.
function asString(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  const err = e as {
    message?: unknown;
    error_description?: unknown;
    code?: unknown;
    details?: unknown;
  };
  if (typeof err.message === "string") return err.message;
  if (typeof err.error_description === "string") return err.error_description;
  if (typeof err.details === "string") return err.details;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export type WorkspaceState = {
  myActive: GuestCall[];
  queue: GuestCall[];
  recent: GuestCall[];
  loading: boolean;
  error: string | null;
  takeNext: () => Promise<GuestCall | null>;
  claim: (sessionId: string) => Promise<GuestCall | null>;
  refresh: () => Promise<void>;
  userId: string | null;
};

export function useEngineerWorkspace(): WorkspaceState {
  const [myActive, setMyActive] = useState<GuestCall[]>([]);
  const [queue, setQueue] = useState<GuestCall[]>([]);
  const [recent, setRecent] = useState<GuestCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    const sb = supabaseRef.current;
    setError(null);

    try {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) {
        setLoading(false);
        setError("Not signed in");
        return;
      }
      setUserId(u.user.id);

      // Three parallel queries. We catch each separately so one failure
      // doesn't tank the whole refresh.
      //
      // `recent` is scoped via engineer_recent_sessions RPC: an engineer
      // sees a session only if they personally claimed it, OR if it
      // shares a (customer_user_id, project_id) tuple with any session
      // they've claimed in the past. A brand-new engineer gets an empty
      // recent list until they take their first call. See migration
      // 20260521000000_engineer_recent_scope.sql.
      const [activeRes, queueRes, recentRes] = await Promise.all([
        sb
          .from("guest_calls")
          .select("*")
          .eq("claimed_by", u.user.id)
          .in("status", ["queued", "assigned", "joining", "live", "grace"])
          .order("created_at", { ascending: false })
          .then(
            (r) => r,
            (e) => ({ data: null, error: e })
          ),
        sb.rpc("list_queue").then(
          (r) => r,
          (e) => ({ data: null, error: e })
        ),
        sb
          .rpc("engineer_recent_sessions", {
            _engineer_id: u.user.id,
            _limit: 40,
          })
          .then(
            (r) => r,
            (e) => ({ data: null, error: e })
          ),
      ]);

      if (activeRes.error)
        console.warn("[workspace] active query:", asString(activeRes.error));
      if (queueRes.error)
        console.warn("[workspace] queue RPC:", asString(queueRes.error));
      if (recentRes.error)
        console.warn("[workspace] recent query:", asString(recentRes.error));

      setMyActive((activeRes.data as GuestCall[] | null) ?? []);
      setQueue((queueRes.data as GuestCall[] | null) ?? []);
      setRecent((recentRes.data as GuestCall[] | null) ?? []);
    } catch (e) {
      // Network failures, auth errors, anything else — never let this
      // function reject the calling promise (would crash render).
      if (isTransientNetworkError(e)) {
        console.warn("[workspace] transient network blip:", asString(e));
      } else {
        console.error("[workspace] refresh failed:", asString(e));
      }
      setError(asString(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch((e) => {
      if (isTransientNetworkError(e)) {
        console.warn("[workspace] transient network blip:", asString(e));
      } else {
        console.error("[workspace] unhandled:", asString(e));
      }
    });
  }, [refresh]);

  // Realtime — any guest_calls change refetches all three lists.
  //
  // The channel name must be unique per hook instance: Supabase's
  // realtime client shares channels by name, so when two components on
  // the same page (e.g. DashboardClient + StaffShell's FifoAutoRing)
  // both mount this hook with the same channel name, the second
  // .on() call lands AFTER the first .subscribe() resolved — and
  // realtime-js throws "cannot add postgres_changes callbacks after
  // subscribe()". A per-mount random suffix sidesteps the sharing.
  useEffect(() => {
    const sb = supabaseRef.current;
    const channelName = `relay-engineer-workspace-${
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }`;
    const ch = sb
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guest_calls" },
        () => {
          refresh().catch(() => {});
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
          setError("You need engineer access. Pick a role on /staff first.");
        } else {
          setError(msg);
        }
        setTimeout(() => setError(null), 4000);
        return null;
      }
      return (Array.isArray(data) ? data[0] : data) as GuestCall;
    },
    []
  );

  // Race-aware: on ALREADY_CLAIMED we silently refetch the live queue and try
  // the new head. Cap at 5 attempts so a hot queue doesn't loop forever.
  const takeNext = useCallback(async (): Promise<GuestCall | null> => {
    const sb = supabaseRef.current;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: list, error: listErr } = await sb.rpc("list_queue");
      if (listErr) {
        setError(asString(listErr));
        setTimeout(() => setError(null), 4000);
        return null;
      }
      const head = ((list ?? []) as GuestCall[])[0];
      if (!head) {
        setError("No calls waiting right now.");
        setTimeout(() => setError(null), 3000);
        return null;
      }
      const { data: claimed, error: e } = await sb.rpc("claim_session", {
        _session_id: head.id,
      });
      if (!e) {
        return (Array.isArray(claimed) ? claimed[0] : claimed) as GuestCall;
      }
      const msg = e.message ?? "";
      if (msg.includes("ALREADY_CLAIMED")) {
        // Another engineer beat us — quietly try the next head.
        continue;
      }
      setError(
        msg.includes("NOT_AUTHORIZED")
          ? "You need engineer access. Pick a role on /staff first."
          : asString(e)
      );
      setTimeout(() => setError(null), 4000);
      return null;
    }
    setError(
      "Couldn't claim a session — others are claiming faster. Try again."
    );
    setTimeout(() => setError(null), 4000);
    return null;
  }, []);

  return {
    myActive,
    queue,
    recent,
    loading,
    error,
    takeNext,
    claim,
    refresh,
    userId,
  };
}
