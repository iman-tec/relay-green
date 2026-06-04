import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { BidsWorkspace } from "./BidsWorkspace";

export const metadata: Metadata = {
  title: "Bids — Relay.green",
};

// /bids is the pod supervisor's estimation-request / bid queue (the former
// "Act now" rail beside /supervise) plus a persistent project-history AI panel
// on the right. Supervisor-only; other staff are bounced to /supervise.
export default async function BidsPage() {
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
  if (!roles.includes(ROLE.supervisor)) redirect("/supervise");

  return <BidsWorkspace />;
}
