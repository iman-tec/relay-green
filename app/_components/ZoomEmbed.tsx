"use client";

/*
 * Embedded Zoom Meeting SDK — CDN load (Component View).
 *
 * Loads the Zoom Meeting SDK + its required React 18 + redux + lodash from
 * Zoom's official CDN. We don't import @zoom/meetingsdk via npm because
 * Meeting SDK 6.x expects React 18's `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`
 * which was removed in React 19. The CDN bundle ships its own React 18 and
 * runs entirely standalone of the host page's React.
 *
 * Reference: https://developers.zoom.us/docs/meeting-sdk/web/component-view/
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Video, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { silenceSdkNoise } from "@/lib/relay/silenceSdkNoise";

// Install the console.error filter for known Zoom-SDK noise as soon as
// this module is loaded — the SDK starts logging from the moment it boots.
silenceSdkNoise();

type Props = {
  meetingNumber: string;
  password?: string | null;
  userName: string;
  userEmail?: string | null;
  role: 0 | 1; // 1 = host, 0 = attendee
  fallbackJoinUrl?: string | null;
  onJoined?: () => void;
  onLeave?: () => void;
  onError?: (reason: string) => void;
};

const ZOOM_VERSION = "3.13.2";
const SDK_BASE = `https://source.zoom.us/${ZOOM_VERSION}`;

// Order matters: react, react-dom, redux, redux-thunk, lodash, then Zoom SDK
const SCRIPTS = [
  `${SDK_BASE}/lib/vendor/react.min.js`,
  `${SDK_BASE}/lib/vendor/react-dom.min.js`,
  `${SDK_BASE}/lib/vendor/redux.min.js`,
  `${SDK_BASE}/lib/vendor/redux-thunk.min.js`,
  `${SDK_BASE}/lib/vendor/lodash.min.js`,
  `${SDK_BASE}/zoom-meeting-embedded-${ZOOM_VERSION}.min.js`,
];

let scriptsLoadedPromise: Promise<void> | null = null;
let toolbarStyleInjected = false;

/**
 * Zoom's Component View ships a toolbar that auto-hides after a few seconds
 * of mouse inactivity (matches the native Zoom client UX). For Relay we want
 * the mute / camera / share / leave controls always visible so the user
 * never has to guess where they are. Override the hide rules with broad
 * selectors that match Zoom's hashed Material-UI class names.
 */
function injectToolbarStyleOnce(): void {
  if (toolbarStyleInjected || typeof document === "undefined") return;
  toolbarStyleInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-relay-zoom-toolbar", "");
  style.textContent = `
    /* #meetingSDKElement is sized via React inline style (panelSize); we
       don't force 100% here so the wrapper's flex centering can take effect.
       Inner Zoom containers fill the embed — that's what the SDK renders
       its UI into. */
    [aria-label='Zoom app container'],
    [class*='zoom-MuiPaper-root'] {
      width: 100% !important;
      height: 100% !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
    }

    /* Persistent bottom toolbar — overrides the SDK auto-hide. */
    [aria-label='Zoom app container'] [class*='oolbar'],
    [class*='zoom-MuiToolbar-root'],
    [class*='zoom-MuiPaper-root'] [class*='footer'],
    [class*='zoom-MuiPaper-root'] [class*='bottomCenter'],
    [class*='zoom-MuiPaper-root'] [class*='bottomLeft'],
    [class*='zoom-MuiPaper-root'] [class*='bottomRight'] {
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
      transition: none !important;
    }
  `;
  document.head.appendChild(style);
}

// ── Module-level SDK serialization ─────────────────────────────────────────
// The Zoom Meeting SDK (Component View) keeps internal singleton state on
// `window`. Calling `init()` again while a prior meeting/init is still in
// flight throws errorCode 3000 ("Already has other meetings in progress.").
// This happens both in production (rapid route changes) and in dev under
// React StrictMode (which intentionally double-invokes effects). The
// component-level `clientRef` doesn't see the in-flight join because join
// is async — clientRef is only assigned *after* it resolves.
//
// We solve it by gating every init/join behind a module-level promise chain
// (`zoomGate`). All callers append themselves to the chain, so a second
// mount's work doesn't run until the first mount's work has resolved (join
// + any subsequent leave). The chain also serves as the teardown wait
// queue.
let zoomGate: Promise<unknown> = Promise.resolve();
function chainOnGate<T>(task: () => Promise<T>): Promise<T> {
  const next = zoomGate.catch(() => undefined).then(task);
  zoomGate = next.catch(() => undefined);
  return next;
}

function loadZoomSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as Record<string, unknown>).ZoomMtgEmbedded) return Promise.resolve();
  if (scriptsLoadedPromise) return scriptsLoadedPromise;

  scriptsLoadedPromise = (async () => {
    for (const src of SCRIPTS) {
      await new Promise<void>((resolve, reject) => {
        // Skip if already on the page
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const s = document.createElement("script");
        s.src = src;
        s.async = false; // preserve order
        s.crossOrigin = "anonymous";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
      });
    }
  })();
  return scriptsLoadedPromise;
}

type SuspensionViewType = "minimized" | "speaker" | "ribbon" | "gallery" | "active";

type ZoomClient = {
  init: (opts: unknown) => Promise<void>;
  join: (opts: unknown) => Promise<void>;
  leaveMeeting: () => Promise<void>;
  /** Resize the video panel after init. Replaces the older `updateVideo` name. */
  updateVideoOptions?: (opts: unknown) => void;
  /**
   * Canonical post-init layout setter in Component View 3.x — per the
   * official `embedded.d.ts` (line 1660). Use this; `switchVideoLayout`
   * doesn't exist in this SDK version.
   */
  setViewType?: (view: SuspensionViewType) => Promise<void> | void;
  /** Legacy alias (3.5 era). Kept as a fallback for older builds. */
  switchVideoLayout?: (layout: SuspensionViewType) => void;
  /** Subscribe to SDK events (active-share-change, etc.). */
  on?: (event: string, handler: (payload: unknown) => void) => void;
  off?: (event: string, handler: (payload: unknown) => void) => void;
};

type ZoomMtgEmbeddedNS = {
  createClient: () => ZoomClient;
};

// Network/transient Zoom errors that benefit from a retry — connection
// resets, WiFi/VPN flaps, ERR_NETWORK_CHANGED. Distinguishable from genuine
// auth/state errors (which surface as positive errorCodes like 200 / 3000).
const RETRYABLE_ZOOM_ERROR_CODES = new Set([
  -3000, // connection error
  -2001, // signature failure (often transient handshake issue)
  -1001, // could not connect
]);

// SDK 3.13.2 has a media-device enumeration race: on first join it can read
// `device.capabilities` before the browser has populated them, throwing
// "Cannot read properties of undefined (reading 'caps')". The fix is to
// (a) pre-warm enumerateDevices() ourselves and (b) retry the whole init/join.
function isCapsCrash(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/reading\s+['"]?caps['"]?/i.test(msg)) return true;
  if (/cannot read propert.*of undefined.*caps/i.test(msg)) return true;
  return false;
}

// Force the browser to populate MediaDeviceInfo.capabilities() entries
// before the SDK reads them. Called once per join attempt. Safe to fail —
// we fall through to the SDK and let our retry catch any caps crash.
async function prewarmMediaDevices(): Promise<void> {
  try {
    if (typeof navigator === "undefined") return;
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    // Calling enumerateDevices twice with a short gap is the documented
    // workaround — the first call triggers the browser's device-init,
    // the second returns the now-populated list.
    await md.enumerateDevices().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 80));
    await md.enumerateDevices().catch(() => undefined);
  } catch { /* ignore — best effort */ }
}

// Retry budget for first-join failures. Total ≈ 30s across 6 attempts:
// pre-warm (~0.2s) + init/join (~1-2s) + delay per try.
// Slightly back-loaded so the first retry is fast but later ones give
// the browser/network time to settle.
const FIRST_JOIN_RETRY_DELAYS_MS = [800, 1500, 2500, 4000, 6000, 8000];

// Opt-in dev bypass — set NEXT_PUBLIC_ZOOM_MOCK=1 in .env.local to render a
// fake "in call" placeholder instead of trying to reach Zoom. Useful when
// testing non-video flows on a flaky network.
const MOCK_ENABLED =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_ZOOM_MOCK === "1";

