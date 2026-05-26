/*
 * Device tracking client — enforces the 3-device sign-in cap.
 *
 * On staff-shell mount (post-auth), we:
 *   1. Read / generate a stable browser fingerprint (UUID in localStorage)
 *   2. Derive a friendly device label ("Chrome on macOS")
 *   3. Call the `register_my_device` RPC which upserts the row + returns
 *      the IDs of devices over the cap
 *   4. For each excess id, call `revoke_my_device` to sign that device out
 *
 * The cap is enforced server-side (`register_my_device` returns the list
 * of victims), but the revocations are explicit client calls. That way a
 * misbehaving / replayed RPC can't silently log a user out — every
 * revocation requires a deliberate second round-trip.
 */

import { createClient } from "@/lib/supabase/browser";

const FINGERPRINT_KEY = "relay.device.fingerprint.v1";

/** Stable per-browser UUID. Persisted in localStorage so it survives
 *  sign-out → sign-in cycles on the same browser. SSR returns "" — callers
 *  should not invoke this outside the browser. */
export function getOrCreateFingerprint(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(FINGERPRINT_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(FINGERPRINT_KEY, fresh);
    return fresh;
  } catch {
    // Private-mode / quota / disabled storage — fall back to a per-tab
    // ephemeral id. The user will appear as a fresh device each session,
    // which is acceptable degraded behaviour.
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Parse the UA string into a short "Browser on OS" label that's easier
 *  to scan than the raw UA. Best-effort — falls back to "Unknown device"
 *  if nothing recognisable matches. */
export function deriveDeviceLabel(ua: string): string {
  if (!ua) return "Unknown device";
  // Browser detection — order matters because UA strings often contain
  // multiple browser names ("Chrome/" appears in Edge UAs too).
  let browser = "Browser";
  if (/Edg\//.test(ua))            browser = "Edge";
  else if (/OPR\//.test(ua))       browser = "Opera";
  else if (/Firefox\//.test(ua))   browser = "Firefox";
  else if (/Chrome\//.test(ua))    browser = "Chrome";
  else if (/Safari\//.test(ua))    browser = "Safari";

  let os = "Device";
  if      (/Windows NT/.test(ua))                                                            os = "Windows";
  else if (/Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua))                                   os = "macOS";
  else if (/Android/.test(ua))                                                                os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua))                                                       os = "iOS";
  else if (/Linux/.test(ua))                                                                  os = "Linux";

  return `${browser} on ${os}`;
}

export type DeviceRegistrationResult = {
  device_id: string;
  over_limit: boolean;
  to_revoke: string[];
};

/** Calls register_my_device + auto-revokes any over-limit devices. Returns
 *  the registration result so callers can surface a "you were over the
 *  3-device cap" notice if they want.
 *
 *  Safe to call repeatedly — the RPC is idempotent (upserts on the
 *  fingerprint composite key). The revocation calls are also safe to
 *  retry; they're no-ops once the row is gone.
 *
 *  Errors are caught and logged — device tracking is best-effort
 *  infrastructure that should never block the user from using the app.
 */
export async function registerDeviceAndEnforceLimit(): Promise<DeviceRegistrationResult | null> {
  if (typeof window === "undefined") return null;
  try {
    const sb = createClient();
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return null;

    const fingerprint = getOrCreateFingerprint();
    if (!fingerprint) return null;

    const ua = window.navigator.userAgent || "";
    const label = deriveDeviceLabel(ua);

    const { data, error } = await sb.rpc("register_my_device", {
      _fingerprint: fingerprint,
      _device_label: label,
      _user_agent: ua,
    });
    if (error) {
      console.warn("[device] register failed:", error.message);
      return null;
    }

    // RPC returns JSONB shaped like DeviceRegistrationResult.
    const result = data as DeviceRegistrationResult | null;
    if (!result) return null;

    // Revoke any devices the server flagged as over-cap. We fire all in
    // parallel — they're independent per-device deletes.
    if (Array.isArray(result.to_revoke) && result.to_revoke.length > 0) {
      await Promise.all(result.to_revoke.map(async (deviceId) => {
        try {
          await sb.rpc("revoke_my_device", { _device_id: deviceId });
        } catch (e) {
          console.warn("[device] revoke failed:", e);
        }
      }));
    }

    return result;
  } catch (err) {
    // Network blip, RPC unavailable, etc. The user can still use the app —
    // device tracking just won't update this load.
    console.warn("[device] registration unavailable:", err);
    return null;
  }
}

/** Fetch the list of devices for the current user (newest first). Returns
 *  an empty array on any error so the UI can render gracefully. */
export type UserDevice = {
  id: string;
  device_fingerprint: string;
  device_label: string | null;
  user_agent: string | null;
  last_seen_at: string;
  created_at: string;
};

export async function listMyDevices(): Promise<UserDevice[]> {
  if (typeof window === "undefined") return [];
  try {
    const sb = createClient();
    const { data, error } = await sb.rpc("list_my_devices");
    if (error) {
      console.warn("[device] list failed:", error.message);
      return [];
    }
    return (data ?? []) as UserDevice[];
  } catch (err) {
    console.warn("[device] list unavailable:", err);
    return [];
  }
}

/** Revoke a single device by id. Returns true if the server confirmed,
 *  false on any failure. Caller is responsible for updating local state. */
export async function revokeDevice(deviceId: string): Promise<boolean> {
  try {
    const sb = createClient();
    const { error } = await sb.rpc("revoke_my_device", { _device_id: deviceId });
    if (error) {
      console.warn("[device] revoke failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[device] revoke unavailable:", err);
    return false;
  }
}
