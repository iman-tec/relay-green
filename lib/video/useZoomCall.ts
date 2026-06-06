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
  /** True while THIS participant is screen-sharing. Tracked explicitly (the
   *  SDK's active-share-change is unreliable for one's own share), and reset
   *  when the browser's native "Stop sharing" bar ends the capture. */
  selfSharing: boolean;
  networkQuality: "good" | "fair" | "poor" | "unknown";
  leave: (endForAll?: boolean) => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /** Begin a screen share. Caller must have set `shareCanvasRef.current` to
   *  a real <canvas> element first — the SDK paints the local preview on it. */
  startShareScreen: () => Promise<void>;
  stopShareScreen: () => Promise<void>;
  client: ReturnType<typeof getVideoClient> extends Promise<infer C>
    ? C | null
    : null;
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

export function useZoomCall({
  sessionId,
  role,
  userName,
  shareCanvasRef,
  shareVideoRef,
  onShareElementChange,
}: Options): UseZoomCallReturn {
  const supabaseRef = useRef(createClient());
  const clientRef = useRef<Awaited<ReturnType<typeof getVideoClient>> | null>(
    null
  );
  const joinedKeyRef = useRef<string | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  // Set to true once `leave()` has run so the unmount cleanup doesn't
  // race a second `client.leave()` against the in-flight first one — the
  // SDK occasionally wedges when two leaves overlap.
  const leftRef = useRef(false);
  // Live transcription caption buffers — hoisted to component scope so
  // leave() can flush them BEFORE invoking zoom-video-sdk-end (which
  // triggers summarize-guest-call). Without hoisting, the last 0-60s of
  // voice transcript would be summarised against nothing because the
  // batched INSERT hasn't fired yet when summarize-guest-call runs.
  // Each in-progress transcription sentence is keyed by its Zoom msgId. The
  // SDK streams the SAME sentence repeatedly as it refines it (growing `text`,
  // `done` flips true when finalized), so we REPLACE by msgId rather than
  // append — otherwise the transcript fills with duplicated partials ("Hel",
  // "Hello", "Hello there" …) and the summary reads as gibberish.
  type PendingCaption = {
    speaker: string | null;
    text: string;
    done: boolean;
    firstSeen: number;
  };
  const pendingCaptionsRef = useRef<Map<string, PendingCaption>>(new Map());

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeShareUserId, setActiveShareUserId] = useState<number | null>(
    null
  );
  const [selfSharing, setSelfSharing] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<
    "good" | "fair" | "poor" | "unknown"
  >("unknown");
  const [tick, setTick] = useState(0); // bump to force re-render after SDK state changes
  // True once Zoom's NATIVE live transcription is running (host start or
  // guest caption-status). When it is, the browser-side Whisper recorder
  // below stands down — otherwise both would write session_captions and the
  // transcript would double up. On this account native LTT is unavailable
  // (errorCode 7300) so this stays false and Whisper is the live path.
  const [lttActive, setLttActive] = useState(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Flush the current caption buffer to session_captions. Hoisted out
  // of the join useEffect so leave() can await it BEFORE invoking
  // zoom-video-sdk-end (which fires summarize-guest-call). Force=true
  // flushes everything regardless of window age (called at teardown
  // and final leave).
  const flushCaptions = useCallback(
    async (force: boolean): Promise<void> => {
      if (role !== "host") return;
      const pending = pendingCaptionsRef.current;
      const now = Date.now();
      // A sentence is ready to persist once finalized (done). As a safety net
      // for SDK builds that don't reliably flip `done`, also commit sentences
      // that have gone stale (idle > 60s), and on force (teardown / final
      // leave) commit everything so the tail of the call is never lost.
      const STALE_MS = 60_000;
      const ready: Array<{ speaker: string | null; text: string; ts: number }> =
        [];
      for (const [msgId, c] of Array.from(pending.entries())) {
        const text = c.text.trim();
        if (!text) {
          pending.delete(msgId);
          continue;
        }
        if (c.done || force || now - c.firstSeen > STALE_MS) {
          ready.push({ speaker: c.speaker, text, ts: c.firstSeen });
          pending.delete(msgId);
        }
      }
      if (ready.length === 0) return;
      ready.sort((a, b) => a.ts - b.ts);
      // One row per speaker for this flush window, sentences in time order.
      const bySpeaker = new Map<
        string,
        { speaker: string | null; texts: string[]; start: number; end: number }
      >();
      for (const r of ready) {
        const key = r.speaker ?? "__null__";
        let g = bySpeaker.get(key);
        if (!g) {
          g = { speaker: r.speaker, texts: [], start: r.ts, end: r.ts };
          bySpeaker.set(key, g);
        }
        g.texts.push(r.text);
        g.start = Math.min(g.start, r.ts);
        g.end = Math.max(g.end, r.ts);
      }
      const rows = Array.from(bySpeaker.values())
        .map((g) => ({
          session_id: sessionId,
          speaker: g.speaker,
          text: g.texts.join(" ").replace(/\s+/g, " ").trim(),
          window_start: new Date(g.start).toISOString(),
          window_end: new Date(g.end).toISOString(),
        }))
        .filter((r) => r.text.length > 0);
      if (rows.length === 0) return;
      try {
        const { error: insErr } = await supabaseRef.current
          .from("session_captions")
          .insert(rows);
        if (insErr)
          console.warn("[useZoomCall] caption insert:", insErr.message);
      } catch (e) {
        console.warn("[useZoomCall] caption flush threw:", e);
      }
    },
    [sessionId, role]
  );

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
          token: string;
          topic: string;
          session_key: string;
          user_identity: string;
          role_type: number;
          sdk_key: string;
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
          setError(
            `init failed: ${initErr instanceof Error ? initErr.message : String(initErr)}`
          );
          setStatus("error");
          return;
        }
        setStatus("joining");
        // The Video SDK client is a process-wide singleton (zoomClient.ts)
        // that we deliberately DON'T leave on React unmount (so the call
        // survives HMR + parent re-renders). That creates two cases to
        // handle when a fresh CallSurface mounts:
        //
        //   1. The client is already in the SAME topic we want → joining
        //      again throws 5012 "duplicated operation"; just continue.
        //   2. The client is still in a DIFFERENT (stale) topic from a
        //      previous call → we MUST leave it before joining the new
        //      one. Skipping the join here (the previous bug) left the
        //      user stranded in the old empty room, so each side only saw
        //      itself ("1 participant") even though both had "joined".
        //
        // So: read the client's current topic and compare to the target.
        const currentTopic = (): string | null => {
          try {
            const info = (client as any).getSessionInfo?.();
            const t = info?.topic;
            return typeof t === "string" && t.length > 0 ? t : null;
          } catch {
            return null;
          }
        };
        try {
          const inTopic = currentTopic();
          if (inTopic === data.topic) {
            // Already in the exact room we want — nothing to do.
            console.info(
              "[useZoomCall] already in target topic — skipping join"
            );
          } else {
            if (inTopic && inTopic !== data.topic) {
              // Stranded in a stale session — leave it before joining the
              // correct one, or the join would 5012 AND we'd stay split
              // from the other participant.
              console.info(
                `[useZoomCall] leaving stale topic "${inTopic}" before joining "${data.topic}"`
              );
              try {
                await client.leave();
              } catch (e) {
                console.warn("[useZoomCall] leave stale failed", e);
              }
            }
            await client.join(data.topic, data.token, userName || "Relay user");
          }
        } catch (joinErr) {
          const code = (joinErr as { errorCode?: unknown } | null)?.errorCode;
          if (code === 5012 && currentTopic() === data.topic) {
            // Duplicated join against the singleton, and we're confirmed in
            // the RIGHT topic — continue. (We do NOT swallow 5012 blindly:
            // if it fires while we're in the wrong/no topic that's a real
            // failure worth surfacing.)
            console.info(
              "[useZoomCall] join reported 5012 but already in target topic — continuing"
            );
          } else {
            // Zoom SDK errors are plain objects like {type, reason, errorCode}.
            // String() on those yields '[object Object]', which is useless.
            // Pull out the useful fields so the UI surfaces something
            // actionable (e.g. INVALID_PARAMETERS / signature mismatch).
            console.error("[useZoomCall] join failed:", joinErr);
            if (cancelled) return;
            let reason: string;
            if (joinErr instanceof Error) {
              reason = joinErr.message;
            } else if (joinErr && typeof joinErr === "object") {
              const e = joinErr as {
                type?: unknown;
                reason?: unknown;
                errorCode?: unknown;
              };
              const parts: string[] = [];
              if (typeof e.type === "string") parts.push(e.type);
              if (typeof e.errorCode === "number")
                parts.push(`code=${e.errorCode}`);
              if (typeof e.reason === "string") parts.push(e.reason);
              reason =
                parts.length > 0 ? parts.join(" · ") : JSON.stringify(joinErr);
            } else {
              reason = String(joinErr);
            }
            setError(`join failed: ${reason}`);
            setStatus("error");
            return;
          }
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
          setActiveShareUserId(
            p?.state === "Active" && p?.userId ? p.userId : null
          );
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
        // Fires when the user stops sharing via the browser's own "Stop
        // sharing" bar (not our button) — keep our UI in sync so the share
        // toggle works both ways.
        const onPassiveStopShare = () => {
          setSelfSharing(false);
          onShareElementChange?.(null);
        };
        client.on("passively-stop-share", onPassiveStopShare);
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
        } catch (e) {
          console.warn("[useZoomCall] active-share probe", e);
        }

        // ── Media defaults: mic + camera BOTH start OFF ───────────────
        // We deliberately do NOT auto-start audio OR video on join. Each
        // starts on the user's first click of its control (toggleMic /
        // toggleCamera) — the reliable, autoplay-gesture-friendly path.
        // Until then the self-tile shows camera-off and the mic shows muted,
        // so nobody is broadcasting audio or video the moment they land in
        // the call. (Auto-starting audio outside a user gesture frequently
        // times out and leaves mute/unmute dead; auto-starting the camera was
        // surprising — people want to choose when they appear on video.)
        try {
          const ms = client.getMediaStream();
          if (ms && !cancelled) refresh();
        } catch (mediaErr) {
          console.warn("[useZoomCall] media probe skipped:", mediaErr);
        }

        // ── Live transcription (Zoom Video SDK) ───────────────────────
        // Path 1 test: try `getLiveTranscriptionClient().startLiveTranscription()`
        // and see if our Video SDK account has the entitlement. Captions
        // arrive via the `caption-message` event on the main client (not
        // on the live-transcription client). The pending-caption map + flush
        // logic live at component scope (pendingCaptionsRef + flushCaptions
        // above) so leave() can await a final flush BEFORE invoking
        // summarize-guest-call — otherwise the last 0-60s of voice
        // transcript would never reach the summary.
        const onCaptionMessage = (payload: {
          msgId?: string;
          userId?: number;
          displayName?: string;
          text?: string;
          source?: number;
          timestamp?: number;
          done?: boolean;
        }) => {
          const text = (payload?.text ?? "").trim();
          if (!text) return;
          // source: 4 = ASR (voice), 1 = manually-typed caption, 2 = external
          // captioner. Keep voice + manual; drop the rest. Tolerate a missing
          // source (older builds) by keeping it.
          if (
            payload.source != null &&
            payload.source !== 4 &&
            payload.source !== 1
          )
            return;
          const msgId =
            payload.msgId ??
            `${payload.userId ?? "u"}-${payload.timestamp ?? text.length}`;
          const speaker =
            payload.displayName ??
            (payload.userId ? `User ${payload.userId}` : null);
          const prev = pendingCaptionsRef.current.get(msgId);
          // Zoom re-sends the SAME sentence with growing `text` as it refines
          // it — REPLACE by msgId (don't append) so partial fragments don't
          // pile up. `done` latches true once the sentence is finalized.
          pendingCaptionsRef.current.set(msgId, {
            speaker,
            text,
            done: !!payload.done || (prev?.done ?? false),
            firstSeen: prev?.firstSeen ?? Date.now(),
          });
        };
        client.on("caption-message", onCaptionMessage);

        // Guest side: in Individual transcription mode each participant must
        // declare their own speaking language or their audio isn't
        // transcribed. The host can't set it for them, so when the host turns
        // captions on (caption-status → autoCaption) the guest sets English
        // once. (The host sets its own below, at startLiveTranscription time.)
        let guestLangSet = false;
        const onCaptionStatus = (payload: { autoCaption?: boolean }) => {
          if (role === "host" || !payload?.autoCaption || guestLangSet) return;
          guestLangSet = true;
          setLttActive(true); // host turned native ASR on → stand down Whisper
          try {
            const lt = (client as any).getLiveTranscriptionClient?.();
            void lt?.setSpeakingLanguage?.("en");
            console.info(
              "[useZoomCall] guest speaking language set to en for live transcription"
            );
          } catch (e) {
            console.warn("[useZoomCall] setSpeakingLanguage(guest):", e);
          }
        };
        client.on("caption-status", onCaptionStatus);

        const flushInterval = window.setInterval(() => {
          void flushCaptions(false);
        }, 60_000);

        // Host attempts to start Zoom's ASR. If the account doesn't have
        // the entitlement, the SDK rejects and we log the precise error
        // so the next step (Path 2 Whisper, or escalate to vsdk-help@zoom.us)
        // is informed by a real error code, not a guess.
        let liveTranscriptionStarted = false;
        if (role === "host") {
          try {
            const lt = (client as any).getLiveTranscriptionClient?.();
            if (!lt?.startLiveTranscription) {
              // Quiet warn (not console.error) — console.error trips the
              // Next.js dev error overlay, and a missing LT client is an
              // SDK-build/entitlement condition, not an app fault.
              console.warn(
                "[useZoomCall] Live Transcription client unavailable on this SDK build — voice captions disabled."
              );
            } else {
              // Set the host's own speaking language first (Individual mode).
              // Harmless if the SDK no-ops it; improves ASR accuracy.
              try {
                await lt.setSpeakingLanguage?.("en");
              } catch (slErr) {
                console.warn("[useZoomCall] setSpeakingLanguage(host):", slErr);
              }
              await lt.startLiveTranscription();
              liveTranscriptionStarted = true;
              setLttActive(true); // native ASR live → Whisper recorder stands down
              // Read status back — the surest signal of the account's ASR
              // entitlement. LTT can "start" yet expose NO transcription
              // languages, in which case no voice captions ever arrive; that
              // is an account provisioning gap (contact vsdk-help@zoom.us),
              // not a bug in this code.
              try {
                const st = lt.getLiveTranscriptionStatus?.();
                if (st && !st.transcriptionLanguage) {
                  console.warn(
                    "[useZoomCall] Live Transcription started but NO transcription languages are provisioned on this Video SDK account — voice captions will not flow. Account entitlement gap (contact vsdk-help@zoom.us)."
                  );
                } else {
                  console.info(
                    `[useZoomCall] ✓ Live Transcription STARTED (languages: ${st?.transcriptionLanguage ?? "?"}) — captions stream into session_captions every ~60s`
                  );
                }
              } catch {
                console.info(
                  "[useZoomCall] ✓ Live Transcription STARTED — captions stream into session_captions every ~60s"
                );
              }
            }
          } catch (ltErr) {
            // errorCode 7300 = "Live transcription is not enabled" on the
            // Zoom Video SDK account. This is an EXPECTED entitlement gap,
            // not a runtime fault — log it as a warning so it doesn't
            // surface as a red Next.js error overlay every call. Voice-only
            // calls won't get a transcript-based summary until the
            // entitlement is enabled (email vsdk-help@zoom.us) or Whisper
            // streaming (Path 2) is wired; chat-based summaries are
            // unaffected.
            const code = (ltErr as { errorCode?: unknown } | null)?.errorCode;
            if (code === 7300) {
              console.warn(
                "[useZoomCall] Live Transcription not enabled for this Video SDK account (errorCode 7300) — voice captions/summary disabled. Chat summaries still work."
              );
            } else {
              console.warn(
                "[useZoomCall] Live Transcription failed to start:",
                ltErr
              );
            }
          }
        }

        // Only on REAL page unload (close tab, navigate away, refresh) do
        // we notify the server. Vital distinction: React unmount fires on
        // HMR re-renders and parent re-mounts too — if we ended the session
        // on every React unmount, dev would kill the call on hot-reload AND
        // a customer refresh would end their own call. pagehide fires only
        // when the page is actually going away (bfcache-aware).
        const onPageHide = () => {
          try {
            const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/zoom-video-sdk-end`;
            const body = JSON.stringify({ session_id: sessionId });
            if (
              typeof navigator !== "undefined" &&
              navigator.sendBeacon &&
              url
            ) {
              navigator.sendBeacon(
                url,
                new Blob([body], { type: "application/json" })
              );
            }
          } catch {
            /* unload races are fine */
          }
        };
        if (typeof window !== "undefined") {
          window.addEventListener("pagehide", onPageHide);
        }

        teardownRef.current = () => {
          try {
            client.off("user-added", onUserUpdate);
            client.off("user-removed", onUserUpdate);
            client.off("user-updated", onUserUpdate);
            client.off("connection-change", onConnection);
            client.off("active-share-change", onActiveShare);
            client.off("passively-stop-share", onPassiveStopShare);
            client.off("network-quality-change", onNetwork);
            client.off("caption-message", onCaptionMessage);
            client.off("caption-status", onCaptionStatus);
          } catch {
            /* listeners may already be gone */
          }
          window.clearInterval(flushInterval);
          // Final flush on teardown so the tail of the conversation isn't
          // lost. Don't await — teardown shouldn't block React unmount.
          void flushCaptions(true);
          if (liveTranscriptionStarted) {
            try {
              const lt = (client as any).getLiveTranscriptionClient?.();
              lt?.disableCaptions?.(true);
            } catch {
              /* SDK already torn down */
            }
          }
          if (typeof window !== "undefined") {
            window.removeEventListener("pagehide", onPageHide);
          }
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
      try {
        teardownRef.current?.();
      } catch {
        /* ignore */
      }
      teardownRef.current = null;
      // React unmount fires on HMR + parent re-render — NOT a signal the
      // user actually left. We deliberately do NOT call client.leave() or
      // notify the server here. Real exits are handled two other ways:
      //   • Explicit Leave button → leave() in this hook (sets leftRef).
      //   • Page close / nav away → pagehide listener above + Zoom SDK's
      //     own leaveOnPageUnload:true (set in init()).
      // This preserves the call across HMR and across React re-renders.
      joinedKeyRef.current = null;
      leftRef.current = false;
    };
  }, [sessionId, role, userName, refresh]);

  // ── derive participants from the SDK on every tick ───────────────────
  const derived = useMemo<{
    self: Participant | null;
    all: Participant[];
  }>(() => {
    const client = clientRef.current;
    if (!client) return { self: null, all: [] };
    try {
      const me = client.getCurrentUserInfo();
      const all = client.getAllUser();
      const toP = (u: any): Participant => ({
        userId: u.userId,
        displayName: String(u.displayName ?? "User"),
        isHost: !!u.isHost,
        // `audio` is '' until the SDK has actually started capturing (becomes
        // 'computer'/'phone' once started). We start audio only on the user's
        // first mic click (autoplay-gesture-safe), so until then treat them as
        // muted — the mic toggle defaults to OFF and nobody is broadcasting on
        // join. Once audio is started, reflect the real muted flag.
        audio: { muted: u.audio ? !!u.muted : true },
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

  useEffect(() => {
    setParticipants(derived.all);
  }, [derived.all]);

  // ── Whisper live transcription (fallback for missing Zoom ASR) ─────────
  // Zoom's native Live Transcription is unavailable on this Video SDK account
  // (errorCode 7300), so each participant records their OWN mic in ~30s
  // independently-decodable slices and ships them to the `transcribe-chunk`
  // edge function, which runs Whisper and appends to session_captions. We
  // record only while THIS user's mic is on (privacy + no Whisper spend on
  // silence) and only while native ASR is NOT running (lttActive) so the two
  // paths never double-write. Each side records a single clean speaker, so
  // the `speaker` label is exact.
  const selfMicOn = !!derived.self && !derived.self.audio.muted;
  useEffect(() => {
    if (status !== "joined" || !selfMicOn || lttActive) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
      (m) => {
        try {
          return MediaRecorder.isTypeSupported(m);
        } catch {
          return false;
        }
      }
    );
    if (!mime) {
      console.warn(
        "[useZoomCall] MediaRecorder has no supported audio mime — Whisper transcription disabled"
      );
      return;
    }

    const CHUNK_MS = 30_000;
    let active = true;
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let cycleTimer: number | null = null;

    const upload = async (blob: Blob, startedAt: number) => {
      // Skip near-silent/keyframe-only slices — the edge function double-checks
      // size too, but bailing here saves an upload round-trip.
      if (blob.size < 2000) return;
      try {
        const ext = mime.includes("mp4") ? "mp4" : "webm";
        const fd = new FormData();
        fd.append("file", blob, `chunk.${ext}`);
        fd.append("session_id", sessionId);
        fd.append("speaker", userName || "");
        fd.append("started_at", new Date(startedAt).toISOString());
        await supabaseRef.current.functions.invoke("transcribe-chunk", {
          body: fd,
        });
      } catch (e) {
        console.warn("[useZoomCall] whisper upload failed:", e);
      }
    };

    // Each cycle records ONE complete file (stop→start gives independently
    // decodable slices; a single recorder with a timeslice would emit
    // fragments only the first of which has a usable header).
    const cycle = () => {
      if (!active || !stream) return;
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, { mimeType: mime });
      } catch (e) {
        console.warn("[useZoomCall] MediaRecorder construction failed:", e);
        return;
      }
      recorder = rec;
      const parts: BlobPart[] = [];
      const startedAt = Date.now();
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) parts.push(ev.data);
      };
      rec.onstop = () => {
        void upload(new Blob(parts, { type: mime }), startedAt);
        if (active) cycle(); // roll straight into the next slice
      };
      try {
        rec.start();
      } catch (e) {
        console.warn("[useZoomCall] MediaRecorder start failed:", e);
        return;
      }
      cycleTimer = window.setTimeout(() => {
        try {
          if (rec.state !== "inactive") rec.stop();
        } catch {
          /* already stopped */
        }
      }, CHUNK_MS);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (e) {
        console.warn(
          "[useZoomCall] getUserMedia for transcription unavailable:",
          e
        );
        return;
      }
      if (!active) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        return;
      }
      cycle();
    })();

    return () => {
      active = false;
      if (cycleTimer != null) window.clearTimeout(cycleTimer);
      // Stop the in-flight recorder — its onstop still fires and uploads the
      // final partial slice, but `active=false` prevents a new cycle.
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        /* already stopped */
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [status, selfMicOn, lttActive, sessionId, userName]);

  // Participant-list safety net. We track the roster off the SDK's
  // user-added / user-removed / user-updated events, but those can be
  // dropped — most often when the other side joins a split-second before
  // we finish wiring our listeners, or right after a brief reconnect. The
  // symptom is one side stuck on "1 participant" while the other is really
  // there. getAllUser() is always authoritative, so while we're in the
  // call we re-derive it on a slow poll to reconcile any missed event.
  // Cheap: refresh() just bumps a tick → the derived useMemo re-reads
  // getAllUser().
  useEffect(() => {
    if (status !== "joined" && status !== "reconnecting") return;
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [status, refresh]);

  // ── controls ─────────────────────────────────────────────────────────
  const toggleMic = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    try {
      const me = client.getCurrentUserInfo() as {
        audio?: string;
        muted?: boolean;
      } | null;
      // `audio` is '' (empty) until the SDK has actually started capturing;
      // it becomes 'computer'/'phone' once started. If audio was never
      // started — the post-join auto-start can time out or be blocked
      // outside a user gesture — muteAudio/unmuteAudio are no-ops and the
      // mic looks dead. Start it HERE, inside the real click gesture (the
      // reliable path for browser autoplay policy). startAudio() begins
      // unmuted, so the user can talk immediately after this first click.
      const audioStarted = !!me?.audio;
      if (!audioStarted) {
        await ms.startAudio();
        refresh();
        return;
      }
      if (me?.muted) await ms.unmuteAudio();
      else await ms.muteAudio();
      refresh();
    } catch (e) {
      console.warn("[useZoomCall] toggleMic", e);
    }
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
    } catch (e) {
      console.warn("[useZoomCall] toggleCamera", e);
    }
  }, [refresh]);

  const startShareScreen = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    const canvas = shareCanvasRef?.current;
    const video = shareVideoRef?.current;
    if (!canvas && !video) {
      console.warn(
        "[useZoomCall] startShareScreen needs a <canvas> or <video> element"
      );
      return;
    }
    // The SDK picks between canvas vs video at runtime based on WebCodecs
    // availability. We try canvas first (works in our localhost dev with
    // enforceMultipleVideos fallback) and fall back to video on the SDK's
    // specific 6003 "Use Video element" error.
    const looksLikeWrongType = (e: unknown): boolean => {
      const r = e as { errorCode?: number; reason?: string } | null;
      return (
        r?.errorCode === 6003 &&
        typeof r.reason === "string" &&
        /Video element|HTMLVideoElement/i.test(r.reason)
      );
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
          setSelfSharing(true);
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
        const res = await ms.startShareScreen(
          video as unknown as HTMLCanvasElement
        );
        if (isErrorReturn(res)) {
          console.warn("[useZoomCall] startShareScreen (video) failed", res);
          return;
        }
        setSelfSharing(true);
        onShareElementChange?.("video");
      } catch (e) {
        console.warn("[useZoomCall] startShareScreen (video)", e);
      }
    }
  }, [shareCanvasRef, shareVideoRef, onShareElementChange]);

  const stopShareScreen = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const ms = client.getMediaStream();
    try {
      await ms.stopShareScreen();
    } catch (e) {
      console.warn("[useZoomCall] stopShareScreen", e);
    }
    setSelfSharing(false);
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
    const me = (() => {
      try {
        return client.getCurrentUserInfo();
      } catch {
        return null;
      }
    })();
    const meId = me?.userId ?? -1;
    if (activeShareUserId === null) {
      try {
        client.getMediaStream().stopShareView?.();
      } catch {
        /* ignore */
      }
      onShareElementChange?.(null);
      return;
    }
    if (activeShareUserId === meId) {
      // Local share — already mounted by startShareScreen.
      return;
    }
    const looksLikeWrongType = (e: unknown): boolean => {
      const r = e as { errorCode?: number; reason?: string } | null;
      return (
        r?.errorCode === 6003 &&
        typeof r.reason === "string" &&
        /Video element|HTMLVideoElement/i.test(r.reason)
      );
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
          await ms.startShareView(
            video as unknown as HTMLCanvasElement,
            activeShareUserId
          );
          if (!cancelled) onShareElementChange?.("video");
        } catch (e) {
          console.warn("[useZoomCall] startShareView (video)", e);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        client.getMediaStream().stopShareView?.();
      } catch {
        /* ignore */
      }
    };
  }, [activeShareUserId, shareCanvasRef, shareVideoRef, onShareElementChange]);

  const leave = useCallback(
    async (endForAll?: boolean) => {
      // Mark first so the unmount cleanup (which runs after status="ended"
      // flips the host's callOpen) skips its own client.leave() — two
      // overlapping leaves wedge the SDK.
      leftRef.current = true;
      const client = clientRef.current;
      if (client) {
        try {
          await client.leave(!!endForAll);
        } catch {
          // end-for-all requires being the CURRENT SDK host. Since either
          // side can start the call, the other side may hold host (e.g. the
          // customer started, engineer ends) and leave(true) rejects — fall
          // back to a plain leave so this side still exits; the server-side
          // zoom-video-sdk-end below posts the ended card either way.
          if (endForAll) {
            try {
              await client.leave();
            } catch {
              /* may already be out */
            }
          }
        }
      }
      // CRITICAL: flush any pending live-transcription captions BEFORE
      // calling zoom-video-sdk-end. The end function triggers
      // summarize-guest-call inside the session.ended webhook chain, which
      // reads session_captions for the prompt. If we let the flush race
      // the summary, the last 0-60s of voice transcript never reaches the
      // model and the summary feels truncated. Await is intentional.
      try {
        await flushCaptions(true);
      } catch (e) {
        console.warn("[useZoomCall] leave-flush", e);
      }
      // Always notify the server — the function uses caller role to decide
      // between participant_left (just post the ended message + audit) and
      // end_for_all (also stamp video_ended_at + fire summarize chain).
      try {
        await supabaseRef.current.functions.invoke("zoom-video-sdk-end", {
          body: { session_id: sessionId },
        });
      } catch (e) {
        console.warn("[useZoomCall] zoom-video-sdk-end failed", e);
      }
      // Reset the join guard so a fresh CallSurface mount can re-join the
      // same session without the early-return at the top of the join effect
      // silently blocking it.
      joinedKeyRef.current = null;
      setStatus("ended");
    },
    [sessionId, flushCaptions]
  );

  return {
    status,
    error,
    self: derived.self,
    participants,
    activeShareUserId,
    selfSharing,
    networkQuality,
    leave,
    toggleMic,
    toggleCamera,
    startShareScreen,
    stopShareScreen,
    client: clientRef.current as any,
  };
}
