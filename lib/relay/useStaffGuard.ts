"use client";

/*
 * Client-side guard for engineer-only routes.
 *
 * If the user is not signed in, redirect to /staff.
 * If the user is signed in but has no staff role, redirect to /room.
 *
 * This is defence-in-depth — RPC functions and RLS policies are the
 * authoritative authorisation layer. This just shapes the UX so users
 * don't land on an engineer page that can't load any of its data.
 */

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { STAFF_ROLES, toRoles, type Role } from "@/lib/relay/roles";

export type StaffGuardState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "not-staff" }
  | { kind: "staff"; userId: string; roles: Role[] };

const STAFF_ROLE_SET: ReadonlySet<Role> = new Set(STAFF_ROLES);

export function useStaffGuard(): StaffGuardState {
  const [state, setState] = useState<StaffGuardState>({ kind: "loading" });
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = supabaseRef.current;
        const { data: u, error: authErr } = await sb.auth.getUser();
        if (cancelled) return;
        if (authErr) {
          // Network blip or token-refresh failure — don't kick the user
          // out, just leave them on a static page; a retry will recover.
          console.warn("[staff-guard] getUser error:", authErr.message);
          setState({ kind: "not-staff" });
          return;
        }
        if (!u.user) {
          setState({ kind: "anonymous" });
          if (typeof window !== "undefined") {
            window.location.replace("/staff");
          }
          return;
        }
        const { data: rolesData, error: rolesErr } = await sb
          .from("user_role_names")
          .select("role")
          .eq("user_id", u.user.id);
        if (cancelled) return;
        if (rolesErr) {
          // Network blip or RLS denial — treat as not-staff, the user can retry.
          console.warn("[staff-guard] roles query failed:", rolesErr.message);
          setState({ kind: "not-staff" });
          return;
        }
        const roles = toRoles(
          (rolesData ?? []).map((r: { role: string }) => r.role)
        );
        const isStaff = roles.some((r) => STAFF_ROLE_SET.has(r));
        if (!isStaff) {
          setState({ kind: "not-staff" });
          return;
        }
        setState({ kind: "staff", userId: u.user.id, roles });
      } catch (e) {
        // Swallow network errors (`TypeError: Failed to fetch` etc) — never
        // let this crash the page via an unhandled rejection.
        if (cancelled) return;
        console.warn(
          "[staff-guard] unhandled:",
          e instanceof Error ? e.message : String(e)
        );
        setState({ kind: "anonymous" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
