import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { highestRoleLabel } from "@/lib/relay/role-labels";
import { PanelClient } from "./PanelClient";

export const metadata: Metadata = {
  title: "Department (v2) — Relay.green",
};

export default async function DepartmentV2Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  // Allow super_admin + enterprise_admin to preview the dept console too
  // (mirrors the legacy /department behavior).
  const allowed =
    roles.includes(ROLE.department_admin) ||
    roles.includes(ROLE.enterprise_admin) ||
    roles.includes(ROLE.super_admin);
  if (!allowed) redirect("/dashboard");

  return (
    <Suspense fallback={null}>
      <PanelClient me={{ email: user.email ?? "", roleLabel: highestRoleLabel(roles) }} />
    </Suspense>
  );
}
