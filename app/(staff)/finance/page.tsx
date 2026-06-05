import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { FinanceClient } from "./FinanceClient";

export const metadata: Metadata = {
  title: "Finance — Relay.green",
};

// /finance is the org-level money + feedback console — enterprise_admin
// only. Department admins use the narrower /department view; super_admin
// uses /admin; engineers don't see it at all.
export default async function FinancePage() {
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

  if (!roles.includes(ROLE.enterprise_admin)) {
    if (roles.includes(ROLE.super_admin)) redirect("/admin");
    if (roles.includes(ROLE.department_admin)) redirect("/department");
    redirect("/supervise");
  }

  return <FinanceClient />;
}
