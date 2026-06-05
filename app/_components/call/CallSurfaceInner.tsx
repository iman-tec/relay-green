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
import { createPortal } from "react-dom";
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
  /** Compact mode — see CallSurface.tsx prop docs. */
  compact?: boolean;
  /** When set AND a share is active, tiles render via createPortal into
   *  this element. See CallSurface.tsx prop docs. */
  tilesPortalTarget?: HTMLElement | null;
  /** Fires when activeShareUserId crosses null ↔ non-null. */
  onShareStateChange?: (sharing: boolean) => void;
  /** Inline (no-share) tiles fill the full width as a single equal-width row
   *  at a fixed height, instead of the capped/centred 4:3 gallery. Used by the
   *  engineer session view where the call pane has the whole side column and
   *  the centred tiles leave weird empty margins. See CallSurface.tsx. */
  wideTiles?: boolean;
  /** With wideTiles: stretch the tile row to the pane's FULL height instead
   *  of the fixed 340px row. Engineer-only (their call owns the whole
   *  stage); the customer keeps the original fixed-height row. */
  fillTiles?: boolean;
};

export function CallSurfaceInner({
  sessionId,
  role,
  userName,
  onClose,
  onJoined,
  compact = false,
  tilesPortalTarget = null,
  onShareStateChange,
  wideTiles = false,
  fillTiles = false,
}: Props) {
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
    sessionId,
    role,
    userName,
    shareCanvasRef,
    shareVideoRef,
    onShareElementChange: setShareMode,
  });
  // Self-share state comes straight from the hook (which tracks start/stop +
  // the browser's native-stop), so the share button toggles reliably both ways.
  const sharing = call.selfSharing;
  // Deduped participant count (self + others). When there's only one person in
  // the call, the wide-tile layout lets that single tile fill the whole pane
  // instead of sitting at the fixed short height.
  const inlineTileCount = call.self
    ? 1 + call.participants.filter((p) => p.userId !== call.self!.userId).length
    : call.participants.length;
  const someoneElseSharing =
    call.activeShareUserId !== null &&
    !!call.self &&
    call.activeShareUserId !== call.self.userId;
  const sharerName = useMemo(() => {
    if (!call.activeShareUserId) return "";
    if (call.self?.userId === call.activeShareUserId)
      return call.self.displayName;
    const p = call.participants.find(
      (x) => x.userId === call.activeShareUserId
    );
    return p?.displayName ?? "Someone";
  }, [call.activeShareUserId, call.self, call.participants]);

  // When the session ends naturally (host ended-for-all, network drop past
  // grace, etc), unmount the surface.
  useEffect(() => {
    if (call.status === "ended") onClose();
  }, [call.status, onClose]);

  // Notify host whenever the share state crosses null ↔ non-null. Host
  // (RoomClient) uses this to mount/unmount the tile-portal slot in the
  // right rail so the chat fills the rail when nobody is sharing.
  useEffect(() => {
    onShareStateChange?.(call.activeShareUserId !== null);
  }, [call.activeShareUserId, onShareStateChange]);

  // Fire onJoined() exactly once when the SDK transitions to 'joined'.
  // Wired to state.markJoined() by the host (RoomClient / EngineerSession)
  // so the server session-status advances.
  const joinedFiredRef = useRef(false);
  useEffect(() => {
    if (call.status === "joined" && !joinedFiredRef.current) {
      joinedFiredRef.current = true;
      try {
        onJoined?.();
      } catch {
        /* host concern */
      }
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
    call.status === "idle" ||
    call.status === "fetching-token" ||
    call.status === "joining";

  // Distinct participant count. `call.participants` is the SDK's
  // getAllUser() which ALREADY includes the local user, so the old
  // `participants.length + (self ? 1 : 0)` double-counted self — a 2-person
  // call read as "3 participants". Dedupe by userId across self +
  // participants so it's correct regardless of whether a given SDK build
  // includes self in getAllUser().
  const participantCount = useMemo(() => {
    const ids = new Set(call.participants.map((p) => p.userId));
    if (call.self) ids.add(call.self.userId);
    return ids.size;
  }, [call.participants, call.self]);

  const headerBar = useMemo(
    () => (
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          color: "var(--text)",
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background:
                call.status === "joined"
                  ? "var(--ok)"
                  : reconnecting
                    ? "var(--warn)"
                    : fatal
                      ? "var(--risk)"
                      : "var(--text-muted)",
            }}
          />
          {call.status === "joined"
            ? "Live"
            : reconnecting
              ? "Reconnecting…"
              : initialising
                ? "Joining…"
                : fatal
                  ? "Connection problem"
                  : "Ended"}
        </div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {participantCount} participant{participantCount === 1 ? "" : "s"}
        </div>
      </div>
    ),
    [call.status, participantCount, reconnecting, fatal, initialising]
  );

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
              Couldn&apos;t connect to the video session.
              <br />
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
        {/* ShareViewer is mounted in EXACTLY ONE place across all render
              modes so its <canvas> / <video> DOM elements (which the Zoom
              SDK is told to draw into via startShareView) persist across
              share-state changes. If we re-mounted it inside conditional
              branches, React would destroy those elements every time
              someone started or stopped sharing, the SDK's reference to
              them would dangle, and the customer would see a black canvas
              even though "is sharing" was reported.

              When no share is active, the viewer hides via visibility +
              0 inset; tiles render on top. When a share starts, tiles
              either portal out (customer) or shrink to a side strip
              (engineer fallback). The legacy side-strip layout uses an
              inset-right so the viewer doesn't underlap the strip.

              Layering: ShareViewer is the bottom layer; tile arrangements
              sit above (z-index ordering via DOM order, no z classes
              needed since the share takes the full area and tiles take a
              positioned subset). */}
        <div
          className="absolute"
          style={{
            top: 0,
            bottom: 0,
            left: 0,
            right:
              call.activeShareUserId !== null && !tilesPortalTarget
                ? "clamp(120px, 18%, 180px)"
                : 0,
            visibility: call.activeShareUserId !== null ? "visible" : "hidden",
          }}
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

        {/* Tile arrangements layered above the (possibly-hidden) ShareViewer. */}
        {call.activeShareUserId !== null && !tilesPortalTarget && (
          <aside
            className="absolute overflow-hidden border-l"
            style={{
              top: 0,
              bottom: 0,
              right: 0,
              width: "clamp(120px, 18%, 180px)",
              borderColor: "var(--border)",
              background: "var(--surface)",
            }}
            aria-label="Participants"
          >
            <TileGrid
              self={call.self}
              participants={call.participants}
              client={call.client}
              forceStack
            />
          </aside>
        )}
        {call.activeShareUserId === null && (
          <div className="absolute inset-0">
            {wideTiles ? (
              // Wide row of equal-width tiles. fillTiles (engineer — the
              // call owns the whole stage) stretches the row to the pane's
              // full height; otherwise (customer) the original behavior:
              // solo fills, 2+ sit in a fixed 340px row.
              <TileGrid
                self={call.self}
                participants={call.participants}
                client={call.client}
                forceSideBySide
                tileHeightPx={
                  fillTiles || inlineTileCount <= 1 ? undefined : 340
                }
              />
            ) : (
              <TileGrid
                self={call.self}
                participants={call.participants}
                client={call.client}
                forceStack={compact}
                // Customer-side plain call: lock to side-by-side so the
                // self-tile + engineer-tile are always both visible. The
                // host (engineer) keeps the responsive flip because their
                // CallSurface mounts in a thin side rail by default and a
                // forced two-column layout there would crush tiles too
                // small to read. The customer mounts in the main panel
                // (52% width) where two equal columns always fit.
                lockSideBySide={role === "guest" && !compact}
              />
            )}
          </div>
        )}
      </div>
      {/* Portal — only mounted when a share is active AND the host has
            provided a target slot. forceSideBySide puts the participants
            in one horizontal row of equal-width tiles so both are visible
            at once without scroll. Height per tile is 140px; slot below
            in RoomClient is sized to match. */}
      {tilesPortalTarget &&
        call.activeShareUserId !== null &&
        createPortal(
          <TileGrid
            self={call.self}
            participants={call.participants}
            client={call.client}
            forceSideBySide
            tileHeightPx={140}
          />,
          tilesPortalTarget
        )}

      <ControlBar
        self={call.self}
        isHost={isHost}
        sharing={sharing}
        someoneElseSharing={someoneElseSharing}
        sharerName={sharerName}
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
