"use client";

import { useEffect, useRef, useState } from "react";
import { VideoTile } from "./VideoTile";
import type { Participant } from "@/lib/video/useZoomCall";

type Props = {
  self: Participant | null;
  participants: Participant[];
  client: any;
  /** Forces vertical stacking regardless of container width. Used when the
   *  call surface is mounted as a thin side rail (customer watching a
   *  share, narrow engineer right rail). */
  forceStack?: boolean;
};

// Width below which we flip to vertical-stack + square tiles. We prefer
// horizontal as long as it fits — only flip when the container truly
// can't accommodate side-by-side tiles. ~200px is roughly the point where
// two tiles side-by-side become too small to recognize faces.
const NARROW_WIDTH_PX = 200;

export function TileGrid({ self, participants, client, forceStack = false }: Props) {
  // Include self at the front; SDK's getAllUser sometimes omits the local user.
  const all = self ? [self, ...participants.filter((p) => p.userId !== self.userId)] : participants;

  // Track container width so we can flip to vertical stacking once it gets
  // too narrow for side-by-side tiles. ResizeObserver is cheaper than a
  // window resize handler and reacts to PanelGroup divider drags.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (forceStack) return;
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < NARROW_WIDTH_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [forceStack]);
  const stack = forceStack || narrow;

  if (all.length === 0) {
    return (
      <div
        ref={wrapperRef}
        className="flex h-full w-full items-center justify-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        Waiting for participants…
      </div>
    );
  }

  // Stacked layout: one tile per row, square aspect ratio, scrolls when the
  // rail is short. Side-by-side layout: auto-fit grid with a min tile width.
  return (
    <div
      ref={wrapperRef}
      className={stack
        ? "flex h-full w-full flex-col gap-2 overflow-y-auto p-2"
        : "grid h-full w-full gap-2 p-2"}
      style={stack ? undefined : {
        gridTemplateColumns:
          all.length === 1 ? "1fr"
          : all.length === 2 ? "repeat(2, 1fr)"
          : "repeat(auto-fit, minmax(220px, 1fr))",
      }}
    >
      {all.map((p) => (
        <div
          key={p.userId}
          className={stack ? "w-full shrink-0" : "min-h-0"}
          style={{ aspectRatio: stack ? "1 / 1" : "16 / 9" }}
        >
          <VideoTile participant={p} client={client} />
        </div>
      ))}
    </div>
  );
}
