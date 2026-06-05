import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { AdminClient } from "./AdminClient";

export const metadata: Metadata = {
  title: "Admin — Relay.green",
};

// /admin is the platform-wide super_admin console. Enterprise + department
// admins have their own org-scoped surfaces and are bounced away.
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (!roles.includes(ROLE.super_admin)) {
    if (roles.includes(ROLE.enterprise_admin)) redirect("/enterprise");
    redirect("/supervise");
  }

  return <AdminClient />;
}
