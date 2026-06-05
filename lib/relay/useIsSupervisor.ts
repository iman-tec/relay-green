"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestMessage } from "@/lib/supabase/types";
import { ROLE, type Role } from "@/lib/relay/roles";

// Roles allowed to see supervisor-tagged chat lines (e.g. Zoom recording
// URL + passcode). Mirrors the gate in zoom-webhook handleRecordingCompleted
// and the visibility CHECK on guest_messages.visibility.
const SUPERVISOR_ROLES: ReadonlySet<Role> = new Set([
  ROLE.supervisor,
  ROLE.super_admin,
]);

/**
 * True when this message should only render for supervisor viewers — either
 * because it was explicitly tagged (visibility='supervisor') or because its
 * body matches the recording-share pattern that predates the visibility
 * column. The body fallback lets us hide pre-migration rows without waiting
 * on the backfill to land.
 */
export function isSupervisorOnlyMessage(m: GuestMessage): boolean {
  if (m.visibility === "supervisor") return true;
  if (
    m.sender_kind === "system" &&
    (m.body ?? "").includes("Recording available")
  )
    return true;
  return false;
}

/**
 * Returns true once we've confirmed the signed-in user holds a supervisor
 * role. Returns false during loading and for everyone else — callers should
 * default to "hide" while we don't yet know.
 */
export function useIsSupervisor(): boolean {
  const [isSupervisor, setIsSupervisor] = useState(false);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = supabaseRef.current;
      const { data: u } = await sb.auth.getUser();
      if (cancelled || !u.user) return;
      const { data } = await sb
        .from("user_role_names")
        .select("role")
        .eq("user_id", u.user.id);
      if (cancelled) return;
      const roles = (data ?? []).map((r: { role: string }) => r.role);
      setIsSupervisor(
        roles.some((r) => (SUPERVISOR_ROLES as ReadonlySet<string>).has(r))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return isSupervisor;
}
