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

type ZoomClient = {
  init: (opts: unknown) => Promise<void>;
  join: (opts: unknown) => Promise<void>;
  leaveMeeting: () => Promise<void>;
  updateVideo?: (opts: unknown) => void;
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
        const w = Math.max(320, Math.floor(wrapRef.current.clientWidth));
        const h = Math.max(240, Math.floor(wrapRef.current.clientHeight));

        const initOpts = {
          zoomAppRoot: rootRef.current,
          language: "en-US",
          patchJsMedia: true,
          customize: {
            video: { isResizable: true, viewSizes: { default: { width: w, height: h } } },
            toolbar: { buttons: [] },
            meetingInfo: ["topic", "host", "participant"],
          },
        };
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
        // session out, then inits and joins. Returns the client. Retryable
        // when Zoom throws errorCode 3000.
        const initAndJoin = async (): Promise<ZoomClient> => {
          const c = ZoomMtgEmbedded.createClient();
          // Defensive: if a prior page/mount left the SDK thinking a meeting
          // is in progress, this clears it. Errors are expected when there's
          // nothing to leave — swallow them.
          try { await c.leaveMeeting(); } catch { /* nothing to leave */ }
          await c.init(initOpts);
          await c.join(joinOpts);
          return c;
        };

        // Everything that touches the SDK goes through the module-level gate
        // so concurrent mounts (StrictMode double-invoke, fast route changes)
        // are serialised. The gate ensures init/join of mount #2 doesn't
        // start until mount #1's join/leave has fully resolved.
        //
        // Also retry transient network/connection errors (ERR_NETWORK_CHANGED
        // and friends) with exponential backoff — these surface as Zoom
        // errorCodes like -3000 / -2001 / -1001 and almost always succeed on
        // the second or third attempt when the network stabilises.
        const RETRY_DELAYS_MS = [600, 1500, 3500]; // 3 retries: ~0.6s, 1.5s, 3.5s
        let client: ZoomClient | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
          if (cancelled) return;
          try {
            client = await chainOnGate(initAndJoin);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            const code = (err as { errorCode?: number } | null)?.errorCode;
            // The positive 3000 ("Already has other meetings in progress")
            // case is handled by force-leave + immediate retry, no backoff.
            if (code === 3000) {
              await chainOnGate(async () => {
                try { await ZoomMtgEmbedded.createClient().leaveMeeting(); } catch { /* ignore */ }
                await new Promise((r) => setTimeout(r, 500));
              });
              continue;
            }
            // Transient network/connection errors: back off and retry.
            if (code != null && RETRYABLE_ZOOM_ERROR_CODES.has(code) && attempt < RETRY_DELAYS_MS.length) {
              await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
              continue;
            }
            // Anything else (or out of retries) → surface to the catch below.
            throw err;
          }
        }
        if (!client) throw lastErr;
        clientRef.current = client;

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
