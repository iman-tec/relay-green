import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { highestRoleLabel } from "@/lib/relay/role-labels";
import { PanelClient } from "./PanelClient";

export const metadata: Metadata = {
  title: "Enterprise (v2) — Relay.green",
};

export default async function EnterpriseV2Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/business");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  // Allow super_admin to preview the enterprise console as well — same
  // behavior as the legacy /enterprise routes.
  if (!roles.includes(ROLE.enterprise_admin) && !roles.includes(ROLE.super_admin)) {
    redirect("/dashboard");
  }

  return (
    <Suspense fallback={null}>
      <PanelClient me={{ email: user.email ?? "", roleLabel: highestRoleLabel(roles) }} />
    </Suspense>
  );
}
