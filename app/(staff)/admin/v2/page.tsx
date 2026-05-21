import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { PanelClient } from "./PanelClient";

export const metadata: Metadata = {
  title: "Superadmin Panel (v2) — Relay.green",
};

export default async function AdminV2Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes(ROLE.super_admin)) redirect("/admin");

  return (
    <Suspense fallback={null}>
      <PanelClient />
    </Suspense>
  );
}
