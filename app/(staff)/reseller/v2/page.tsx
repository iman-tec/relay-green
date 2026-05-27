import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { highestRoleLabel, landingForRoles } from "@/lib/relay/role-labels";
import { PanelClient } from "./PanelClient";

export const metadata: Metadata = {
  title: "Channel Partner Panel (v2) — Relay.green",
};

// Mirror of /reseller/page.tsx. Auth gate, then mounts the redesigned
// drill-down panel (enterprise → department → employees) under the
// reseller role. Bare-mode render handled in StaffShell.
export default async function ResellerV2Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/partner");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (!roles.includes(ROLE.reseller)) {
    // Send them to whatever surface their actual role lands on. Centralised
    // in landingForRoles so we don't need to re-encode the v2 cutover here.
    redirect(landingForRoles(roles));
  }

  return (
    <Suspense fallback={null}>
      <PanelClient me={{ email: user.email ?? "", roleLabel: highestRoleLabel(roles) }} />
    </Suspense>
  );
}
