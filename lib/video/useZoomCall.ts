"use client";

/*
 * useZoomCall — React hook that owns the Video SDK lifecycle for one
 * `<CallSurface>` mount. Fetches a JWT from `zoom-video-sdk-token`, joins
 * the SDK client, tracks participants + connection state, and surfaces a
 * stable React API for the control bar / tiles / chat dock.
 *
 * State machine:  idle → fetching-token → joining → joined → reconnecting
 *                                                    ↓
 *                                                  ended | error
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { getVideoClient } from "./zoomClient";

type Status =
  | "idle"
  | "fetching-token"
  | "joining"
  | "joined"
  | "reconnecting"
  | "ended"
  | "error";

export type Participant = {
  userId: number;
  displayName: string;
  isHost: boolean;
  audio: { muted: boolean };
  video: { on: boolean };
  isCurrentUser: boolean;
};

export type UseZoomCallReturn = {
  status: Status;
  error: string | null;
  self: Participant | null;
  participants: Participant[];
  activeShareUserId: number | null;
  networkQuality: "good" | "fair" | "poor" | "unknown";
  leave: (endForAll?: boolean) => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /** Begin a screen share. Caller must have set `shareCanvasRef.current` to
   *  a real <canvas> element first — the SDK paints the local preview on it. */
  startShareScreen: () => Promise<void>;
  stopShareScreen: () => Promise<void>;
  client: ReturnType<typeof getVideoClient> extends Promise<infer C> ? C | null : null;
};

type Options = {
  sessionId: string;
  role: "host" | "guest";
  userName: string;
  /** Optional. When provided, screen-share + view-share render their content
   *  into this <video> element. The CallSurfaceInner hoists the ref so the
   *  share overlay can mount in the main pane. Video element is required
   *  for @zoom/videosdk 2.x with WebCodecs enabled. */
  shareCanvasRef?: React.MutableRefObject<HTMLVideoElement | null>;
};

