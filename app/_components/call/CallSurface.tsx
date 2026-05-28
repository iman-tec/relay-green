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
  /** When the surface is mounted inside a side rail (e.g. engineer's
   *  right column), force participant tiles to stack vertically as
   *  squares regardless of the rail's actual pixel width. Without this
   *  hint, a rail that happens to be wider than the responsive threshold
   *  still renders side-by-side rectangles. Default: false. */
  compact?: boolean;
  /** When provided AND a screen share is currently active, participant
   *  tiles are rendered (via React portal) into this element instead of
   *  inline alongside the share viewer. Used by RoomClient to hoist
   *  tiles into the right rail above chat once sharing starts, so the
   *  customer's center column shows the shared screen full-width. When
   *  no share is active, tiles render inline in the center (the legacy
   *  "video call without share" layout). Null/undefined target → tiles
   *  always render inline (engineer-side behavior, unchanged). */
  tilesPortalTarget?: HTMLElement | null;
  /** Fires whenever the active-share state changes (null ↔ userId).
   *  RoomClient uses this to mount/unmount the tiles slot in the right
   *  rail so the chat fills the rail when nobody is sharing. */
  onShareStateChange?: (sharing: boolean) => void;
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
