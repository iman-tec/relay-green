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

  return (
    <div
      className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border"
      style={{ background: "var(--surface-raised)", borderColor: "var(--border)" }}
    >
      {participant.video.on ? (
        <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted={participant.isCurrentUser} playsInline />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
          <VideoOff size={28} />
          <span className="text-sm">{participant.displayName}</span>
        </div>
      )}
      <div
        className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium"
        style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
      >
        {participant.audio.muted ? <MicOff size={12} /> : <Mic size={12} />}
        <span className="truncate max-w-[160px]">
          {participant.displayName}{participant.isCurrentUser ? " (you)" : ""}
        </span>
      </div>
    </div>
  );
}
