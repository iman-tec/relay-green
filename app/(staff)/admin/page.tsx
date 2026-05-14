import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminClient } from "./AdminClient";

export const metadata: Metadata = {
  title: "Admin — Relay.green",
};

// /admin is the platform-wide super_admin console. Internal admins
// (ops_manager) and enterprise admins each have their own org-scoped
// surfaces and are bounced away from this route.
export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (!roles.includes("super_admin")) {
    if (roles.includes("enterprise_admin")) redirect("/enterprise");
    redirect("/supervise");
  }

  return <AdminClient />;
}
