"use client";

/*
 * Minimal Zoom Meeting SDK Component View — mirrors the official Zoom React
 * sample (https://github.com/zoom/meetingsdk-react-sample). No `customize`
 * config, no `viewSizes`, no CSS injection — Zoom takes the parent div's
 * size and renders its own UI inside (including the bottom toolbar with
 * mute, camera, share, leave, etc.).
 *
 * The drop-in replacement for the over-engineered ZoomEmbed we had before.
 * Same props, same call sites.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Video, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { silenceSdkNoise } from "@/lib/relay/silenceSdkNoise";

silenceSdkNoise();

/**
 * Force Zoom's outer containers to fill their parent. Without this the
 * SDK renders its own layout at a smaller intrinsic size, leaving black
 * space on the sides of the embed. Injects once per page.
 */
let fillStyleInjected = false;
function injectFillStyleOnce(): void {
  if (fillStyleInjected || typeof document === "undefined") return;
  fillStyleInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-relay-zoom-fill", "");
  style.textContent = `
    /* The outer mount point is full-bleed and flex-centers its child. */
    #meetingSDKElement {
      width: 100% !important;
      height: 100% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    /* Cap Zoom UI at viewport size (not a fixed pixel box). This stops
       the share canvas from blowing past the window when the source is
       a high-res monitor (4K, ultrawide etc.), while letting the embed
       grow to fill the full window on smaller displays. */
    [aria-label='Zoom app container'],
    [class*='zoom-MuiPaper-root'] {
      max-width: 100vw !important;
      max-height: 100vh !important;
      width: 100% !important;
      height: 100% !important;
      box-sizing: border-box !important;
    }
  `;
  document.head.appendChild(style);
}

type Props = {
  meetingNumber: string;
  password?: string | null;
  userName: string;
  userEmail?: string | null;
  role: 0 | 1;
  fallbackJoinUrl?: string | null;
  onJoined?: () => void;
  onLeave?: () => void;
  onError?: (reason: string) => void;
};

const ZOOM_VERSION = "3.13.2";
const SDK_BASE = `https://source.zoom.us/${ZOOM_VERSION}`;

const SCRIPTS = [
  `${SDK_BASE}/lib/vendor/react.min.js`,
  `${SDK_BASE}/lib/vendor/react-dom.min.js`,
  `${SDK_BASE}/lib/vendor/redux.min.js`,
  `${SDK_BASE}/lib/vendor/redux-thunk.min.js`,
  `${SDK_BASE}/lib/vendor/lodash.min.js`,
  `${SDK_BASE}/zoom-meeting-embedded-${ZOOM_VERSION}.min.js`,
];

let scriptsLoadedPromise: Promise<void> | null = null;

function loadZoomSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as Record<string, unknown>).ZoomMtgEmbedded) return Promise.resolve();
  if (scriptsLoadedPromise) return scriptsLoadedPromise;
  scriptsLoadedPromise = (async () => {
    for (const src of SCRIPTS) {
      await new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement("script");
        s.src = src;
        s.async = false;
        s.crossOrigin = "anonymous";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
      });
    }
  })();
  return scriptsLoadedPromise;
}

type ZoomClient = {
  init: (opts: unknown) => Promise<void>;
  join: (opts: unknown) => Promise<void>;
  leaveMeeting: () => Promise<void>;
  /** Post-init layout switcher per Component View 3.x embedded.d.ts. */
  setViewType?: (view: "gallery" | "speaker" | "ribbon" | "active") => Promise<void> | void;
  /** Legacy alias (3.5 era). */
  switchVideoLayout?: (view: "gallery" | "speaker" | "ribbon" | "active") => void;
  /** Resize the rendered video area at runtime. */
  updateVideoOptions?: (opts: unknown) => void;
};
type ZoomMtgEmbeddedNS = { createClient: () => ZoomClient };

