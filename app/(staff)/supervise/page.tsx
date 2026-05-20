import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { SuperviseClient } from "./SuperviseClient";
import { EnterpriseSuperviseClient } from "@/app/(staff)/enterprise/supervise/EnterpriseSuperviseClient";

export const metadata: Metadata = {
  title: "Supervise — Relay.green",
};

// /supervise is shared between two audiences:
//   - super_admin / supervisor                     → platform-wide grid
//   - enterprise_admin / department_admin          → their own org's scoped grid
// We branch server-side so the URL stays the same regardless of identity.
export default async function SupervisePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const isSuperAdmin = roles.includes(ROLE.super_admin);
  const isOrgAdmin   = roles.includes(ROLE.enterprise_admin) || roles.includes(ROLE.department_admin);
  if (!isSuperAdmin && isOrgAdmin) {
    return <EnterpriseSuperviseClient />;
  }
  return <SuperviseClient />;
}
