import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { DepartmentsClient } from "./DepartmentsClient";

export const metadata: Metadata = {
  title: "Departments — Relay.green",
};

// Enterprise admin's department-management view. Department admins navigate
// to their own /department panel.
export default async function DepartmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (!roles.includes(ROLE.enterprise_admin) && !roles.includes(ROLE.super_admin)) {
    if (roles.includes(ROLE.department_admin)) redirect("/department");
    if (roles.includes(ROLE.reseller))         redirect("/reseller");
    if (roles.includes(ROLE.supervisor))       redirect("/supervise");
    if (roles.includes(ROLE.engineer))         redirect("/dashboard");
    redirect("/room");
  }

  return <DepartmentsClient />;
}
