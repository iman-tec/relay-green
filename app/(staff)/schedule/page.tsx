import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE } from "@/lib/relay/roles";
import { ScheduleClient } from "./ScheduleClient";

export const metadata: Metadata = {
  title: "Schedule — Relay.green",
};

export const dynamic = "force-dynamic";

// /schedule is the supervisor's appointment book — 30-minute calls customers
// booked off a bid (Contract management → "Ask for appointment"). Supervisor
// surface only; super admins manage from /supervise instead.
export default async function SchedulePage() {
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

  if (roles.includes(ROLE.super_admin) || !roles.includes(ROLE.supervisor)) {
    redirect("/supervise");
  }

  return <ScheduleClient />;
}