export function useZoomCall({ sessionId, role, userName, shareCanvasRef }: Options): UseZoomCallReturn {
  const supabaseRef = useRef(createClient());
  const clientRef = useRef<Awaited<ReturnType<typeof getVideoClient>> | null>(null);
  const joinedKeyRef = useRef<string | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeShareUserId, setActiveShareUserId] = useState<number | null>(null);
  const [networkQuality, setNetworkQuality] = useState<"good" | "fair" | "poor" | "unknown">("unknown");
  const [tick, setTick] = useState(0); // bump to force re-render after SDK state changes

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // ── join lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    const key = `${sessionId}|${role}`;
    if (joinedKeyRef.current === key) return;
    joinedKeyRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        setStatus("fetching-token");
        const sb = supabaseRef.current;
        const { data, error: fnErr } = await sb.functions.invoke<{
          token: string; topic: string; session_key: string; user_identity: string; role_type: number; sdk_key: string;
        }>("zoom-video-sdk-token", { body: { session_id: sessionId } });
        if (cancelled) return;
        if (fnErr || !data?.token) {
          setError(fnErr?.message ?? "TOKEN_FETCH_FAILED");
          setStatus("error");
          return;
        }
        const client = await getVideoClient();
        clientRef.current = client;
        await client.init("en-US", "Global", { patchJsMedia: true });
        setStatus("joining");
        await client.join(data.topic, data.token, userName || "Relay user");
        if (cancelled) return;
        setStatus("joined");

        const onUserUpdate = () => refresh();
        const onConnection = (p: { state?: string }) => {
          if (p?.state === "Reconnecting") setStatus("reconnecting");
          else if (p?.state === "Connected") setStatus("joined");
          else if (p?.state === "Closed") setStatus("ended");
        };
        const onActiveShare = (p: { userId?: number; state?: string }) => {
          setActiveShareUserId(p?.state === "Active" && p?.userId ? p.userId : null);
        };
        const onNetwork = (p: { type?: string; level?: number }) => {
          if (p?.type !== "uplink") return;
          if ((p.level ?? 0) >= 4) setNetworkQuality("good");
          else if ((p.level ?? 0) >= 2) setNetworkQuality("fair");
          else setNetworkQuality("poor");
        };

        client.on("user-added", onUserUpdate);
        client.on("user-removed", onUserUpdate);
        client.on("user-updated", onUserUpdate);
        client.on("connection-change", onConnection);
        client.on("active-share-change", onActiveShare);
        client.on("network-quality-change", onNetwork);

        teardownRef.current = () => {
          try {
            client.off("user-added", onUserUpdate);
            client.off("user-removed", onUserUpdate);
            client.off("user-updated", onUserUpdate);
            client.off("connection-change", onConnection);
            client.off("active-share-change", onActiveShare);
            client.off("network-quality-change", onNetwork);
          } catch { /* listeners may already be gone */ }
        };

        refresh();
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      try { teardownRef.current?.(); } catch { /* ignore */ }
      teardownRef.current = null;
      // Leave gracefully; the singleton survives so HMR reconnects fast.
      const client = clientRef.current;
      if (client) {
        try { void client.leave(false); } catch { /* ignore */ }
      }
      joinedKeyRef.current = null;
    };
  }, [sessionId, role, userName, refresh]);

  // ── derive participants from the SDK on every tick ───────────────────
  const derived = useMemo<{ self: Participant | null; all: Participant[] }>(() => {
    const client = clientRef.current;
    if (!client) return { self: null, all: [] };
    try {
      const me = client.getCurrentUserInfo();
      const all = client.getAllUser();
      const toP = (u: any): Participant => ({
        userId: u.userId,
        displayName: String(u.displayName ?? "User"),
        isHost: !!u.isHost,
        audio: { muted: !!u.muted },
        video: { on: !!u.bVideoOn },
        isCurrentUser: !!me && u.userId === me.userId,
      });
      return {
        self: me ? toP(me) : null,
        all: Array.isArray(all) ? all.map(toP) : [],
      };
    } catch {
      return { self: null, all: [] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => { setParticipants(derived.all); }, [derived.all]);

  // ── controls ─────────────────────────────────────────────────────────
  const toggleMic = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    try {
      const me = client.getCurrentUserInfo();
      const audioOn = !me?.muted;
      if (audioOn) await ms.muteAudio();
      else await ms.unmuteAudio();
      refresh();
    } catch (e) { console.warn("[useZoomCall] toggleMic", e); }
  }, [refresh]);

  const toggleCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    try {
      const me = client.getCurrentUserInfo();
      if (me?.bVideoOn) await ms.stopVideo();
      else await ms.startVideo();
      refresh();
    } catch (e) { console.warn("[useZoomCall] toggleCamera", e); }
  }, [refresh]);

  const startShareScreen = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    const el = shareCanvasRef?.current;
    if (!el) {
      console.warn("[useZoomCall] startShareScreen needs a <video> element");
      return;
    }
    try {
      await ms.startShareScreen(el as unknown as HTMLCanvasElement);
    } catch (e) { console.warn("[useZoomCall] startShareScreen", e); }
  }, [shareCanvasRef]);

  const stopShareScreen = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    try { await ms.stopShareScreen(); } catch (e) { console.warn("[useZoomCall] stopShareScreen", e); }
  }, []);

  // When another participant becomes active sharer, render their share into
  // the same canvas. When share stops, tear it down.
  useEffect(() => {
    const client = clientRef.current;
    const canvas = shareCanvasRef?.current;
    if (!client || !canvas) return;
    const me = (() => { try { return client.getCurrentUserInfo(); } catch { return null; } })();
    const meId = me?.userId ?? -1;
    if (activeShareUserId === null) {
      // No active share; nothing to mount/unmount on the view side. If the
      // local user was the sharer, stopShareScreen() already tore it down.
      try { client.getMediaStream().stopShareView?.(); } catch { /* ignore */ }
      return;
    }
    if (activeShareUserId === meId) {
      // Local share — handled by startShareScreen which already wrote to the
      // canvas. Nothing to do.
      return;
    }
    // Remote share: render the other user's share onto our video element.
    (async () => {
      try {
        await client.getMediaStream().startShareView(canvas as unknown as HTMLCanvasElement, activeShareUserId);
      } catch (e) { console.warn("[useZoomCall] startShareView", e); }
    })();
    return () => {
      try { client.getMediaStream().stopShareView?.(); } catch { /* ignore */ }
    };
  }, [activeShareUserId, shareCanvasRef]);

  const leave = useCallback(async (endForAll?: boolean) => {
    const client = clientRef.current;
    if (client) { try { await client.leave(!!endForAll); } catch { /* may already be out */ } }
    // Always notify the server — the function uses caller role to decide
    // between participant_left (just post the ended message + audit) and
    // end_for_all (also stamp video_ended_at + fire summarize chain).
    try {
      await supabaseRef.current.functions.invoke("zoom-video-sdk-end", { body: { session_id: sessionId } });
    } catch (e) { console.warn("[useZoomCall] zoom-video-sdk-end failed", e); }
    setStatus("ended");
  }, [sessionId]);

  return {
    status, error,
    self: derived.self,
    participants,
    activeShareUserId,
    networkQuality,
    leave,
    toggleMic,
    toggleCamera,
    startShareScreen,
    stopShareScreen,
    client: clientRef.current as any,
  };
}
