import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OperationsClient } from "./OperationsClient";

export const metadata: Metadata = {
  title: "Operations — Relay.green",
};

// /operations is the supervisor's team roster: every engineer in their
// pod with current customer + last call. Read-only, table format.
export default async function OperationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const allowed = roles.includes("pod_lead") || roles.includes("super_admin");
  if (!allowed) redirect("/supervise");

  return <OperationsClient />;
}
