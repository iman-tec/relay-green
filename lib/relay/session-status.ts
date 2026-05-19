/*
 * Shared session-status labels.
 *
 * Engineer session room, supervisor pit, and the customer room must all
 * call a session by the same name. Previously each surface had its own
 * mapping and the supervisor view rendered the raw enum ("queued" /
 * "assigned"), which made an active session look like "Pending" while
 * the engineer's view already said "Live" — bug #2 in bugs2.txt.
 */

import type { SessionStatus } from "@/lib/supabase/types";

export function humanState(s: SessionStatus): string {
  switch (s) {
    case "queued":       return "Connecting customer…";
    case "assigned":     return "Live";
    case "joining":      return "Joining call";
    case "live":         return "On call";
    case "grace":        return "Reconnecting";
    case "ending":       return "Wrapping up";
    case "ended":        return "Ended";
    case "abandoned":    return "Abandoned";
    case "cancelled":    return "Cancelled";
    case "expired_free": return "Free expired";
  }
}
