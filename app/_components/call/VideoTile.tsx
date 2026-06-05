"use client";

/*
 * One participant tile for the in-window Zoom Video SDK call surface.
 *
 * Rendering model (Video SDK 2.x):
 *   `stream.attachVideo(userId, quality)` RETURNS a <video-player> custom
 *   element which must be appended as a child of a <video-player-container>
 *   custom element (both are registered globally by the SDK on import).
 *   `stream.detachVideo(userId)` tears it down. This replaces the legacy
 *   `renderVideo(canvas, …)` / `attachVideo(userId, q, <video>)` shapes —
 *   the old code passed a plain <video> element and ignored the return
 *   value, so the stream was never actually mounted and every tile stayed
 *   black. See node_modules/@zoom/videosdk/dist/types/media.d.ts:1815.
 */

import { useEffect, useRef } from "react";
import { Mic, MicOff, VideoOff } from "lucide-react";
import type { Participant } from "@/lib/video/useZoomCall";

type Props = {
  participant: Participant;
  client: any; // Zoom SDK client; typed loosely so the dynamic surface stays slim
};

// VideoQuality.Video_360P — see common.d.ts. 360p is a good balance for the
// small grid tiles: legible faces without saturating a LAN/uplink the way
// 720p would, which matters on the no-SharedArrayBuffer fallback path the
// SDK uses here (enforceMultipleVideos).
const VIDEO_QUALITY_360P = 2;

export function VideoTile({ participant, client }: Props) {
  // Host div we own; we inject a <video-player-container> into it and append
  // the SDK's <video-player> there. Keeping the container persistent across
  // on/off toggles avoids churn — we only attach/detach the stream.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const attachedRef = useRef(false);

  useEffect(() => {
    if (!client) return;
    const host = hostRef.current;
    if (!host) return;
    const ms = client.getMediaStream?.();
    if (!ms) return;

    const userId = participant.userId;
    let cancelled = false;

    // Lazily create the SDK-required <video-player-container> once. Pin it
    // to fill + clip its host cell so the SDK's <video-player> can't
    // overflow into a neighbouring tile (which made one tile look like it
    // filled the whole pane and hid the other).
    let vpc = host.querySelector(
      "video-player-container"
    ) as HTMLElement | null;
    if (!vpc) {
      vpc = document.createElement("video-player-container");
      vpc.style.position = "absolute";
      vpc.style.inset = "0";
      vpc.style.width = "100%";
      vpc.style.height = "100%";
      vpc.style.display = "block";
      vpc.style.overflow = "hidden";
      host.appendChild(vpc);
    }
    const container = vpc;

    if (participant.video.on) {
      (async () => {
        try {
          const result = await ms.attachVideo(userId, VIDEO_QUALITY_360P);
          // attachVideo resolves to a <video-player> element on success, or
          // an ExecutedFailure ({ type, reason, errorCode }) shape on
          // failure. Only append when we got a real DOM node.
          if (cancelled) {
            try {
              await ms.detachVideo(userId);
            } catch {
              /* nothing attached */
            }
            return;
          }
          if (result instanceof HTMLElement) {
            result.style.position = "absolute";
            result.style.inset = "0";
            result.style.width = "100%";
            result.style.height = "100%";
            container.appendChild(result);
            attachedRef.current = true;
          } else {
            console.warn(
              "[VideoTile] attachVideo did not return an element",
              result
            );
          }
        } catch (e) {
          console.warn("[VideoTile] attachVideo threw", e);
        }
      })();
    }

    return () => {
      cancelled = true;
      if (attachedRef.current) {
        attachedRef.current = false;
        // detachVideo removes the <video-player> from the container and
        // releases the decoder slot. Fire-and-forget; unmount can't await.
        try {
          const r = ms.detachVideo(userId);
          if (r && typeof r.then === "function") r.catch(() => {});
        } catch {
          /* already detached */
        }
      }
    };
  }, [client, participant.userId, participant.video.on]);

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-md"
      style={{ background: "color-mix(in srgb, var(--text) 6%, transparent)" }}
    >
      {/* SDK video mounts here. Hidden (not unmounted) when the camera is
          off so the container persists and the camera-off placeholder can
          sit on top. */}
      <div
        ref={hostRef}
        className="absolute inset-0"
        style={{ display: participant.video.on ? "block" : "none" }}
      />

      {!participant.video.on && (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ color: "var(--text-faint)" }}
        >
          <VideoOff size={18} aria-label="Camera off" strokeWidth={1.5} />
        </div>
      )}

      <div
        className="pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          background: "rgba(0,0,0,0.45)",
          color: "rgba(255,255,255,0.92)",
        }}
      >
        {participant.audio.muted ? (
          <MicOff size={10} className="shrink-0 opacity-90" />
        ) : (
          <Mic size={10} className="shrink-0 opacity-90" />
        )}
        <span className="truncate">
          {participant.displayName}
          {participant.isCurrentUser ? " (you)" : ""}
        </span>
      </div>
    </div>
  );
}
