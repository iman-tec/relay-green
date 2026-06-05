"use client";

/*
 * Floating AI-assistant launcher — the ONLY assistant UI on the engineer's
 * session screens (the inline panels were removed; the assistant lives in
 * its own tab).
 *
 * Behavior:
 *   • click (pointer travel < 5px)  → open/refocus the session's assistant
 *     tab (gesture-bound, so never popup-blocked);
 *   • drag  (travel ≥ 5px)          → reposition; that pointer-up does NOT
 *     open the tab. Native pointer events — mouse + touch, no library.
 *   • clamped to the viewport while dragging and on window resize;
 *   • position intentionally NOT persisted — resets to the default
 *     (bottom-right, clear of End-session / call controls) every mount;
 *   • ≥44px target, keyboard-activatable (Enter/Space), aria-label.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { openAssistantTab } from "@/lib/relay/assistantTab";

// Sized + positioned to PAIR with the floating chat dock's launcher
// (FloatingDock: 56px bubble, 12px margin, bottom-right): same diameter,
// same right edge, stacked one slot ABOVE it with a 10px gap so the two
// buttons read as a vertical pair and never overlap.
const SIZE = 56; // px — matches the chat dock launcher
const MARGIN = 12; // matches the chat dock margin
const STACK_GAP = 10; // gap between this and the chat launcher below
const DRAG_THRESHOLD = 5; // px of travel that flips a click into a drag

export function AssistantLauncher({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId: string | null;
}) {
  // Position = top-left corner. null until mounted (needs window size for
  // the bottom-right default).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const clamp = useCallback((x: number, y: number) => {
    const maxX = window.innerWidth - SIZE - MARGIN;
    const maxY = window.innerHeight - SIZE - MARGIN;
    return {
      x: Math.min(Math.max(x, MARGIN), Math.max(maxX, MARGIN)),
      y: Math.min(Math.max(y, MARGIN), Math.max(maxY, MARGIN)),
    };
  }, []);

  // Default: bottom-right, exactly ONE slot above the chat dock's
  // launcher (same right edge, same size) so the pair stacks cleanly
  // without overlap. Recomputed fresh on every mount — no persistence.
  useEffect(() => {
    const place = () =>
      setPos(
        clamp(
          window.innerWidth - SIZE - MARGIN,
          window.innerHeight - SIZE - MARGIN - (SIZE + STACK_GAP)
        )
      );
    place();
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pos) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setPos(clamp(d.originX + dx, d.originY + dy));
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>): boolean => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return false;
    dragRef.current = null;
    return d.moved;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dragged = endDrag(e);
    // Below-threshold release = click → open/refocus the assistant tab.
    // A real drag must NOT open it.
    if (!dragged) openAssistantTab(sessionId, projectId);
  };

  if (!pos) return null;

  return (
    <button
      type="button"
      aria-label="Open AI assistant"
      title="Open AI assistant"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => void endDrag(e)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openAssistantTab(sessionId, projectId);
        }
      }}
      className="fixed z-[var(--z-sticky)] flex cursor-grab touch-none items-center justify-center rounded-full shadow-lg transition-shadow hover:shadow-xl focus-visible:ring-4 focus-visible:outline-none active:cursor-grabbing"
      style={{
        left: pos.x,
        top: pos.y,
        width: SIZE,
        height: SIZE,
        backgroundColor: "var(--primary)",
        color: "#fff",
        boxShadow:
          "0 8px 24px color-mix(in srgb, var(--primary) 40%, transparent)",
      }}
    >
      <Sparkles size={20} />
    </button>
  );
}
