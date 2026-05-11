"use client";

/*
 * Single source of truth for the customer's active session.
 *
 * Contract:
 *   1. On mount, ensure auth → call get_or_create_active_customer_session().
 *   2. Subscribe to that session's row via Postgres CDC (Realtime).
 *   3. Subscribe to incoming messages for that session.
 *   4. Expose state-driven booleans for the UI to react to.
 *   5. Provide actions: recall(), cancel(), sendMessage().
 *
 * Reconnection: on Realtime drop we re-fetch the session row authoritatively
 * (the server is the truth). No replay buffers, no sequence numbers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall, GuestMessage, SessionStatus } from "@/lib/supabase/types";
import { isTransientNetworkError } from "./transient";

function asString(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  const err = e as { message?: unknown; error_description?: unknown; details?: unknown };
  if (typeof err.message === "string") return err.message;
  if (typeof err.error_description === "string") return err.error_description;
  if (typeof err.details === "string") return err.details;
  try { return JSON.stringify(e); } catch { return String(e); }
}

type AuthState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authed"; userId: string; email: string };

export type Entitlement = {
  free_consumed_at: string | null;     // when their free 10-min was used up
  free_minutes_used: number;            // cumulative minutes across all ended sessions
  paid_minutes_remaining: number;       // from credit_wallets (Phase 3.5)
};

export type CustomerSessionState = {
  auth: AuthState;
  session: GuestCall | null;
  messages: GuestMessage[];
  entitlement: Entitlement;             // for the profile chip
  loading: boolean;
  error: string | null;
  // Action helpers
  recall: () => Promise<void>;
  cancel: () => Promise<void>;
  end: (reason?: string) => Promise<void>;
  markJoined: () => Promise<void>;
  sendMessage: (body: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Force-load a brand-new session (used after cancel/abandon).
   *  Returns the new GuestCall row so callers can chain on it immediately
   *  without waiting for React state to flush. */
  startNewSession: () => Promise<GuestCall | null>;
  /** Send a message; auto-creates a session if none exists or current is
   *  terminal (cancelled/abandoned). Returns the resolved session id. */
  sendOrStart: (body: string) => Promise<void>;
};

const TERMINAL_STATES: SessionStatus[] = ["ended", "abandoned", "cancelled"];

