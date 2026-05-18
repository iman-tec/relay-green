"use client";

/*
 * Force-onboard gate for the engineer skill profile.
 *
 * Anyone holding the `engineer` role must have a row in `engineer_profiles`.
 * If the row is missing, this hook redirects to `/staff/onboarding` so they
 * can complete the wizard before continuing.
 *
 * Pure supervisors (pod_lead / ops_manager / admin / super_admin without the
 * `engineer` role) are exempt — they monitor, they don't claim.
 *
 * Defence-in-depth: server side `match_engineer` skips engineers without a
 * profile anyway (the `is_available` JOIN comes back empty). The redirect is
 * UX glue.
 */

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function useRequireEngineerProfile() {
  const router = useRouter();
  const pathname = usePathname();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    // Never bounce off the onboarding page itself.
    if (pathname?.startsWith("/staff/onboarding")) return;
    let cancelled = false;
    void (async () => {
      const sb = supabaseRef.current;
      const { data: u } = await sb.auth.getUser();
      if (cancelled || !u.user) return;

      const { data: rolesData } = await sb
        .from("user_roles").select("role").eq("user_id", u.user.id);
      const roles = (rolesData ?? []).map((r) => r.role as string);
      const isEngineer = roles.includes("engineer");
      if (!isEngineer) return;

      const { data: profile } = await sb
        .from("engineer_profiles")
        .select("user_id")
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (cancelled) return;
      if (!profile) router.replace("/staff/onboarding");
    })();
    return () => { cancelled = true; };
  }, [router, pathname]);
}
