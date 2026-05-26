"use client";

/*
 * Renders an active screen share — either the local user's own share (when
 * we passed `canvasRef.current` to startShareScreen) or a remote
 * participant's share (when we called startShareView on the same canvas).
 *
 * Mount this full-bleed in the main pane only when activeShareUserId is
 * not null. The canvas ref is hoisted to the parent so the SDK can write
 * to it; we just render the layout chrome.
 */

import { forwardRef } from "react";

type Props = {
  sharerName: string;
  selfSharing: boolean;
  onStop?: () => void;
};

// @zoom/videosdk 2.x with WebCodecs enabled requires a <video> element for
// both startShareScreen (local) and startShareView (remote). Canvas only
// works in legacy code paths and the SDK rejects with errorCode 6003 +
// "Use Video element instead of Canvas element when WebCodecs enabled".
export const ShareViewer = forwardRef<HTMLVideoElement, Props>(function ShareViewer(
  { sharerName, selfSharing, onStop },
  ref,
) {
  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center"
      style={{ background: "#000" }}
    >
      <div
        className="absolute left-2 top-2 z-10 rounded-md px-2 py-1 text-[11px] font-medium"
        style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
      >
        {selfSharing ? "You are sharing your screen" : `${sharerName} is sharing`}
      </div>
      {selfSharing && onStop && (
        <button
          type="button"
          onClick={onStop}
          className="absolute right-2 top-2 z-10 rounded-md px-2 py-1 text-[11px] font-semibold"
          style={{ background: "var(--risk)", color: "#fff" }}
        >
          Stop sharing
        </button>
      )}
      <video
        ref={ref}
        autoPlay
        muted
        playsInline
        className="h-full w-full"
        style={{ display: "block", objectFit: "contain", background: "#000" }}
      />
    </div>
  );
});
