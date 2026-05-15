"use client";

/*
 * Single source of truth for the customer's active session.
 *
 * Contract:
 *   1. On mount, ensure auth → check for an EXISTING active session (read-only).
 *      We do NOT auto-create a session on mount — the customer must explicitly
 *      start one via the project-name form. This prevents the ConnectingModal
 *      from popping up on every page load.
 *   2. Subscribe to that session's row via Postgres CDC (Realtime).
 *   3. Subscribe to incoming messages for that session.
 *   4. Expose state-driven booleans for the UI to react to.
 *   5. Provide actions: recall(), cancel(), sendMessage(), startNewSession().
 *
 * Reconnection: on Realtime drop we re-fetch the session row authoritatively
 * (the server is the truth). No replay buffers, no sequence numbers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall, GuestMessage, SessionStatus } from "@/lib/supabase/types";
import { isTransientNetworkError } from "./transient";
import { uploadOne, validateStagedFiles } from "./chatAttachments";

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
  startNewSession: (projectId?: string) => Promise<GuestCall | null>;
  /** Send a message; auto-creates a session if none exists or current is
   *  terminal (cancelled/abandoned). Returns the resolved session id. */
  sendOrStart: (body: string, projectId?: string) => Promise<void>;
  /** Bundled send: text + up to N files in a single chat bubble.
   *  Bootstraps a session if needed. */
  sendBundle: (payload: { text: string; files: File[]; projectId?: string }) => Promise<void>;
};

const TERMINAL_STATES: SessionStatus[] = ["ended", "abandoned", "cancelled"];

