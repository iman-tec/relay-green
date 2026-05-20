import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { DepartmentClient } from "./DepartmentClient";

export const metadata: Metadata = {
  title: "Department — Relay.green",
};

// Department admin's home — dashboard + employees module.
// Other roles bounce to their own home.
export default async function DepartmentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (!roles.includes(ROLE.department_admin)) {
    if (roles.includes(ROLE.super_admin))      redirect("/admin/users");
    if (roles.includes(ROLE.reseller))         redirect("/reseller");
    if (roles.includes(ROLE.enterprise_admin)) redirect("/enterprise");
    if (roles.includes(ROLE.supervisor))       redirect("/supervise");
    if (roles.includes(ROLE.engineer))         redirect("/dashboard");
    redirect("/room");
  }

  return <DepartmentClient />;
}
