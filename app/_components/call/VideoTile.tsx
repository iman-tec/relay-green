"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff, VideoOff } from "lucide-react";
import type { Participant } from "@/lib/video/useZoomCall";

type Props = {
  participant: Participant;
  client: any; // Zoom SDK client; typed loosely so the dynamic surface can stay slim
};

export function VideoTile({ participant, client }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!client) return;
    const ms = client.getMediaStream?.();
    if (!ms) return;
    const el = videoRef.current;
    if (!el) return;

    let cancelled = false;
    (async () => {
      try {
        if (participant.video.on) {
          // attachVideo signature varies by SDK minor; the modern shape returns a
          // <video>-bound stream the caller is expected to render via `attachVideo`.
          if (typeof ms.attachVideo === "function") {
            await ms.attachVideo(participant.userId, 3, el);
          } else if (typeof ms.renderVideo === "function") {
            // Older minor exposed renderVideo(canvas, userId, w, h, x, y, q).
            await ms.renderVideo(el, participant.userId, 320, 180, 0, 0, 3);
          }
        }
      } catch {
        /* tile render is best-effort; SDK occasionally rejects fast remounts */
      }
    })();

    return () => {
      cancelled = true;
      try { ms.detachVideo?.(participant.userId, el); } catch { /* ignore */ }
    };
  }, [client, participant.userId, participant.video.on]);

  // Subtle styling: no border (just a soft bg), smaller camera-off icon,
  // compact bottom overlay with reduced opacity. Parent controls aspect
  // (square when stacked in a side rail, video-aspect when in a grid).
  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-md"
      style={{ background: "color-mix(in srgb, var(--text) 6%, transparent)" }}
    >
      {participant.video.on ? (
        <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted={participant.isCurrentUser} playsInline />
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ color: "var(--text-faint)" }}>
          <VideoOff size={18} aria-label="Camera off" strokeWidth={1.5} />
        </div>
      )}
      <div
        className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{ background: "rgba(0,0,0,0.45)", color: "rgba(255,255,255,0.92)" }}
      >
        {participant.audio.muted
          ? <MicOff size={10} className="shrink-0 opacity-90" />
          : <Mic size={10} className="shrink-0 opacity-90" />}
        <span className="truncate">
          {participant.displayName}{participant.isCurrentUser ? " (you)" : ""}
        </span>
      </div>
    </div>
  );
}