// Statuses where a session is still "in progress" (not yet terminal).
const ACTIVE_STATUSES: SessionStatus[] = [
  "queued", "assigned", "joining", "live", "grace", "ending", "expired_free",
];

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

  // ── Read-only mount: look for an existing active session ──────────────────
  // Does NOT call get_or_create — we never auto-create on page load.
  // This prevents the ConnectingModal from firing every time the user opens
  // the app. Session creation only happens via startNewSession() after the
  // customer has gone through the project-name form.
  // A queued session that's more than 10 min old without an engineer claim
  // is almost certainly a ghost (browser closed mid-wait, test run, etc.).
  // Silently cancel it so the sidebar doesn't show "Current session / Connecting…"
  // on every page load.
  // 90 seconds — matches the ConnectingModal's "No answer" boundary and
  // the server-side abandon_stale_queued_sessions() interval. Once the
  // customer has crossed that line and abandoned (e.g. signed out), we
  // don't want the next login to inherit the stale queue + modal.
  const STALE_QUEUED_MS = 90_000;

  const loadExisting = useCallback(async (): Promise<void> => {
    if (auth.kind !== "authed") return;
    setLoading(true);
    setError(null);
    const sb = supabaseRef.current;
    try {
      const { data, error: qErr } = await sb
        .from("guest_calls")
        .select("*")
        .eq("customer_user_id", auth.userId)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (qErr) {
        console.warn("[customer-session] loadExisting query:", asString(qErr));
      }
      let row = (data as GuestCall | null) ?? null;

      // Stale-queued cleanup: if the session is still queued but was created
      // more than 30 minutes ago, cancel it silently so it doesn't appear as
      // "Current session / Connecting…" every time the user opens the app.
      if (row && row.status === "queued") {
        const ageMs = Date.now() - new Date(row.created_at).getTime();
        if (ageMs > STALE_QUEUED_MS) {
          void (async () => { await sb.rpc("cancel_customer_session", { _session_id: row!.id }); })();
          row = null;
        }
      }

      setSession(row);
      if (row) {
        const { data: msgs } = await sb
          .from("guest_messages")
          .select("*, attachments:guest_message_attachments(*)")
          .eq("guest_call_id", row.id)
          .order("created_at", { ascending: true });
        setMessages((msgs ?? []) as GuestMessage[]);
      } else {
        setMessages([]);
      }
    } catch (e) {
      if (isTransientNetworkError(e)) {
        console.warn("[customer-session] transient network blip (loadExisting):", asString(e));
      } else {
        console.error("[customer-session] loadExisting failed:", asString(e));
      }
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    loadExisting().catch((e) => {
      if (isTransientNetworkError(e)) {
        console.warn("[customer-session] transient network blip:", asString(e));
      } else {
        console.error("[customer-session] unhandled:", asString(e));
      }
    });
  }, [loadExisting]);

  // ── Create (or re-fetch) a session via get_or_create RPC ─────────────────
  // Called only when the user explicitly starts a new session through the UI.
  const loadSession = useCallback(async (projectId?: string): Promise<GuestCall | null> => {
    if (auth.kind !== "authed") return null;
    setLoading(true);
    setError(null);
    const sb = supabaseRef.current;
    try {
      const rpcArgs = projectId ? { _project_id: projectId } : undefined;
      const { data, error: rpcErr } = await sb.rpc(
        "get_or_create_active_customer_session",
        rpcArgs,
      );
      if (rpcErr) {
        const msg = asString(rpcErr);
        console.warn("[customer-session] RPC error:", msg);
        if (msg.includes("NO_ENTITLEMENT")) {
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
          // The realtime payload only carries the parent row. If the
          // message has attachments, the child rows were inserted in a
          // follow-up batch — pull them so the bubble renders correctly.
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          void (async () => {
            const { data } = await sb
              .from("guest_message_attachments")
              .select("*")
              .eq("message_id", m.id);
            if (!data || data.length === 0) return;
            setMessages((prev) =>
              prev.map((x) =>
                x.id === m.id
                  ? { ...x, attachments: data as GuestMessage["attachments"] }
                  : x,
              ),
            );
          })();
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

  const startNewSession = useCallback(async (projectId?: string): Promise<GuestCall | null> => {
    // Clear local state so the user sees a "loading" beat instead of the
    // stale terminal-state session, then re-call the RPC which will
    // happily create a fresh queued row (the previous one is terminal).
    setSession(null);
    setMessages([]);
    return await loadSession(projectId);
  }, [loadSession]);

  /** Composer-friendly action: if there's no active session (or the current
   *  one is terminal), start a new one, then insert the message into that
   *  brand-new session row.  Side-steps the React state-flush race where
   *  state.session is stale immediately after startNewSession. */
  const sendOrStart = useCallback(async (body: string, projectId?: string) => {
    if (!body.trim()) return;
    const sb = supabaseRef.current;
    let s = session;
    if (!s || TERMINAL_STATES.includes(s.status)) {
      s = await startNewSession(projectId);
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

  /** Bundled send: text + 0..N attachments arrive as a single chat bubble.
   *  Bootstraps a session if needed (mirrors sendOrStart), uploads each
   *  file to storage, inserts the parent message row, then inserts the
   *  child attachment rows. */
  const sendBundle = useCallback(
    async (payload: { text: string; files: File[]; projectId?: string }) => {
      const text = payload.text.trim();
      if (!text && payload.files.length === 0) return;

      const validation = validateStagedFiles(payload.files);
      if (!validation.ok) {
        setError(validation.error);
        setTimeout(() => setError(null), 4000);
        return;
      }

      const sb = supabaseRef.current;
      let s = session;
      if (!s || TERMINAL_STATES.includes(s.status)) {
        s = await startNewSession(payload.projectId);
      }
      if (!s) return;

      try {
        const uploaded = await Promise.all(
          validation.classified.map((c) =>
            uploadOne({ sb, sessionId: s!.id, file: c.file, kind: c.kind }),
          ),
        );

        const { data: msgRow, error: mErr } = await sb
          .from("guest_messages")
          .insert({
            guest_call_id: s.id,
            sender_kind: "guest",
            sender_name: s.guest_name,
            body: text ? text : null,
          })
          .select()
          .single();
        if (mErr || !msgRow) {
          setError(mErr?.message ?? "Send failed.");
          return;
        }

        if (uploaded.length > 0) {
          const rows = uploaded.map((u) => ({
            message_id: (msgRow as GuestMessage).id,
            path: u.path,
            name: u.name,
            mime: u.mime,
            size_bytes: u.size,
            kind: u.kind,
          }));
          const { error: aErr } = await sb
            .from("guest_message_attachments")
            .insert(rows);
          if (aErr) {
            setError(aErr.message);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed.");
      }
    },
    [session, startNewSession],
  );

  // Memoize the refresh closure so its identity stays stable across renders
  // (loadExisting is stable thanks to its own useCallback).
  const refresh = useCallback(async () => { await loadExisting(); }, [loadExisting]);

  // Memoize the return object so consumers that wrap with React.memo don't
  // see a new reference on every render. Every entry below is already
  // useState/useCallback-stable, so this useMemo never busy-busts.
  return useMemo(() => ({
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
    refresh,
    startNewSession,
    sendOrStart,
    sendBundle,
  }), [
    auth, session, messages, entitlement, loading, error,
    recall, cancel, end, markJoined, sendMessage, refresh, startNewSession, sendOrStart, sendBundle,
  ]);
}
