"use client";

/*
 * The shared "Try Relay" button. Triggers the global modal via context.
 * Two visual variants: "pill" (used in nav + CTA banner) and "ghost-cta"
 * (used in hero, where the green pill sits next to a ghost button).
 */

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RelayLogo } from "./RelayLogo";
import { useTryRelay } from "./TryRelayProvider";

export function TryRelayButton({
  className = "r-try-relay",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { open } = useTryRelay();
  const [openMenu, setOpenMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpenMenu(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  return (
    <div className="r-try-relay-wrap" ref={wrapRef} style={style}>
      <button type="button" className={className} onClick={open}>
        <span>Try</span>
        <RelayLogo size={14} color="currentColor" />
      </button>
      <button
        type="button"
        className="r-try-relay-caret"
        aria-label="Open Try Relay options"
        aria-expanded={openMenu}
        onClick={() => setOpenMenu((value) => !value)}
      >
        <span className="r-try-relay-chevron" aria-hidden="true" />
      </button>
      {openMenu && (
        <div className="r-try-relay-menu" role="menu">
          <Link
            href="/download-relay-desktop"
            role="menuitem"
            onClick={() => setOpenMenu(false)}
          >
            Download Relay Desktop
          </Link>
        </div>
      )}
    </div>
  );
}
