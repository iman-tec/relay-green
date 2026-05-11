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

type ZoomClient = {
  init: (opts: unknown) => Promise<void>;
  join: (opts: unknown) => Promise<void>;
  leaveMeeting: () => Promise<void>;
  updateVideo?: (opts: unknown) => void;
};

type ZoomMtgEmbeddedNS = {
  createClient: () => ZoomClient;
};

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

  // Resize the canvas with the container
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current;
      const c = clientRef.current;
      if (!el || !c) return;
      const w = Math.max(320, Math.floor(el.clientWidth));
      const h = Math.max(240, Math.floor(el.clientHeight));
      try { c.updateVideo?.({ viewSizes: { default: { width: w, height: h } } }); }
      catch { /* SDK not ready */ }
    });
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

      // Tear down a previous client
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
        const client = ZoomMtgEmbedded.createClient();
        clientRef.current = client;

        const w = Math.max(320, Math.floor(wrapRef.current.clientWidth));
        const h = Math.max(240, Math.floor(wrapRef.current.clientHeight));

        await client.init({
          zoomAppRoot: rootRef.current,
          language: "en-US",
          patchJsMedia: true,
          customize: {
            video: { isResizable: true, viewSizes: { default: { width: w, height: h } } },
            toolbar: { buttons: [] },
            meetingInfo: ["topic", "host", "participant"],
          },
        });

        await client.join({
          sdkKey,
          signature,
          meetingNumber: String(meetingNumber).replace(/\D/g, ""),
          password: effectivePassword,
          userName,
          userEmail: userEmail ?? "",
          ...(role === 1 && zak ? { zak } : {}),
        });

        joinedKeyRef.current = key;
        clearTimeout(watchdog);
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
        if (!cancelled) {
          setError(reason);
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
        try { void c.leaveMeeting(); } catch { /* ignore */ }
      }
      onLeave?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full" style={{ backgroundColor: "#000" }}>
      <div ref={rootRef} className="absolute inset-0" />
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
            <p className="text-sm font-medium text-white">Couldn&apos;t connect</p>
            <p className="mt-1 text-xs text-white/60">{error}</p>
            {fallbackJoinUrl && (
              <a
                href={fallbackJoinUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black"
              >
                <ExternalLink size={12} /> Open in Zoom directly
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
