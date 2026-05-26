"use client";

/*
 * Public entry for the in-window Zoom Video SDK call surface.
 *
 * Wraps the heavy CallSurfaceInner in next/dynamic({ ssr: false }) because:
 *   1. The SDK touches `window` at import time.
 *   2. Bundling the SDK into the SSR path bloats every page.
 *
 * Mount this component absolutely-positioned (`absolute inset-0`) over the
 * chat pane root. The host owns the open/close state.
 */

import dynamic from "next/dynamic";

type CallSurfaceProps = {
  sessionId: string;
  role: "host" | "guest";
  userName: string;
  onClose: () => void;
  /** Fires once when the SDK transitions to joined — typically to stamp
   *  state.markJoined() so the session lifecycle advances from
   *  'assigned' to 'joining'/'live'. */
  onJoined?: () => void;
};

export const CallSurface = dynamic<CallSurfaceProps>(
  () => import("./CallSurfaceInner").then((m) => m.CallSurfaceInner),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full w-full items-center justify-center"
        style={{ background: "var(--surface)", color: "var(--text-muted)" }}
      >
        Connecting to video…
      </div>
    ),
  },
);