export function ZoomCall({
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
  const clientRef = useRef<ZoomClient | null>(null);
  const joinedKeyRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "joined" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let resizeHandler: (() => void) | null = null;
    let resizeTimer: number | undefined;
    const key = `${meetingNumber}|${role}|${userName}`;
    if (joinedKeyRef.current === key) return;
    if (!meetingNumber || !rootRef.current) return;

    injectFillStyleOnce();

    (async () => {
      setStatus("loading");
      setError(null);

      // Tear down any prior client first — Zoom's SDK is singleton and
      // throws "Already has other meetings in progress" if a stale one is
      // still attached.
      const prev = clientRef.current;
      if (prev?.leaveMeeting) {
        try { await prev.leaveMeeting(); } catch { /* nothing to leave */ }
        clientRef.current = null;
      }

      try {
        await loadZoomSdk();
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Couldn't load Zoom SDK";
        setError(msg);
        setStatus("error");
        onError?.("sdk_load_failed");
        return;
      }

      if (cancelled) return;
      const NS = (window as unknown as { ZoomMtgEmbedded?: ZoomMtgEmbeddedNS }).ZoomMtgEmbedded;
      if (!NS) {
        setError("Zoom SDK not available after load");
        setStatus("error");
        return;
      }

      // Fetch the SDK signature from our edge function.
      const sb = createClient();
      const sigRes = await sb.functions.invoke("zoom-sdk-signature", {
        body: { meetingNumber, role },
      });
      if (sigRes.error || !sigRes.data?.signature) {
        if (cancelled) return;
        setError(sigRes.error?.message ?? sigRes.data?.error ?? "Couldn't get signature");
        setStatus("error");
        onError?.("signature_failed");
        return;
      }
      const { signature, sdkKey, password: sigPassword, zak } = sigRes.data as {
        signature: string; sdkKey: string; password?: string; zak?: string;
      };

      if (cancelled || !rootRef.current) return;

      try {
        const client = NS.createClient();
        clientRef.current = client;

        // Same init args as the official Zoom sample — plus two tweaks:
        //   • defaultViewType: "gallery" — every participant gets an equal
        //     tile instead of just the active speaker.
        //   • isDisplayAvatar: true — self-tile shows an avatar placeholder
        //     when the camera is off, so the local user always sees their
        //     own slot in the gallery (otherwise Zoom hides camera-off
        //     participants by default).
        await client.init({
          zoomAppRoot: rootRef.current,
          language: "en-US",
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: {
              defaultViewType: "gallery",
              isDisplayAvatar: true,
            },
          },
        });

        await client.join({
          sdkKey,
          signature,
          meetingNumber: String(meetingNumber).replace(/\D/g, ""),
          password: (sigPassword ?? password ?? "") as string,
          userName,
          userEmail: userEmail ?? "",
          ...(role === 1 && zak ? { zak } : {}),
        });

        if (cancelled) return;
        joinedKeyRef.current = key;

        // Push wrapper dimensions to viewSizes so Zoom renders at the full
        // window size (not its internal gallery default). Re-push on window
        // resize so the canvas tracks the Electron window.
        //
        // ribbon.width = participant strip width during screen share. SDK
        // default is 316 → tiles end up ~150px wide for 2 participants.
        // 640 gives ~320px tiles so faces stay prominent while leaving
        // the rest of the viewport for the share canvas.
        const pushViewSizes = () => {
          const root = rootRef.current;
          const c = clientRef.current;
          if (!root || !c) return;
          const w = Math.max(720, root.clientWidth);
          const h = Math.max(411, root.clientHeight);
          try {
            c.updateVideoOptions?.({
              viewSizes: {
                default: { width: w, height: h },
                ribbon: { width: 640, height: h },
              },
            });
          } catch { /* ignore */ }
        };
        pushViewSizes();
        resizeHandler = () => {
          if (resizeTimer) window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(pushViewSizes, 150);
        };
        window.addEventListener("resize", resizeHandler);

        // Belt-and-braces gallery enforcement. Some SDK builds ignore
        // defaultViewType when only 1-2 participants are present and auto-
        // pick "active speaker" view, which hides the local self-tile.
        // Calling setViewType right after join overrides that.
        try {
          if (typeof client.setViewType === "function") {
            await client.setViewType("gallery");
          } else if (typeof client.switchVideoLayout === "function") {
            client.switchVideoLayout("gallery");
          }
        } catch { /* ignore — fallback to defaultViewType from init */ }

        setStatus("joined");
        onJoined?.();
      } catch (e: unknown) {
        if (cancelled) return;
        const err = e as { reason?: string; message?: string; errorCode?: number; type?: string };
        const baseReason = err?.reason ?? err?.message
          ?? (err?.errorCode != null ? `Zoom error ${err.errorCode}: ${err.type ?? "unknown"}` : "Couldn't join the meeting");
        const cleanNumber = String(meetingNumber).replace(/\D/g, "");
        const reason = `${baseReason} (meeting #${cleanNumber || "<empty>"})`;
        // eslint-disable-next-line no-console
        console.error("[ZoomCall] join failed:", baseReason, {
          meetingNumberRaw: meetingNumber,
          meetingNumberClean: cleanNumber,
          role,
          err: e,
        });
        setError(reason);
        setStatus("error");
        onError?.(reason);
      }
    })();

    return () => {
      cancelled = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (resizeTimer) window.clearTimeout(resizeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingNumber, role, userName]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const c = clientRef.current;
      clientRef.current = null;
      joinedKeyRef.current = null;
      if (c?.leaveMeeting) {
        try { void c.leaveMeeting(); } catch { /* ignore */ }
      }
      onLeave?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={rootRef} id="meetingSDKElement" className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-2 text-white">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-xs">Connecting to Zoom…</span>
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
          </div>
        </div>
      )}
    </div>
  );
}