export function useCustomerSession(): CustomerSessionState {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });
  const [session, setSession] = useState<GuestCall | null>(null);
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [entitlement, setEntitlement] = useState<Entitlement>({
    free_consumed_at: null,
    free_minutes_used: 0,
    paid_minutes_remaining: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  // ── Auth bootstrap ────────────────────────────────────────────────────────
  useEffect(() => {
    const sb = supabaseRef.current;
    let cancelled = false;

    sb.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) {
        setAuth({ kind: "anonymous" });
        setLoading(false);
        return;
      }
      setAuth({
        kind: "authed",
        userId: data.user.id,
        email: data.user.email ?? "",
      });
    }, (e) => {
      if (cancelled) return;
      console.warn("[customer-session] getUser failed:", asString(e));
      setAuth({ kind: "anonymous" });
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, sess) => {
      if (sess?.user) {
        setAuth({ kind: "authed", userId: sess.user.id, email: sess.user.email ?? "" });
      } else {
        setAuth({ kind: "anonymous" });
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ── Fetch or create session once authed ───────────────────────────────────
  const loadSession = useCallback(async (): Promise<GuestCall | null> => {
    if (auth.kind !== "authed") return null;
    setLoading(true);
    setError(null);
    const sb = supabaseRef.current;
    try {
      const { data, error: rpcErr } = await sb.rpc(
        "get_or_create_active_customer_session",
      );
      if (rpcErr) {
        const msg = asString(rpcErr);
        console.warn("[customer-session] RPC error:", msg);
        if (msg.includes("NO_ENTITLEMENT")) {
          // Caller should show paywall — surface a typed error
          setError("NO_ENTITLEMENT");
          setSession(null);
          return null;
        }
        setError(msg);
        setSession(null);
        return null;
      }
      const row = (Array.isArray(data) ? data[0] : data) as GuestCall;
      if (!row) {
        setError("Could not load session");
        setSession(null);
        return null;
      }
      setSession(row);

      // Load messages for this session
      const { data: msgs } = await sb
        .from("guest_messages")
        .select("*")
        .eq("guest_call_id", row.id)
        .order("created_at", { ascending: true });
      setMessages((msgs ?? []) as GuestMessage[]);
      return row;
    } catch (e) {
      if (isTransientNetworkError(e)) {
        console.warn("[customer-session] transient network blip:", asString(e));
      } else {
        console.error("[customer-session] loadSession failed:", asString(e));
      }
      setError(asString(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    loadSession().catch((e) => {
      if (isTransientNetworkError(e)) {
        console.warn("[customer-session] transient network blip:", asString(e));
      } else {
        console.error("[customer-session] unhandled:", asString(e));
      }
    });
  }, [loadSession]);

  // Load entitlement (free time used, paid balance) whenever auth/session changes
  useEffect(() => {
    if (auth.kind !== "authed") return;
    const sb = supabaseRef.current;
    void (async () => {
      // free_session_consumed_at from customer_entitlements
      const { data: ent } = await sb
        .from("customer_entitlements")
        .select("free_session_consumed_at")
        .eq("customer_user_id", auth.userId)
        .maybeSingle();
      // total minutes used across ended sessions
      const { data: ended } = await sb
        .from("guest_calls")
        .select("duration_minutes, free_minutes_used")
        .eq("customer_user_id", auth.userId)
        .eq("status", "ended");
      const totalUsed = (ended ?? []).reduce((sum, r: { duration_minutes: number | null; free_minutes_used: number | null }) => {
        const used = Number(r.free_minutes_used) || Number(r.duration_minutes) || 0;
        return sum + used;
      }, 0);
      const wallet = await sb.from("credit_wallets").select("balance").eq("user_id", auth.userId).maybeSingle();
      setEntitlement({
        free_consumed_at: (ent as { free_session_consumed_at: string | null } | null)?.free_session_consumed_at ?? null,
        free_minutes_used: totalUsed,
        paid_minutes_remaining: Number(wallet.data?.balance ?? 0),
      });
    })();
  }, [auth.kind, "userId" in auth ? auth.userId : null, session?.status, session?.id]);

  // ── Realtime subscription on the session row + messages ───────────────────
  useEffect(() => {
    if (!session) return;
    const sb = supabaseRef.current;
    const sessionId = session.id;

    const ch = sb
      .channel(`relay-session:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guest_calls", filter: `id=eq.${sessionId}` },
        (payload) => setSession((prev) => ({ ...(prev as GuestCall), ...(payload.new as GuestCall) })),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "guest_messages", filter: `guest_call_id=eq.${sessionId}` },
        (payload) => {
          const m = payload.new as GuestMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .subscribe();

    channelRef.current = ch;
    return () => {
      sb.removeChannel(ch);
      channelRef.current = null;
    };
  }, [session?.id]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const recall = useCallback(async () => {
    if (!session) return;
    const sb = supabaseRef.current;
    const { error: e } = await sb.rpc("recall_engineer", { _session_id: session.id });
    if (e) {
      // Friendly mapping for known errors
      const code = e.message ?? "";
      if (code.includes("RATE_LIMITED")) {
        setError("Just sent — give it a moment before recalling again.");
      } else if (code.includes("RECALL_CAP_REACHED")) {
        setError("Recall limit reached for this session.");
      } else if (code.includes("INVALID_STATE")) {
        setError("Cannot recall once the call is live.");
      } else {
        setError(e.message);
      }
      setTimeout(() => setError(null), 4000);
    }
  }, [session]);

  const cancel = useCallback(async () => {
    if (!session) return;
    const sb = supabaseRef.current;
    const { error: e } = await sb.rpc("cancel_customer_session", { _session_id: session.id });
    if (e) setError(e.message);
  }, [session]);

  const end = useCallback(async (reason: string = "customer_ended") => {
    if (!session) return;
    const sb = supabaseRef.current;
    const { error: e } = await sb.rpc("end_session", { _session_id: session.id, _reason: reason });
    if (e) { setError(e.message); return; }
    // Fire-and-forget the AI summary
    void sb.functions.invoke("summarize-guest-call", { body: { guest_call_id: session.id } });
  }, [session]);

  const markJoined = useCallback(async () => {
    if (!session) return;
    const sb = supabaseRef.current;
    const { error: e } = await sb.rpc("mark_joined", {
      _session_id: session.id,
      _role: "customer",
    });
    if (e) setError(e.message);
  }, [session]);

  const sendMessage = useCallback(async (body: string) => {
    if (!session || !body.trim()) return;
    if (TERMINAL_STATES.includes(session.status)) {
      setError("This session has ended.");
      return;
    }
    const sb = supabaseRef.current;
    const { error: e } = await sb.from("guest_messages").insert({
      guest_call_id: session.id,
      sender_kind: "guest",
      sender_name: session.guest_name,
      body: body.trim(),
    });
    if (e) setError(e.message);
  }, [session]);

  const startNewSession = useCallback(async (): Promise<GuestCall | null> => {
    // Clear local state so the user sees a "loading" beat instead of the
    // stale terminal-state session, then re-call the RPC which will
    // happily create a fresh queued row (the previous one is terminal).
    setSession(null);
    setMessages([]);
    return await loadSession();
  }, [loadSession]);

  /** Composer-friendly action: if there's no active session (or the current
   *  one is terminal), start a new one, then insert the message into that
   *  brand-new session row.  Side-steps the React state-flush race where
   *  state.session is stale immediately after startNewSession. */
  const sendOrStart = useCallback(async (body: string) => {
    if (!body.trim()) return;
    const sb = supabaseRef.current;
    let s = session;
    if (!s || TERMINAL_STATES.includes(s.status)) {
      s = await startNewSession();
    }
    if (!s) return;
    const { error: e } = await sb.from("guest_messages").insert({
      guest_call_id: s.id,
      sender_kind: "guest",
      sender_name: s.guest_name,
      body: body.trim(),
    });
    if (e) setError(e.message);
  }, [session, startNewSession]);

  return {
    auth,
    session,
    messages,
    entitlement,
    loading,
    error,
    recall,
    cancel,
    end,
    markJoined,
    sendMessage,
    refresh: async () => { await loadSession(); },
    startNewSession,
    sendOrStart,
  };
}
