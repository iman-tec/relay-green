"use client";

/*
 * Silence known-noisy Zoom Video SDK console.error spam in dev.
 * Mirrors lib/relay/silenceSdkNoise.ts but tuned for @zoom/videosdk's logs.
 * The SDK emits a handful of non-fatal "WCL_/jsMediaSDK_/CallTrace" lines
 * during normal lifecycle — we downgrade those to console.warn so the
 * Next.js dev overlay doesn't surface them as errors.
 */

const NOISY = [
  /jsMediaSDK_/i,
  /WCL_/i,
  /CallTrace/i,
  /webrtc_data_message/i,
  /\[ZoomVideo\] non-fatal/i,
  /AbortError: The play\(\) request was interrupted/i,
  /Error: Request failed, status: 0/i,
];

let installed = false;
export function silenceVideoSdkNoise(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const orig = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (NOISY.some((re) => re.test(text))) {
      console.warn("[zoom-video silenced]", ...args);
      return;
    }
    orig(...args);
  };
}
