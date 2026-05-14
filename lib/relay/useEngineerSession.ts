"use client";

/*
 * Engineer-side session hook.
 * Loads + subscribes to a single guest_call by id, plus its messages.
 * Exposes engineer actions: sendMessage, end, release, markJoined.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall, GuestMessage } from "@/lib/supabase/types";
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

export type EngineerSessionState = {
  session: GuestCall | null;
  messages: GuestMessage[];
  loading: boolean;
  error: string | null;
  sendMessage: (body: string) => Promise<void>;
  sendBundle:  (payload: { text: string; files: File[] }) => Promise<void>;
  end: (reason?: string) => Promise<void>;
  release: () => Promise<void>;
  markJoined: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Auth user id of the viewer. Used to decide engineer vs monitor mode. */
  viewerUserId: string | null;
  /** True when the viewer is the engineer claimed_by on this session.
   *  False for any other staff (supervisor / admin viewing read-only). */
  isAssignedEngineer: boolean;
};

export function useEngineerSession(sessionId: string): EngineerSessionState {
  const [session, setSession] = useState<GuestCall | null>(null);
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sb = supabaseRef.current;
    try {
      // Fetch the viewer identity in parallel with session data so
      // isAssignedEngineer is correct on the very first render after load.
      const [userRes, callRes, msgRes] = await Promise.all([
        sb.auth.getUser().catch(() => ({ data: { user: null } })),
        sb.from("guest_calls").select("*").eq("id", sessionId).maybeSingle()
          .then((r) => r, (e) => ({ data: null, error: e })),
        sb.from("guest_messages")
          .select("*, attachments:guest_message_attachments(*)")
          .eq("guest_call_id", sessionId)
          .order("created_at")
          .then((r) => r, (e) => ({ data: null, error: e })),
      ]);
      setViewerUserId(userRes.data.user?.id ?? null);
      if (callRes.error) {
        console.warn("[eng-session] call query:", asString(callRes.error));
        setError(asString(callRes.error));
      }
      setSession((callRes.data as GuestCall | null) ?? null);
      setMessages(((msgRes.data ?? []) as GuestMessage[]));
    } catch (e) {
      if (isTransientNetworkError(e)) {
        console.warn("[eng-session] transient network blip:", asString(e));
      } else {
        console.error("[eng-session] refresh failed:", asString(e));
      }
      setError(asString(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh().catch((e) => {
      if (isTransientNetworkError(e)) {
        console.warn("[eng-session] transient network blip:", asString(e));
      } else {
        console.error("[eng-session] unhandled:", asString(e));
      }
    });
  }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;
    const sb = supabaseRef.current;
    const ch = sb
      .channel(`relay-eng-session:${sessionId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "guest_calls", filter: `id=eq.${sessionId}` },
        (p) => setSession((prev) => ({ ...(prev as GuestCall), ...(p.new as GuestCall) })))
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "guest_messages", filter: `guest_call_id=eq.${sessionId}` },
        (p) => {
          const m = p.new as GuestMessage;
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
          // Hydrate attachments (if any) on the next tick — realtime only
          // carries the parent row.
          void (async () => {
            const { data } = await sb
              .from("guest_message_attachments")
              .select("*")
              .eq("message_id", m.id);
            if (!data || data.length === 0) return;
            setMessages((prev) =>
              prev.map((x) =>
                x.id === m.id ? { ...x, attachments: data as GuestMessage["attachments"] } : x,
              ),
            );
          })();
        })
      .subscribe();
    channelRef.current = ch;
    return () => { sb.removeChannel(ch); channelRef.current = null; };
  }, [sessionId]);

  const sendMessage = useCallback(async (body: string) => {
    if (!session || !body.trim()) return;
    if (["ended","abandoned","cancelled"].includes(session.status)) {
      setError("This session has ended.");
      return;
    }
    const sb = supabaseRef.current;
    const { error: e } = await sb.from("guest_messages").insert({
      guest_call_id: sessionId,
      sender_kind: "engineer",
      sender_name: session.agent_name ?? "Engineer",
      body: body.trim(),
    });
    if (e) setError(e.message);
  }, [session, sessionId]);

  /** Bundled send: text + 0..N attachments as a single chat bubble. */
  const sendBundle = useCallback(
    async (payload: { text: string; files: File[] }) => {
      const text = payload.text.trim();
      if (!session) return;
      if (["ended", "abandoned", "cancelled"].includes(session.status)) {
        setError("This session has ended.");
        return;
      }
      if (!text && payload.files.length === 0) return;

      const validation = validateStagedFiles(payload.files);
      if (!validation.ok) {
        setError(validation.error);
        setTimeout(() => setError(null), 4000);
        return;
      }

      const sb = supabaseRef.current;
      try {
        const uploaded = await Promise.all(
          validation.classified.map((c) =>
            uploadOne({ sb, sessionId, file: c.file, kind: c.kind }),
          ),
        );
        const { data: msgRow, error: mErr } = await sb
          .from("guest_messages")
          .insert({
            guest_call_id: sessionId,
            sender_kind: "engineer",
            sender_name: session.agent_name ?? "Engineer",
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
          if (aErr) setError(aErr.message);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed.");
      }
    },
    [session, sessionId],
  );

  const end = useCallback(async (reason = "engineer_ended") => {
    const sb = supabaseRef.current;
    const { error: e } = await sb.rpc("end_session", { _session_id: sessionId, _reason: reason });
    if (e) { setError(e.message); return; }
    // Fire-and-forget: kick off AI summary generation
    void sb.functions.invoke("summarize-guest-call", {
      body: { guest_call_id: sessionId },
    });
  }, [sessionId]);

  const release = useCallback(async () => {
    const sb = supabaseRef.current;
    const { error: e } = await sb.rpc("release_session", { _session_id: sessionId });
    if (e) setError(e.message);
  }, [sessionId]);

  const markJoined = useCallback(async () => {
    const sb = supabaseRef.current;
    const { error: e } = await sb.rpc("mark_joined", { _session_id: sessionId, _role: "engineer" });
    if (e) setError(e.message);
  }, [sessionId]);

  const isAssignedEngineer = !!viewerUserId && !!session?.claimed_by && viewerUserId === session.claimed_by;

  return {
    session, messages, loading, error,
    sendMessage, sendBundle, end, release, markJoined, refresh,
    viewerUserId, isAssignedEngineer,
  };
}
