import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { FinanceClient } from "./FinanceClient";

export const metadata: Metadata = {
  title: "Finance — Relay.green",
};

// /finance is the single-page money + feedback console for Enterprise +
// Department Admins. Super admin uses /admin; engineers don't see it.
export default async function FinancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const allowed = roles.includes(ROLE.enterprise_admin) || roles.includes(ROLE.department_admin);
  if (!allowed) {
    if (roles.includes(ROLE.super_admin)) redirect("/admin");
    redirect("/supervise");
  }

  return <FinanceClient />;
}
