import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignmentsClient } from "./AssignmentsClient";

export const metadata: Metadata = {
  title: "Assignments — Relay.green",
};

// Super-admin only. Lets the platform admin assign engineers to a
// supervisor's pod via a checkbox matrix.
export default async function AssignmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("super_admin")) redirect("/supervise");

  return <AssignmentsClient />;
}
