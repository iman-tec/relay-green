"use client";

/*
 * Some third-party SDKs (Zoom Web Meeting SDK in particular) call
 * `console.error` for non-fatal cleanup events. The Next.js dev overlay
 * unconditionally surfaces console.error calls as red panels, which buries
 * actual app errors in known SDK noise.
 *
 * We install ONE process-wide filter on first import: known-noise patterns
 * get downgraded to `console.warn` (which the dev overlay ignores). Real
 * errors and anything we don't recognise pass through unchanged.
 */

let installed = false;

const NOISE_PATTERNS: RegExp[] = [
  // Zoom SDK fires this when the meeting ends and the SDK aborts in-flight
  // telemetry/cleanup XHRs. status: 0 means the request was cancelled.
  /Request failed, status: 0/i,
  // Zoom SDK occasionally emits these benign warnings as errors.
  /jsMediaSDK_/i,
  /WCL_/i,
  /webrtc_data_message/i,
  // Chrome/Firefox surface these when the page navigates mid-fetch.
  /AbortError: The operation was aborted/i,
];

export function silenceSdkNoise(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const first = args[0];
      const text =
        typeof first === "string" ? first :
        first instanceof Error ? first.message :
        (first as { message?: string } | null)?.message ?? "";
      if (typeof text === "string" && NOISE_PATTERNS.some((p) => p.test(text))) {
        // Downgrade — still log it (so it's discoverable in DevTools) but
        // don't trip the Next overlay.
        console.warn("[silenced sdk noise]", ...args);
        return;
      }
    } catch { /* fall through to real console.error */ }
    orig(...args);
  };
}
