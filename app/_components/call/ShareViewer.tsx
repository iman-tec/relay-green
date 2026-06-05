"use client";

/*
 * Renders an active screen share — either the local user's own share (when
 * we passed canvasRef/videoRef.current to startShareScreen) or a remote
 * participant's share (when we called startShareView on the same element).
 *
 * @zoom/videosdk 2.x picks <canvas> vs <video> at runtime based on
 * WebCodecs availability (which itself depends on SharedArrayBuffer +
 * COOP/COEP headers). We render BOTH and let useZoomCall pass whichever
 * the SDK accepts. `activeMode` controls which one is visible.
 */

type Props = {
  /** Filled when SDK is in fallback (non-WebCodecs) mode — used on
   *  localhost without COOP/COEP and on any host where
   *  enforceMultipleVideos is on. */
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Filled when SDK is in WebCodecs mode — used on hosts that ship the
   *  COOP/COEP headers so SAB is available. */
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  /** Which element the SDK actually rendered into. Null until startShare*
   *  succeeds; useZoomCall sets this. */
  activeMode: "canvas" | "video" | null;
  sharerName: string;
  selfSharing: boolean;
  onStop?: () => void;
};

export function ShareViewer({
  canvasRef,
  videoRef,
  activeMode,
  sharerName,
  selfSharing,
  onStop,
}: Props) {
  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center"
      style={{ background: "#000" }}
    >
      <div
        className="absolute top-2 left-2 z-10 rounded-md px-2 py-1 text-[11px] font-medium"
        style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
      >
        {selfSharing
          ? "You are sharing your screen"
          : `${sharerName} is sharing`}
      </div>
      {selfSharing && onStop && (
        <button
          type="button"
          onClick={onStop}
          className="absolute top-2 right-2 z-10 rounded-md px-2 py-1 text-[11px] font-semibold"
          style={{ background: "var(--risk)", color: "#fff" }}
        >
          Stop sharing
        </button>
      )}
      {/* Both elements stay mounted so their refs are populated BEFORE the
          user clicks Share; only the one the SDK actually wrote to is
          visible. Default to canvas-visible until the SDK tells us
          otherwise — that's the localhost path. */}
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        className="absolute inset-0 h-full w-full"
        style={{
          display: activeMode === "video" ? "none" : "block",
          objectFit: "contain",
          background: "#000",
        }}
      />
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full"
        style={{
          display: activeMode === "video" ? "block" : "none",
          objectFit: "contain",
          background: "#000",
        }}
      />
    </div>
  );
}
