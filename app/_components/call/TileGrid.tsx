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
  /** Forces ALL participants into a single horizontal row, equal-width
   *  columns. Used when tiles are hoisted into a short, wide slot above
   *  chat — `forceStack` would push the second tile out of view there
   *  even with a fixed height. Overrides forceStack when both are set. */
  forceSideBySide?: boolean;
  /** When set, each stacked tile uses this fixed pixel height instead of
   *  `aspect-ratio: 1/1`. Necessary when the rail is wider than the desired
   *  tile size — without it, the aspect-ratio rule blows each tile up to
   *  rail-width-squared and only the first fits before scroll. Also used
   *  in `forceSideBySide` mode to set row height. */
  tileHeightPx?: number;
};

// Width below which we flip to vertical-stack + square tiles. We prefer
// horizontal as long as it fits — only flip when the container truly
// can't accommodate side-by-side tiles. ~200px is roughly the point where
// two tiles side-by-side become too small to recognize faces.
const NARROW_WIDTH_PX = 200;

export function TileGrid({ self, participants, client, forceStack = false, forceSideBySide = false, tileHeightPx }: Props) {
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

  // forceSideBySide: single horizontal row, equal-width columns, fixed
  // tile height. Used for the in-rail tile slot above chat where vertical
  // space is the scarce dimension. Each tile cell takes 1fr of width and
  // tileHeightPx of height — aspect ratio falls out naturally and stays
  // consistent across participants regardless of count.
  if (forceSideBySide) {
    return (
      <div
        ref={wrapperRef}
        className="grid h-full w-full gap-2 p-2"
        style={{
          gridTemplateColumns: `repeat(${all.length}, minmax(0, 1fr))`,
        }}
      >
        {all.map((p) => (
          <div
            key={p.userId}
            className="min-h-0 min-w-0"
            style={tileHeightPx ? { height: tileHeightPx } : undefined}
          >
            <VideoTile participant={p} client={client} />
          </div>
        ))}
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
          style={
            stack
              ? tileHeightPx
                ? { height: tileHeightPx }
                : { aspectRatio: "1 / 1" }
              : { aspectRatio: "16 / 9" }
          }
        >
          <VideoTile participant={p} client={client} />
        </div>
      ))}
    </div>
  );
}
