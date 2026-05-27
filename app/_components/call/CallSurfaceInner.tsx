"use client";

/*
 * The real Video SDK surface — loaded via next/dynamic({ ssr: false }) from
 * CallSurface.tsx. Owns the SDK lifecycle for one call session.
 *
 * Layout: a single vertical column (header / video tiles / control bar).
 * The in-call ChatDock from earlier revisions is gone — the host now sees
 * the regular Relay chat in the main area + this surface mounted as a
 * resizable right sidebar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { useZoomCall } from "@/lib/video/useZoomCall";
import { silenceVideoSdkNoise } from "@/lib/video/silenceVideoSdkNoise";
import { TileGrid } from "./TileGrid";
import { ControlBar } from "./ControlBar";
import { ShareViewer } from "./ShareViewer";

silenceVideoSdkNoise();

type Props = {
  sessionId: string;
  role: "host" | "guest";
  userName: string;
  onClose: () => void;
  /** Fires once when the SDK reaches 'joined' — host wires this to
   *  state.markJoined() so the session lifecycle advances. */
  onJoined?: () => void;
};

export function CallSurfaceInner({ sessionId, role, userName, onClose, onJoined }: Props) {
  // Share elements are hoisted here so both the local sharer
  // (startShareScreen) and remote viewer (startShareView) can target them.
  // The SDK picks canvas vs video at runtime based on WebCodecs availability;
  // useZoomCall tries canvas first and falls back to video on the SDK's
  // "Use Video element" 6003 error. ShareViewer renders BOTH and shows
  // whichever the SDK accepted.
  const shareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shareVideoRef = useRef<HTMLVideoElement | null>(null);
  const [shareMode, setShareMode] = useState<"canvas" | "video" | null>(null);
  const call = useZoomCall({
    sessionId, role, userName,
    shareCanvasRef, shareVideoRef,
    onShareElementChange: setShareMode,
  });
  const [sharing, setSharing] = useState(false);
  const someoneElseSharing =
    call.activeShareUserId !== null &&
    !!call.self &&
    call.activeShareUserId !== call.self.userId;
  const sharerName = useMemo(() => {
    if (!call.activeShareUserId) return "";
    if (call.self?.userId === call.activeShareUserId) return call.self.displayName;
    const p = call.participants.find((x) => x.userId === call.activeShareUserId);
    return p?.displayName ?? "Someone";
  }, [call.activeShareUserId, call.self, call.participants]);

  // When the SDK reports an active share, mirror that into local UI state so
  // the share button reflects reality (e.g. user stops sharing from the
  // browser's own "Stop sharing" bar).
  useEffect(() => {
    if (!call.self) return;
    setSharing(call.activeShareUserId === call.self.userId);
  }, [call.activeShareUserId, call.self]);

  // When the session ends naturally (host ended-for-all, network drop past
  // grace, etc), unmount the surface.
  useEffect(() => {
    if (call.status === "ended") onClose();
  }, [call.status, onClose]);

  // Fire onJoined() exactly once when the SDK transitions to 'joined'.
  // Wired to state.markJoined() by the host (RoomClient / EngineerSession)
  // so the server session-status advances.
  const joinedFiredRef = useRef(false);
  useEffect(() => {
    if (call.status === "joined" && !joinedFiredRef.current) {
      joinedFiredRef.current = true;
      try { onJoined?.(); } catch { /* host concern */ }
    }
    if (call.status === "ended") joinedFiredRef.current = false;
  }, [call.status, onJoined]);

  const onToggleShare = async () => {
    if (sharing) await call.stopShareScreen();
    else await call.startShareScreen();
  };

  const onLeave = async () => {
    await call.leave(role === "host");
    onClose();
  };

  const isHost = role === "host";
  const reconnecting = call.status === "reconnecting";
  const fatal = call.status === "error";
  const initialising =
    call.status === "idle" || call.status === "fetching-token" || call.status === "joining";

  const headerBar = useMemo(() => (
    <div
      className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"
      style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{
            background: call.status === "joined" ? "var(--ok)"
              : reconnecting ? "var(--warn)"
              : fatal ? "var(--risk)"
              : "var(--text-muted)",
          }}
        />
        {call.status === "joined" ? "Live"
          : reconnecting ? "Reconnecting…"
          : initialising ? "Joining…"
          : fatal ? "Connection problem"
          : "Ended"}
      </div>
      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {call.participants.length + (call.self ? 1 : 0)} participant{call.participants.length === 0 ? "" : "s"}
      </div>
    </div>
  ), [call.status, call.participants.length, call.self, reconnecting, fatal, initialising]);

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ background: "var(--background)", color: "var(--text)" }}
    >
      {/* Single vertical column: header / tiles / controls. The host
          mounts us inside a resizable right sidebar so the main chat
          area stays visible underneath. */}
      {headerBar}

        <div className="relative flex-1 overflow-hidden">
          {initialising && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
              style={{ background: "rgba(0,0,0,0.3)", color: "#fff" }}
            >
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">Joining the call…</span>
            </div>
          )}
          {reconnecting && (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 py-2 text-center text-xs font-medium"
              style={{ background: "var(--warn)", color: "#fff" }}
            >
              Reconnecting…
            </div>
          )}
          {fatal && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center"
              style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
            >
              <AlertTriangle size={28} />
              <div className="text-sm">
                Couldn&apos;t connect to the video session.<br />
                <span className="text-[12px] opacity-80">{call.error}</span>
              </div>
              <button
                type="button"
                onClick={onLeave}
                className="rounded-md px-4 py-2 text-sm"
                style={{ background: "var(--primary)", color: "#fff" }}
              >
                Close
              </button>
            </div>
          )}
          {/* Share viewer must stay mounted ALWAYS so its canvas + video
              refs are populated BEFORE the user clicks Share — both
              startShareScreen() and startShareView() need a DOM element on
              call. We hide it via CSS when no share is active, and show
              it on top of the TileGrid otherwise. */}
          <div
            className="absolute inset-0"
            style={{ visibility: call.activeShareUserId !== null ? "visible" : "hidden" }}
          >
            <ShareViewer
              canvasRef={shareCanvasRef}
              videoRef={shareVideoRef}
              activeMode={shareMode}
              sharerName={sharerName}
              selfSharing={sharing}
              onStop={sharing ? () => void call.stopShareScreen() : undefined}
            />
          </div>
          {call.activeShareUserId === null && (
            <TileGrid self={call.self} participants={call.participants} client={call.client} />
          )}
        </div>

      <ControlBar
        self={call.self}
        isHost={isHost}
        sharing={sharing}
        chatOpen={false}
        showChatToggle={false}
        networkQuality={call.networkQuality}
        onToggleMic={call.toggleMic}
        onToggleCamera={call.toggleCamera}
        onToggleShare={onToggleShare}
        onToggleChat={() => {}}
        onLeave={onLeave}
      />
    </div>
  );
}
