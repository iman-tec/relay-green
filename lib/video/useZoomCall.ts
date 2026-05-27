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
  /** Canvas element ref used for screen-share when SDK is in fallback
   *  (non-WebCodecs) mode. The host renders both canvas + video and
   *  useZoomCall tries them in order. */
  shareCanvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Video element ref used for screen-share when SDK is in WebCodecs
   *  mode (i.e. SAB / COOP+COEP available). */
  shareVideoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** Callback fired when the SDK accepts one of the elements — lets the
   *  parent flip ShareViewer to show that element. */
  onShareElementChange?: (mode: "canvas" | "video" | null) => void;
};

export function useZoomCall({ sessionId, role, userName, shareCanvasRef, shareVideoRef, onShareElementChange }: Options): UseZoomCallReturn {
  const supabaseRef = useRef(createClient());
  const clientRef = useRef<Awaited<ReturnType<typeof getVideoClient>> | null>(null);
  const joinedKeyRef = useRef<string | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  // Set to true once `leave()` has run so the unmount cleanup doesn't
  // race a second `client.leave()` against the in-flight first one — the
  // SDK occasionally wedges when two leaves overlap.
  const leftRef = useRef(false);

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
        // SharedArrayBuffer is unavailable on plain-HTTP localhost (no
        // COOP/COEP headers) so we tell the SDK to use the multi-video
        // fallback path. patchJsMedia keeps the media deps current.
        // enforceVirtualBackground=true + enforceMultipleVideos=true is
        // the combo Zoom recommends for environments without SAB.
        try {
          await client.init("en-US", "Global", {
            patchJsMedia: true,
            enforceMultipleVideos: true,
            enforceVirtualBackground: true,
            leaveOnPageUnload: true,
          });
        } catch (initErr) {
          console.error("[useZoomCall] init failed:", initErr);
          if (cancelled) return;
          setError(`init failed: ${initErr instanceof Error ? initErr.message : String(initErr)}`);
          setStatus("error");
          return;
        }
        setStatus("joining");
        try {
          await client.join(data.topic, data.token, userName || "Relay user");
        } catch (joinErr) {
          console.error("[useZoomCall] join failed:", joinErr);
          if (cancelled) return;
          setError(`join failed: ${joinErr instanceof Error ? joinErr.message : String(joinErr)}`);
          setStatus("error");
          return;
        }
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

        // Seed activeShareUserId from current room state — listeners above
        // only catch FUTURE active-share-change events. If we joined while
        // someone was already sharing, the SDK doesn't replay the event,
        // so without this query the remote share never renders for us.
        try {
          const users = client.getAllUser();
          const sharer = Array.isArray(users)
            ? users.find((u: any) => u && (u.bShareOn || u.sharerOn))
            : null;
          if (sharer && typeof sharer.userId === "number") {
            setActiveShareUserId(sharer.userId);
          }
        } catch (e) { console.warn("[useZoomCall] active-share probe", e); }

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
      // If explicit `leave()` already ran, the SDK is mid-leave or done —
      // don't fire a second leave. The race wedges the SDK on rejoin.
      if (!leftRef.current) {
        const client = clientRef.current;
        if (client) {
          try { void client.leave(false); } catch { /* ignore */ }
        }
        // Unmount-without-explicit-leave path (nav away, tab close, parent
        // unmounts CallSurface). Notify the server so the session row
        // doesn't stay stuck in 'live' — without this, the next page load
        // still shows "you are on a call". sendBeacon is unload-safe;
        // functions.invoke isn't.
        try {
          const sb = supabaseRef.current;
          const session = (sb as unknown as { auth?: { session?: () => any } }).auth;
          // Best-effort: post to the function's invoke URL via beacon. The
          // function reads session_id from the JSON body and tolerates
          // unauth (relies on the row state). If beacon is unavailable
          // (very old browsers) we fall back to a fire-and-forget invoke.
          const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/zoom-video-sdk-end`;
          const body = JSON.stringify({ session_id: sessionId });
          if (typeof navigator !== "undefined" && navigator.sendBeacon && url) {
            navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
          } else {
            void sb.functions.invoke("zoom-video-sdk-end", { body: { session_id: sessionId } });
          }
        } catch (e) { console.warn("[useZoomCall] cleanup end-notify", e); }
      }
      joinedKeyRef.current = null;
      leftRef.current = false;
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
    const canvas = shareCanvasRef?.current;
    const video = shareVideoRef?.current;
    if (!canvas && !video) {
      console.warn("[useZoomCall] startShareScreen needs a <canvas> or <video> element");
      return;
    }
    // The SDK picks between canvas vs video at runtime based on WebCodecs
    // availability. We try canvas first (works in our localhost dev with
    // enforceMultipleVideos fallback) and fall back to video on the SDK's
    // specific 6003 "Use Video element" error.
    const looksLikeWrongType = (e: unknown): boolean => {
      const r = e as { errorCode?: number; reason?: string } | null;
      return r?.errorCode === 6003 && typeof r.reason === "string"
        && /Video element|HTMLVideoElement/i.test(r.reason);
    };
    // The SDK sometimes RETURNS an error-shaped object instead of throwing.
    // A real success resolves to undefined / a stream handle without an
    // errorCode — anything carrying errorCode is a failure regardless of
    // type. Only flip the UI to "sharing" after a confirmed success.
    const isErrorReturn = (r: unknown): boolean => {
      return !!r && typeof r === "object" && "errorCode" in (r as object);
    };
    if (canvas) {
      try {
        const res = await ms.startShareScreen(canvas);
        if (isErrorReturn(res)) {
          if (looksLikeWrongType(res) && video) {
            // fall through to video retry
          } else {
            console.warn("[useZoomCall] startShareScreen (canvas) failed", res);
            return;
          }
        } else {
          onShareElementChange?.("canvas");
          return;
        }
      } catch (e) {
        if (!looksLikeWrongType(e) || !video) {
          console.warn("[useZoomCall] startShareScreen (canvas)", e);
          return;
        }
        // fall through to video retry
      }
    }
    if (video) {
      try {
        const res = await ms.startShareScreen(video as unknown as HTMLCanvasElement);
        if (isErrorReturn(res)) {
          console.warn("[useZoomCall] startShareScreen (video) failed", res);
          return;
        }
        onShareElementChange?.("video");
      } catch (e) { console.warn("[useZoomCall] startShareScreen (video)", e); }
    }
  }, [shareCanvasRef, shareVideoRef, onShareElementChange]);

  const stopShareScreen = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    try { await ms.stopShareScreen(); } catch (e) { console.warn("[useZoomCall] stopShareScreen", e); }
    onShareElementChange?.(null);
  }, [onShareElementChange]);

  // When another participant becomes active sharer, render their share into
  // whichever element the SDK accepts. Same canvas-first / video-fallback
  // strategy as startShareScreen.
  useEffect(() => {
    const client = clientRef.current;
    const canvas = shareCanvasRef?.current;
    const video = shareVideoRef?.current;
    if (!client || (!canvas && !video)) return;
    const me = (() => { try { return client.getCurrentUserInfo(); } catch { return null; } })();
    const meId = me?.userId ?? -1;
    if (activeShareUserId === null) {
      try { client.getMediaStream().stopShareView?.(); } catch { /* ignore */ }
      onShareElementChange?.(null);
      return;
    }
    if (activeShareUserId === meId) {
      // Local share — already mounted by startShareScreen.
      return;
    }
    const looksLikeWrongType = (e: unknown): boolean => {
      const r = e as { errorCode?: number; reason?: string } | null;
      return r?.errorCode === 6003 && typeof r.reason === "string"
        && /Video element|HTMLVideoElement/i.test(r.reason);
    };
    let cancelled = false;
    (async () => {
      const ms = client.getMediaStream();
      if (canvas) {
        try {
          await ms.startShareView(canvas, activeShareUserId);
          if (!cancelled) onShareElementChange?.("canvas");
          return;
        } catch (e) {
          if (!looksLikeWrongType(e) || !video) {
            console.warn("[useZoomCall] startShareView (canvas)", e);
            return;
          }
        }
      }
      if (video) {
        try {
          await ms.startShareView(video as unknown as HTMLCanvasElement, activeShareUserId);
          if (!cancelled) onShareElementChange?.("video");
        } catch (e) { console.warn("[useZoomCall] startShareView (video)", e); }
      }
    })();
    return () => {
      cancelled = true;
      try { client.getMediaStream().stopShareView?.(); } catch { /* ignore */ }
    };
  }, [activeShareUserId, shareCanvasRef, shareVideoRef, onShareElementChange]);

  const leave = useCallback(async (endForAll?: boolean) => {
    // Mark first so the unmount cleanup (which runs after status="ended"
    // flips the host's callOpen) skips its own client.leave() — two
    // overlapping leaves wedge the SDK.
    leftRef.current = true;
    const client = clientRef.current;
    if (client) { try { await client.leave(!!endForAll); } catch { /* may already be out */ } }
    // Always notify the server — the function uses caller role to decide
    // between participant_left (just post the ended message + audit) and
    // end_for_all (also stamp video_ended_at + fire summarize chain).
    try {
      await supabaseRef.current.functions.invoke("zoom-video-sdk-end", { body: { session_id: sessionId } });
    } catch (e) { console.warn("[useZoomCall] zoom-video-sdk-end failed", e); }
    // Reset the join guard so a fresh CallSurface mount can re-join the
    // same session without the early-return at the top of the join effect
    // silently blocking it.
    joinedKeyRef.current = null;
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
