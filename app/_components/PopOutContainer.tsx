"use client";

/*
 * Picture-in-Picture for the Zoom embed — canvas-capture + hidden-video bridge.
 *
 * Zoom Meeting SDK Component View renders the meeting (all participants
 * composited together) into a <canvas>. We can't move that canvas across
 * documents (the SDK trips its "Already has other meetings" guard) and we
 * can't drop it into a Document PiP window without it overflowing the small
 * viewport.
 *
 * Approach (per Zoom Web SDK PiP guidance):
 *   1. Keep the Zoom embed exactly where it is.
 *   2. As soon as Zoom's canvas exists, attach `canvas.captureStream(30)` to
 *      a hidden <video> "bridge" living off-screen in the main document.
 *      This pre-warm happens during render, not during click.
 *   3. On click, synchronously call `video.play()` + `video.requestPictureInPicture()`
 *      — both inside the user-gesture window. Web browsers refuse PiP
 *      otherwise; Electron also benefits from the tighter timing.
 *
 * Trade-offs:
 *   • One-way video; controls (mute/cam/end) stay in the main window.
 *   • Audio plays from the main window's Zoom client.
 *   • If Zoom uses WebGL without `preserveDrawingBuffer`, captureStream
 *     produces a black stream — surfaced as an error to the user.
 */

import { ReactNode, useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";

function findVideoCanvas(root: HTMLElement | null): HTMLCanvasElement | null {
  if (!root) return null;
  const canvases = Array.from(root.querySelectorAll("canvas")) as HTMLCanvasElement[];
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    const area = Math.max(r.width * r.height, c.width * c.height);
    if (area > bestArea) {
      bestArea = area;
      best = c;
    }
  }
  return best;
}

export function PopOutContainer({
  children,
}: {
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bridgeVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [pipActive, setPipActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [warmed, setWarmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSupported(
      typeof document !== "undefined" &&
        "pictureInPictureEnabled" in document &&
        document.pictureInPictureEnabled,
    );

    // Hidden <video> "bridge" lives off-screen in the main document. We
    // attach Zoom's canvas stream to it ahead of time so the click handler
    // can call `play()` + `requestPictureInPicture()` synchronously.
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.left = "-99999px";
    video.style.top = "-99999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    document.body.appendChild(video);
    bridgeVideoRef.current = video;

    const onLeavePip = () => setPipActive(false);
    const onEnterPip = () => setPipActive(true);
    video.addEventListener("leavepictureinpicture", onLeavePip);
    video.addEventListener("enterpictureinpicture", onEnterPip);

    // Poll for Zoom's canvas to appear, then attach captureStream. Once the
    // stream is attached we stop polling.
    const poll = setInterval(() => {
      if (streamRef.current || !wrapperRef.current) return;
      const canvas = findVideoCanvas(wrapperRef.current);
      if (!canvas) return;
      let stream: MediaStream;
      try {
        stream = canvas.captureStream(30);
      } catch {
        return;
      }
      if (stream.getVideoTracks().length === 0) return;
      streamRef.current = stream;
      video.srcObject = stream;
      // Try to play early — in web this may reject without a gesture and
      // we'll retry on click. In Electron the autoplay-policy switch makes
      // this succeed immediately.
      video.play().catch(() => {
        /* gesture required — handled on click */
      });
      setWarmed(true);
    }, 800);

    return () => {
      clearInterval(poll);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      try {
        if (document.pictureInPictureElement === video) {
          void document.exitPictureInPicture();
        }
      } catch {
        /* ignore */
      }
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }
      video.srcObject = null;
      video.remove();
      bridgeVideoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const popOut = async () => {
    setErr(null);
    const video = bridgeVideoRef.current;
    if (!video) return;

    // If we haven't warmed up yet, try one more time right now (still
    // synchronous within the user gesture).
    if (!streamRef.current && wrapperRef.current) {
      const canvas = findVideoCanvas(wrapperRef.current);
      if (canvas) {
        try {
          const stream = canvas.captureStream(30);
          if (stream.getVideoTracks().length > 0) {
            streamRef.current = stream;
            video.srcObject = stream;
          }
        } catch {
          /* fall through */
        }
      }
    }
    if (!streamRef.current) {
      setErr("Waiting for the meeting to render — try again once you see video.");
      return;
    }

    // Both calls inside the same user gesture. play() satisfies the
    // browser's autoplay policy; requestPictureInPicture inherits the gesture.
    try {
      await video.play();
    } catch (e) {
      const name = (e as { name?: string })?.name ?? "";
      // AbortError happens when srcObject swapped recently — harmless.
      // NotAllowedError means gesture wasn't passed through — rare.
      if (name !== "AbortError") {
        setErr("Browser blocked autoplay — click Pop out once more.");
        return;
      }
    }

    try {
      await video.requestPictureInPicture();
      setPipActive(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Pop-out failed";
      setErr(msg);
      // eslint-disable-next-line no-console
      console.error("[PopOut] requestPictureInPicture failed", e);
    }
  };

  const closePip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {
      /* ignore */
    }
    setPipActive(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (pipActive ? void closePip() : void popOut())}
        disabled={!supported}
        style={{ zIndex: 9999, pointerEvents: "auto" }}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[11px] font-medium text-white/95 backdrop-blur transition-colors hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-40"
        title={
          !supported
            ? "Picture-in-Picture not supported in this browser"
            : pipActive
              ? "Close the floating window"
              : warmed
                ? "Pop video into a floating window"
                : "Waiting for the meeting to render…"
        }
      >
        <Maximize2 size={11} />
        {pipActive ? "Close pop-out" : "Pop out"}
      </button>
      {err && (
        <div
          style={{ zIndex: 9999 }}
          className="absolute right-3 top-12 max-w-[260px] rounded-md bg-black/85 px-2 py-1 text-[10px] text-white/85"
        >
          {err}
        </div>
      )}
      <div ref={wrapperRef} style={{ width: "100%", height: "100%" }}>
        {children}
      </div>
    </>
  );
}
