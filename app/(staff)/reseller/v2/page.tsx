import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { PanelClient } from "./PanelClient";

export const metadata: Metadata = {
  title: "Reseller Panel (v2) — Relay.green",
};

// Mirror of /reseller/page.tsx. Auth gate, then mounts the redesigned
// drill-down panel (enterprise → department → employees) under the
// reseller role. Bare-mode render handled in StaffShell.
export default async function ResellerV2Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  if (!roles.includes(ROLE.reseller)) {
    if (roles.includes(ROLE.super_admin))      redirect("/admin/users");
    if (roles.includes(ROLE.enterprise_admin)) redirect("/enterprise");
    if (roles.includes(ROLE.department_admin)) redirect("/department");
    if (roles.includes(ROLE.supervisor))       redirect("/supervise");
    if (roles.includes(ROLE.engineer))         redirect("/dashboard");
    redirect("/room");
  }

  return (
    <Suspense fallback={null}>
      <PanelClient />
    </Suspense>
  );
}
