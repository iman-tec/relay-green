"use client";

/*
 * FloatingDock — a draggable, collapsible floating panel (Intercom/Tidio style).
 *
 * Collapsed = a circular launcher button (its `icon`). Expanded = a panel with
 * a drag-handle header (title + minimize) and arbitrary `children` below.
 *
 *  • Draggable anywhere in the window (grab the launcher or the header); a real
 *    click (no movement) on the launcher opens it.
 *  • Position + open/closed are persisted per `storageKey` (localStorage) and
 *    clamped into the viewport on open + resize.
 *  • Portaled to <body> so it floats above the call stage.
 *  • Pure theme tokens (var(--surface)/--border/--text/--primary/…), so it works
 *    in every theme automatically.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Minus } from "lucide-react";

type Pos = { x: number; y: number };
const DRAG_THRESHOLD = 4;
const LAUNCHER = 56;
const MARGIN = 12;

function clamp(p: Pos, w: number, h: number): Pos {
  if (typeof window === "undefined") return p;
  const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN);
  return { x: Math.min(Math.max(MARGIN, p.x), maxX), y: Math.min(Math.max(MARGIN, p.y), maxY) };
}

export function FloatingDock({
  storageKey, title, icon, children, width = 380, height = 520, accent = false, cornerOffset = 0,
}: {
  storageKey: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  width?: number;
  height?: number;
  /** accent = filled brand launcher (use for the primary/chat dock). */
  accent?: boolean;
  /** stack multiple launchers in the same corner without overlapping. */
  cornerOffset?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);

  // Mount + restore persisted state (or default to bottom-right). Client-only
  // init from localStorage — the setState-in-effect is intentional here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    let restored = false;
    try {
      const raw = localStorage.getItem(`floatdock:${storageKey}`);
      if (raw) {
        const s = JSON.parse(raw) as { x: number; y: number; open: boolean };
        setOpen(!!s.open);
        setPos(clamp({ x: s.x, y: s.y }, s.open ? width : LAUNCHER, s.open ? height : LAUNCHER));
        restored = true;
      }
    } catch { /* ignore */ }
    if (!restored && typeof window !== "undefined") {
      setPos({
        x: window.innerWidth - LAUNCHER - MARGIN,
        y: window.innerHeight - LAUNCHER - MARGIN - cornerOffset,
      });
    }
  }, [storageKey, width, height, cornerOffset]);

  // Persist.
  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem(`floatdock:${storageKey}`, JSON.stringify({ ...pos, open })); } catch { /* ignore */ }
  }, [mounted, pos, open, storageKey]);

  // Keep in-bounds on open/close + window resize.
  useEffect(() => {
    if (!mounted) return;
    const w = open ? width : LAUNCHER;
    const h = open ? height : LAUNCHER;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos((p) => clamp(p, w, h));
    const onResize = () => setPos((p) => clamp(p, w, h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, open, width, height]);

  const onDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y, moved: false };
  }, [pos]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    const w = open ? width : LAUNCHER, h = open ? height : LAUNCHER;
    setPos(clamp({ x: d.px + dx, y: d.py + dy }, w, h));
  }, [open, width, height]);

  const onUp = useCallback((openOnClick: boolean) => (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (openOnClick && d && !d.moved) setOpen(true);
  }, []);

  if (!mounted) return null;

  const hoverBg = "color-mix(in srgb, var(--text) 9%, transparent)";

  const node = open ? (
    <div
      className="fixed flex flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{ left: pos.x, top: pos.y, width, height, zIndex: 1000, backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp(false)}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b px-3 py-2 active:cursor-grabbing"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
      >
        <span className="flex h-5 w-5 items-center justify-center" style={{ color: "var(--primary)" }}>{icon}</span>
        <span className="flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--text)" }}>{title}</span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpen(false)}
          title="Minimize"
          aria-label="Minimize"
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <Minus size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  ) : (
    <button
      type="button"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp(true)}
      title={title}
      aria-label={`Open ${title}`}
      className="fixed flex cursor-grab touch-none items-center justify-center rounded-full border shadow-xl transition-transform hover:scale-105 active:cursor-grabbing"
      style={{
        left: pos.x, top: pos.y, height: LAUNCHER, width: LAUNCHER, zIndex: 1000,
        backgroundColor: accent ? "var(--primary)" : "var(--surface)",
        borderColor: accent ? "transparent" : "var(--border)",
        color: accent ? "#fff" : "var(--primary)",
      }}
    >
      {icon}
    </button>
  );

  return createPortal(node, document.body);
}
