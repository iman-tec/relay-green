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
  /** Lock the layout to the responsive side-by-side grid even on
   *  containers narrower than NARROW_WIDTH_PX. Used by the customer's
   *  main call panel, where the panel can flicker below the threshold
   *  while a PanelGroup divider is being dragged or while the SDK is
   *  still measuring — without this, the second tile gets clipped or
   *  pushed below the fold and the customer only sees one pane. */
  lockSideBySide?: boolean;
};

// Width below which we flip to vertical-stack + square tiles. We prefer
// horizontal as long as it fits — only flip when the container truly
// can't accommodate side-by-side tiles. ~200px is roughly the point where
// two tiles side-by-side become too small to recognize faces.
const NARROW_WIDTH_PX = 200;

export function TileGrid({ self, participants, client, forceStack = false, forceSideBySide = false, tileHeightPx, lockSideBySide = false }: Props) {
  // Include self at the front; SDK's getAllUser sometimes omits the local user.
  const all = self ? [self, ...participants.filter((p) => p.userId !== self.userId)] : participants;

  // Track container width so we can flip to vertical stacking once it gets
  // too narrow for side-by-side tiles. ResizeObserver is cheaper than a
  // window resize handler and reacts to PanelGroup divider drags.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (forceStack || lockSideBySide) return;
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < NARROW_WIDTH_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [forceStack, lockSideBySide]);
  const stack = forceStack || (narrow && !lockSideBySide);

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

  // Stacked layout: one tile per row, square aspect ratio, scrolls when
  // the rail is short.
  //
  // Side-by-side layout: a 2-column "gallery" grid that grows downward —
  // a conceptual 2×2 matrix where 2 participants fill the top row
  // (cells 1,1 + 1,2), a 3rd/4th would fill the second row, etc. Tiles
  // are near-square (4:3) and top-aligned (`content-start`), with each
  // column capped (`min(46%, 460px)`) and the pair centred so they don't
  // stretch into wide letterbox rectangles on a wide call pane. This is
  // the clean, predictable layout requested over the earlier
  // full-stretch / 16:9 variants.
  return (
    <div
      ref={wrapperRef}
      className={stack
        ? "flex h-full w-full flex-col gap-2 overflow-y-auto p-2"
        : "grid h-full w-full content-start justify-center gap-3 overflow-y-auto p-3"}
      style={stack ? undefined : {
        gridTemplateColumns:
          all.length <= 2
            ? `repeat(${Math.max(all.length, 1)}, minmax(0, min(46%, 460px)))`
            : "repeat(auto-fit, minmax(200px, 280px))",
      }}
    >
      {all.map((p) => (
        <div
          key={p.userId}
          className={stack ? "w-full shrink-0" : "min-h-0 min-w-0"}
          style={
            stack
              ? tileHeightPx
                ? { height: tileHeightPx }
                : { aspectRatio: "1 / 1" }
              : { aspectRatio: "4 / 3" }
          }
        >
          <VideoTile participant={p} client={client} />
        </div>
      ))}
    </div>
  );
}