export function ZoomEmbed({
  meetingNumber,
  password,
  userName,
  userEmail,
  role,
  fallbackJoinUrl,
  onJoined,
  onLeave,
  onError,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<ZoomClient | null>(null);
  const joinedKeyRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "joined" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Surfaced during retry loops so the user knows "we're still trying"
  // instead of staring at a frozen spinner. Updates as attempts progress.
  const [loadingMessage, setLoadingMessage] = useState<string>("Connecting to Zoom…");
  // Share view's natural render exceeds the slot at 100% browser zoom. We
  // toggle this on while someone is sharing so the wrapper applies a
  // Chromium-native CSS `zoom` to scale the panel down enough to fit, then
  // restores it when share stops.
  const [isSharing, setIsSharing] = useState(false);
  // Computed Zoom panel size that fits the available slot at a 16:9 aspect,
  // clamped to documented bounds (720×411 min, 1440×720 max). The wrapper
  // flex-centers this so the Zoom embed sits in the middle of the slot with
  // clean black margins around it instead of overflowing or under-sizing.
  const [panelSize, setPanelSize] = useState<{ width: number; height: number }>({
    width: 1280,
    height: 720,
  });

  // ── Phase 2: floating draggable camera bubbles during screen share ──
  // When someone shares their screen:
  //   1. Find Zoom's participant ribbon container in the rendered DOM
  //   2. Re-style it as a floating "bubble panel" anchored top-right
  //   3. Make it draggable (mousedown/move/up)
  //   4. Force Zoom's share canvas to fill the embed (it natively only takes
  //      whatever space the ribbon leaves)
  //   5. MutationObserver watches Zoom's DOM and re-applies the overrides
  //      when Zoom re-renders (which it does frequently)
  // Reverts all changes when share stops.
  useEffect(() => {
    if (!isSharing || !rootRef.current) return;

    // Inline CSS scoped to this share-active state — easier to remove on
    // teardown than dozens of style mutations.
    const RIBBON_SELECTORS = [
      "[class*='zoom-MuiPaper-root'] [class*='ribbon']",
      "[class*='zoom-MuiPaper-root'] [class*='Ribbon']",
      "[class*='zoom-MuiPaper-root'] [class*='participantsList']",
      "[class*='zoom-MuiPaper-root'] [class*='ParticipantsList']",
    ].join(",");
    const SHARE_SELECTORS = [
      "[class*='zoom-MuiPaper-root'] [class*='share-view']",
      "[class*='zoom-MuiPaper-root'] [class*='shareView']",
      "[class*='zoom-MuiPaper-root'] [class*='shared-content']",
      "[class*='zoom-MuiPaper-root'] [class*='sharedContent']",
      "[class*='zoom-MuiPaper-root'] [class*='Share-root']",
      "[class*='zoom-MuiPaper-root'] canvas[id*='share']",
    ].join(",");

    const style = document.createElement("style");
    style.setAttribute("data-relay-share-bubble", "");
    style.textContent = `
      /* Float the ribbon as a draggable bubble panel anchored top-right of
         the embed. Round corners + shadow + border give it the bubble look. */
      ${RIBBON_SELECTORS} {
        position: absolute !important;
        top: 16px !important;
        right: 16px !important;
        left: auto !important;
        bottom: auto !important;
        width: 220px !important;
        max-height: 60% !important;
        z-index: 100 !important;
        border-radius: 14px !important;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
        background: rgba(15, 17, 14, 0.85) !important;
        backdrop-filter: blur(12px) !important;
        overflow: hidden !important;
        cursor: move !important;
        transition: box-shadow 0.18s ease !important;
      }
      ${RIBBON_SELECTORS}:hover {
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.16) !important;
      }
      /* Tiles inside the ribbon — round + tighter spacing so they feel like bubbles. */
      ${RIBBON_SELECTORS} [class*='video-tile'],
      ${RIBBON_SELECTORS} [class*='VideoTile'],
      ${RIBBON_SELECTORS} > div > div {
        border-radius: 10px !important;
        margin: 6px !important;
      }
      /* Force Zoom's share canvas / share view container to fill the embed
         so the shared content uses the full available area. */
      ${SHARE_SELECTORS} {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
      }
    `;
    document.head.appendChild(style);

    // Drag handling — attaches when we find the ribbon, re-attaches if the
    // ribbon DOM node changes (Zoom re-render).
    let draggedRibbon: HTMLElement | null = null;
    let dragX = 16;
    let dragY = 16;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let dragging = false;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Don't start drag from inside a clickable child (toolbar in ribbon, etc.)
      if (t.closest("button, a, [role='button']")) return;
      pointerStartX = e.clientX - dragX;
      pointerStartY = e.clientY - dragY;
      dragging = true;
      e.preventDefault();
    };
    const onPointerMove = (e: MouseEvent) => {
      if (!dragging || !draggedRibbon) return;
      dragX = e.clientX - pointerStartX;
      dragY = e.clientY - pointerStartY;
      // Clamp inside the embed bounds
      const host = rootRef.current;
      if (host) {
        const hostBounds = host.getBoundingClientRect();
        const ribbonBounds = draggedRibbon.getBoundingClientRect();
        const maxX = hostBounds.width - ribbonBounds.width - 8;
        const maxY = hostBounds.height - ribbonBounds.height - 8;
        dragX = Math.max(8, Math.min(maxX, dragX));
        dragY = Math.max(8, Math.min(maxY, dragY));
      }
      draggedRibbon.style.left = `${dragX}px`;
      draggedRibbon.style.top = `${dragY}px`;
      draggedRibbon.style.right = "auto";
      draggedRibbon.style.bottom = "auto";
    };
    const onPointerUp = () => { dragging = false; };

    let attachedRibbon: HTMLElement | null = null;
    const attachToRibbon = () => {
      const host = rootRef.current;
      if (!host) return;
      const ribbon = host.querySelector(RIBBON_SELECTORS) as HTMLElement | null;
      if (!ribbon || ribbon === attachedRibbon) return;
      if (attachedRibbon) attachedRibbon.removeEventListener("mousedown", onPointerDown);
      attachedRibbon = ribbon;
      draggedRibbon = ribbon;
      ribbon.addEventListener("mousedown", onPointerDown);
    };
    attachToRibbon();
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);

    // Zoom re-renders often (participants speak, video tiles update layout).
    // Watch the embed root and re-attach our drag listener whenever the
    // ribbon node changes.
    const mo = new MutationObserver(() => attachToRibbon());
    mo.observe(rootRef.current, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      if (attachedRibbon) attachedRibbon.removeEventListener("mousedown", onPointerDown);
      style.remove();
    };
  }, [isSharing]);

  // ── Phase 3: Teams-style self-preview bubble while NOT sharing ──
  // In Speaker view (defaultViewType: 'speaker'), Zoom renders one big tile
  // (the active speaker = remote in a 1:1 call) plus a small self-preview
  // tile. We re-style that self-preview as a floating bubble in the bottom-
  // right corner and make it draggable. Reverts when share starts (Phase 2
  // takes over) or component unmounts.
  useEffect(() => {
    if (isSharing || status !== "joined" || !rootRef.current) return;

    // Common selectors for the self-preview tile across Zoom SDK 6.x builds.
    // We pick the FIRST match — Zoom usually puts it as a small "PIP-style"
    // tile distinct from the main speaker area.
    const SELF_SELECTORS = [
      "[class*='zoom-MuiPaper-root'] [class*='self-video']",
      "[class*='zoom-MuiPaper-root'] [class*='selfVideo']",
      "[class*='zoom-MuiPaper-root'] [class*='SelfVideo']",
      "[class*='zoom-MuiPaper-root'] [class*='localVideo']",
      "[class*='zoom-MuiPaper-root'] [class*='LocalVideo']",
      "[class*='zoom-MuiPaper-root'] [class*='thumbnail']",
      "[class*='zoom-MuiPaper-root'] [class*='Thumbnail']",
    ].join(",");

    const style = document.createElement("style");
    style.setAttribute("data-relay-self-bubble", "");
    style.textContent = `
      ${SELF_SELECTORS} {
        position: absolute !important;
        bottom: 16px !important;
        right: 16px !important;
        top: auto !important;
        left: auto !important;
        width: 180px !important;
        height: 120px !important;
        z-index: 100 !important;
        border-radius: 14px !important;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
        overflow: hidden !important;
        cursor: move !important;
        transition: box-shadow 0.18s ease !important;
      }
      ${SELF_SELECTORS}:hover {
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.22) !important;
      }

    `;
    document.head.appendChild(style);

    // Drag handling for the self-preview bubble — same pattern as Phase 2.
    let attached: HTMLElement | null = null;
    let dragX = 16;
    let dragY = 16; // measured from bottom-right
    let startX = 0;
    let startY = 0;
    let dragging = false;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("button, a, [role='button']")) return;
      if (!attached) return;
      const r = attached.getBoundingClientRect();
      startX = e.clientX - r.left;
      startY = e.clientY - r.top;
      dragging = true;
      e.preventDefault();
    };
    const onPointerMove = (e: MouseEvent) => {
      if (!dragging || !attached || !rootRef.current) return;
      const hostBounds = rootRef.current.getBoundingClientRect();
      const ribbonBounds = attached.getBoundingClientRect();
      let left = e.clientX - hostBounds.left - startX;
      let top = e.clientY - hostBounds.top - startY;
      left = Math.max(8, Math.min(hostBounds.width - ribbonBounds.width - 8, left));
      top = Math.max(8, Math.min(hostBounds.height - ribbonBounds.height - 8, top));
      attached.style.left = `${left}px`;
      attached.style.top = `${top}px`;
      attached.style.right = "auto";
      attached.style.bottom = "auto";
      dragX = left;
      dragY = top;
    };
    const onPointerUp = () => { dragging = false; };

    const attachToSelf = () => {
      const host = rootRef.current;
      if (!host) return;
      const node = host.querySelector(SELF_SELECTORS) as HTMLElement | null;
      if (!node || node === attached) return;
      if (attached) attached.removeEventListener("mousedown", onPointerDown);
      attached = node;
      node.addEventListener("mousedown", onPointerDown);
    };
    attachToSelf();
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);

    const mo = new MutationObserver(() => attachToSelf());
    mo.observe(rootRef.current, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      if (attached) attached.removeEventListener("mousedown", onPointerDown);
      style.remove();
      // Suppress unused-var lints for the running drag offsets — they are
      // tracked in closure for the lifetime of this share session.
      void dragX; void dragY;
    };
  }, [isSharing, status]);

  // Size Zoom to a 16:9 box that ALWAYS fits inside the wrapper, with a
  // ~90px reserve at the bottom for Zoom's toolbar (so the toolbar isn't
  // pushed below the visible area). Clamped to documented gallery bounds.
  useEffect(() => {
    if (!wrapRef.current) return;
    const ASPECT = 16 / 9;
    const TOOLBAR_RESERVE = 90;
    const MIN_W = 720;
    const MIN_H = 411;
    const MAX_W = 1440;
    const MAX_H = 720;
    const apply = () => {
      const el = wrapRef.current;
      if (!el) return;
      // Available space minus toolbar reserve.
      const availW = el.clientWidth;
      const availH = Math.max(MIN_H, el.clientHeight - TOOLBAR_RESERVE);
      // Fit a 16:9 box inside (availW × availH).
      let w = availW;
      let h = availW / ASPECT;
      if (h > availH) {
        h = availH;
        w = availH * ASPECT;
      }
      // Clamp to documented gallery bounds.
      w = Math.max(MIN_W, Math.min(MAX_W, Math.floor(w)));
      h = Math.max(MIN_H, Math.min(MAX_H, Math.floor(h)));
      setPanelSize({ width: w, height: h });
      const c = clientRef.current;
      try {
        c?.updateVideoOptions?.({
          viewSizes: {
            default: { width: w, height: h },
            ribbon: { width: 316, height: h },
          },
        });
      } catch { /* SDK not ready */ }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    const key = `${meetingNumber}|${role}|${userName}`;
    if (joinedKeyRef.current === key) return;

    (async () => {
      if (!meetingNumber || !rootRef.current) return;
      setStatus("loading");
      setError(null);

      // Dev bypass: skip Zoom entirely and immediately mark "joined" so the
      // rest of the UI (chat, summary, project flow) can be tested on a
      // network that can't reliably reach Zoom.
      if (MOCK_ENABLED) {
        joinedKeyRef.current = key;
        if (!cancelled) {
          setStatus("joined");
          onJoined?.();
        }
        return;
      }

      // Tear down a previous client in this mount
      const prev = clientRef.current;
      if (prev?.leaveMeeting) {
        try { await prev.leaveMeeting(); } catch { /* ignore */ }
        clientRef.current = null;
      }

      // Polyfill mediaDevices for non-secure-context dev (10.0.1.207 over HTTP)
      if (typeof navigator !== "undefined" && !navigator.mediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", {
          value: {}, writable: true, configurable: true,
        });
      }

      // Keep Zoom's bottom toolbar always visible (it auto-hides by default).
      injectToolbarStyleOnce();

      // Load Zoom SDK from CDN (caches across embed instances)
      try {
        await loadZoomSdk();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load Zoom SDK");
        setStatus("error");
        onError?.("sdk_load_failed");
        return;
      }
      const ZoomMtgEmbedded = (window as unknown as { ZoomMtgEmbedded?: ZoomMtgEmbeddedNS }).ZoomMtgEmbedded;
      if (!ZoomMtgEmbedded) {
        if (cancelled) return;
        setError("Zoom SDK not available after load");
        setStatus("error");
        return;
      }

      // Get signature from edge function
      const supabase = createClient();
      const sigRes = await supabase.functions.invoke("zoom-sdk-signature", {
        body: { meetingNumber, role },
      });
      if (sigRes.error || !sigRes.data?.signature) {
        if (cancelled) return;
        setError(sigRes.error?.message ?? sigRes.data?.error ?? "Could not get signature");
        setStatus("error");
        onError?.("signature_failed");
        return;
      }
      const { signature, sdkKey, password: sigPassword, zak } = sigRes.data as {
        signature: string; sdkKey: string; password?: string; zak?: string;
      };
      const effectivePassword = (sigPassword ?? password ?? "") as string;

      if (cancelled || !rootRef.current || !wrapRef.current) return;

      // Watchdog: if join doesn't complete in 60s, fail fast so the user
      // can hit the fallback "Open in Zoom directly" link. Zoom CDN cold
      // starts can be slow, especially on first load.
      const watchdog = setTimeout(() => {
        if (cancelled) return;
        if (joinedKeyRef.current !== key) {
          setError("Zoom is taking too long to connect. Try the fallback link below.");
          setStatus("error");
          onError?.("join_timeout");
        }
      }, 60_000);

      try {
        // Render the SDK's video tiles at gallery-view max (1440×720) so
        // participant cards are visibly large. The outer CSS stretches the
        // Paper container to 100% of the parent slot; this controls the
        // *internal* tile rendering quality/size.
        const initOpts = {
          zoomAppRoot: rootRef.current,
          language: "en-US",
          patchJsMedia: true,
          customize: {
            video: {
              isResizable: true,
              isDisplayAvatar: true,
              // Phase 3: Teams-style speaker view by default. One big tile
              // for the active speaker (= the remote participant in a 1:1
              // call), and the local self-preview gets CSS-extracted as a
              // floating draggable bubble (see effect below). When a share
              // begins, the share-state event handler swaps this to 'ribbon'.
              defaultViewType: "speaker",
              viewSizes: {
                // Gallery + Speaker view. Sized at gallery max (1280×720)
                // so two 16:9 tiles fit comfortably side-by-side instead of
                // the SDK collapsing to a single active-speaker tile.
                default: { width: 720, height: 420 },
                // Used during screen share (vertical ribbon of participants
                // next to the share). 316 wide is the documented max; 600
                // tall comfortably holds 2-4 tiles at 135-180px each.
                ribbon: { width: 316, height: 420 },
              },
            },
            // We don't add custom buttons, but leaving `buttons` undefined
            // (rather than an explicit empty array) lets Zoom render its
            // built-in toolbar including the view-switcher, so the user can
            // manually toggle Speaker/Gallery/Ribbon if our forced view
            // doesn't match the situation.
            meetingInfo: [],
          },
        };
        // SDK v3.x (our current pin) REQUIRES `sdkKey` in joinOptions —
        // omitting it throws "sdkKey can not empty". v4+ removed the
        // field (the signature JWT's appKey claim carries it instead);
        // only drop the line below if/when ZOOM_VERSION is bumped to 4.x.
        const joinOpts = {
          sdkKey,
          signature,
          meetingNumber: String(meetingNumber).replace(/\D/g, ""),
          password: effectivePassword,
          userName,
          userEmail: userEmail ?? "",
          ...(role === 1 && zak ? { zak } : {}),
        };

        // initAndJoin: creates a (singleton) client, kicks any leftover
        // session out, pre-warms media devices (works around the v3.13.2
        // caps-undefined crash), then inits and joins.
        const initAndJoin = async (): Promise<ZoomClient> => {
          const c = ZoomMtgEmbedded.createClient();
          try { await c.leaveMeeting(); } catch { /* nothing to leave */ }
          // Pre-warm: the SDK's media-device enumeration races against the
          // browser's device-init on first join, crashing with "reading
          // 'caps'". Forcing enumerateDevices() ourselves first populates
          // capabilities so the SDK sees them ready when it looks.
          await prewarmMediaDevices();
          await c.init(initOpts);
          await c.join(joinOpts);
          return c;
        };

        // Everything that touches the SDK goes through the module-level
        // gate so concurrent mounts (StrictMode / fast route changes) are
        // serialised. Mount #2 waits for mount #1's join/leave to fully
        // resolve before starting its own init/join.
        //
        // Retry strategy:
        //   • errorCode 3000 ("Already has other meetings in progress")
        //       → force-leave + immediate retry, no backoff.
        //   • Negative errorCodes (-3000 / -2001 / -1001) → transient
        //       network / WiFi flap → back off and retry.
        //   • caps-undefined TypeError (the 3.13.2 first-join bug, see
        //       isCapsCrash above) → back off and retry; pre-warm runs
        //       again and usually succeeds by attempt 2-3.
        //   • Anything else (signature reject, auth fail, bad meeting id)
        //       → surface to the error UI immediately. No retry helps.
        //
        // Total budget across 6 attempts ≈ 30s including delays + work.
        let client: ZoomClient | null = null;
        let lastErr: unknown = null;
        const maxAttempts = FIRST_JOIN_RETRY_DELAYS_MS.length;
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
          if (cancelled) return;
          if (attempt === 0) {
            setLoadingMessage("Connecting to Zoom…");
          } else {
            setLoadingMessage(`Reconnecting… (${attempt}/${maxAttempts})`);
          }
          try {
            client = await chainOnGate(initAndJoin);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            const code = (err as { errorCode?: number } | null)?.errorCode;

            // 3000: stale singleton — drop and immediately retry, no backoff.
            if (code === 3000) {
              await chainOnGate(async () => {
                try { await ZoomMtgEmbedded.createClient().leaveMeeting(); } catch { /* ignore */ }
                await new Promise((r) => setTimeout(r, 500));
              });
              continue;
            }

            const retryable =
              (code != null && RETRYABLE_ZOOM_ERROR_CODES.has(code)) ||
              isCapsCrash(err);

            if (retryable && attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, FIRST_JOIN_RETRY_DELAYS_MS[attempt]));
              continue;
            }

            // Not retryable, or out of budget — surface to the catch below.
            throw err;
          }
        }
        if (!client) throw lastErr;
        clientRef.current = client;

        joinedKeyRef.current = key;
        clearTimeout(watchdog);

        // === DIAGNOSTICS — tells us exactly what the SDK does/doesn't support.
        // After rejoin, open browser devtools console and report what you see.
        // eslint-disable-next-line no-console
        console.log("[ZoomEmbed] client API surface:", {
          hasSetViewType: typeof (client as Record<string, unknown>).setViewType === "function",
          hasSwitchVideoLayout: typeof (client as Record<string, unknown>).switchVideoLayout === "function",
          hasOn: typeof (client as Record<string, unknown>).on === "function",
          hasUpdateVideoOptions: typeof (client as Record<string, unknown>).updateVideoOptions === "function",
          allMethods: Object.keys(client),
        });

        // Gallery view = every participant as an equal tile, so both faces
        // are visible in a 1:1 call. SDK 3.13's canonical post-init API is
        // setViewType; switchVideoLayout is a 3.5-era alias that may not
        // exist here (which is why our earlier call was a no-op). We try
        // setViewType first, fall back to switchVideoLayout if missing.
        const applyLayout = async (view: SuspensionViewType): Promise<void> => {
          if (typeof client.setViewType === "function") {
            await client.setViewType(view);
            // eslint-disable-next-line no-console
            console.log(`[ZoomEmbed] setViewType('${view}') called OK`);
            return;
          }
          if (typeof client.switchVideoLayout === "function") {
            client.switchVideoLayout(view);
            // eslint-disable-next-line no-console
            console.log(`[ZoomEmbed] switchVideoLayout('${view}') (fallback) called OK`);
            return;
          }
          // eslint-disable-next-line no-console
          console.warn(`[ZoomEmbed] no layout API available — relying on defaultViewType in init`);
        };
        try { await applyLayout("speaker"); }
        catch (e) {
          // eslint-disable-next-line no-console
          console.log("[ZoomEmbed] applyLayout('speaker') failed:", e);
        }

        try {
          const onShareChange = (payload: unknown) => {
            // eslint-disable-next-line no-console
            console.log("[ZoomEmbed] share event payload:", payload);
            const p = payload as { state?: string; status?: string } | undefined;
            const state = (p?.state ?? p?.status ?? "").toString().toLowerCase();
            const sharing = state === "active" || state === "share" || state === "sharing" || state === "started";
            if (!cancelled) setIsSharing(sharing);
            // Ribbon while someone is sharing (so the shared screen has room);
            // gallery when nobody is sharing so both faces stay visible.
            void applyLayout(sharing ? "ribbon" : "speaker").catch(() => undefined);
          };
          for (const ev of [
            "active-share-change",
            "share-state-change",
            "peer-share-state-change",
            "share-content-change",
            "active-share-start",
            "active-share-end",
          ]) {
            try {
              client.on?.(ev, onShareChange);
              // eslint-disable-next-line no-console
              console.log(`[ZoomEmbed] listener attached for '${ev}'`);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.log(`[ZoomEmbed] listener FAILED for '${ev}':`, e);
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log("[ZoomEmbed] event listener wiring failed:", e);
        }
        if (!cancelled) {
          setStatus("joined");
          onJoined?.();
        }
      } catch (e: unknown) {
        clearTimeout(watchdog);
        // Zoom SDK errors are often class instances with non-enumerable
        // fields — JSON.stringify on them yields "{}". Walk every own and
        // inherited property so we get something useful in the console.
        const err = e as Record<string, unknown>;
        const collected: Record<string, unknown> = {};
        try {
          const seen = new Set<string>();
          let o: object | null = err as object;
          while (o && o !== Object.prototype) {
            for (const k of Object.getOwnPropertyNames(o)) {
              if (seen.has(k) || k === "constructor") continue;
              seen.add(k);
              try { collected[k] = (err as Record<string, unknown>)[k]; }
              catch { /* getter threw — skip */ }
            }
            o = Object.getPrototypeOf(o);
          }
        } catch { /* ignore */ }
        const reason =
          (collected.reason as string | undefined) ??
          (collected.message as string | undefined) ??
          (collected.errorCode != null
            ? `Zoom error ${collected.errorCode}: ${collected.type ?? collected.name ?? "unknown"}`
            : undefined) ??
          (typeof e === "string" ? e : undefined) ??
          (e instanceof Error ? e.toString() : undefined) ??
          "Couldn't join the meeting (no detail from Zoom)";
        // Inline the full diagnostic in the message itself — the Next.js
        // dev overlay collapses object args to "{}", so without this you
        // see nothing useful in the overlay panel.
        const collectedStr = (() => {
          try { return JSON.stringify(collected); } catch { return "<unserializable>"; }
        })();
        console.error(
          `[ZoomEmbed] join failed: ${reason} | typeof=${typeof e} | ctor=${
            (e as { constructor?: { name?: string } } | null)?.constructor?.name ?? "n/a"
          } | collected=${collectedStr}`,
          { raw: e, role, meetingNumber, signaturePresent: !!signature, sdkKeyPresent: !!sdkKey, zakPresent: !!zak },
        );
        // Translate raw Zoom messages into human-friendly diagnoses so the
        // user knows whether to retry, switch networks, or click the
        // fallback link.
        const code = (collected.errorCode as number | undefined) ?? null;
        const friendly = (() => {
          if (code != null && RETRYABLE_ZOOM_ERROR_CODES.has(code)) {
            return "Network connection to Zoom keeps dropping. Try a different network (mobile hotspot, disable VPN) or open Zoom directly below.";
          }
          if (code === 3000) {
            return "Another Zoom meeting is still active in this browser. Close other tabs joined to a Zoom call and refresh.";
          }
          if (code === 1006) return "Zoom signature was rejected. Check the SDK credentials.";
          if (code === 200)  return "Zoom rejected the meeting password.";
          return reason;
        })();
        if (!cancelled) {
          setError(friendly);
          setStatus("error");
          onError?.(reason);
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingNumber, role, userName]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const c = clientRef.current;
      clientRef.current = null;
      joinedKeyRef.current = null;
      if (c?.leaveMeeting) {
        // Queue the leave on the module gate so the next mount's init waits
        // for it. Also defensively try the singleton-style leave in case
        // the SDK has stashed state outside our reference.
        chainOnGate(async () => {
          try { await c.leaveMeeting(); } catch { /* ignore */ }
        });
      }
      onLeave?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 1 strategy: flex-center the Zoom embed inside the wrapper at a
  // computed 16:9 size that fits the available slot. No CSS-zoom hacks; the
  // SDK renders at panelSize.width × panelSize.height and we keep both the
  // outer container and viewSizes in lockstep via the ResizeObserver above.
  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden flex items-center justify-center"
      style={{ backgroundColor: "#000" }}
    >
      <div
        ref={rootRef}
        id="meetingSDKElement"
        style={{ width: panelSize.width, height: panelSize.height }}
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-2 text-white">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-xs">{loadingMessage}</span>
          </div>
        </div>
      )}
      {status === "joined" && MOCK_ENABLED && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white/80">
            <Video size={32} className="mx-auto mb-2 opacity-70" />
            <p className="text-sm font-medium">Zoom mock mode</p>
            <p className="mt-1 text-[11px] opacity-60">Video is bypassed for testing.</p>
            <p className="mt-0.5 text-[10px] opacity-50">Unset NEXT_PUBLIC_ZOOM_MOCK to use real Zoom.</p>
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6">
          <div className="max-w-sm text-center">
            <Video size={28} className="mx-auto mb-3 text-white/60" />
            <p className="text-sm font-medium text-white">Couldn&apos;t connect to Zoom</p>
            <p className="mt-2 text-xs leading-relaxed text-white/70">{error}</p>
            {fallbackJoinUrl ? (
              <a
                href={fallbackJoinUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-white px-4 py-2 text-sm font-medium text-black"
              >
                <ExternalLink size={14} /> Open in Zoom directly
              </a>
            ) : null}
            <p className="mt-4 text-[10px] uppercase tracking-[0.12em] text-white/40">
              Or try a different network · disable VPN · use the Zoom desktop app
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
