/**
 * Detect Chrome/Firefox network failures that aren't really bugs.
 *
 * `ERR_NETWORK_CHANGED`, sleep/wake, VPN toggles, ad-blockers, etc. show up
 * as `TypeError: Failed to fetch` (with no further detail). Surfacing these
 * as `console.error` triggers the Next dev overlay even though the next
 * realtime tick / page reload heals the connection on its own.
 *
 * Returns true for everything we should log-and-move-on, not show as a
 * crash-style red overlay.
 */
export function isTransientNetworkError(e: unknown): boolean {
  if (!e) return false;
  const msg =
    typeof e === "string" ? e :
    e instanceof Error ? e.message :
    (e as { message?: unknown }).message;
  if (typeof msg !== "string") return false;
  const m = msg.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("network changed") ||
    m.includes("err_network_changed") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||              // Safari equivalent
    m.includes("the operation was aborted") ||
    m.includes("net::err_") ||
    m === "abort" ||
    m === "aborted"
  );
}
