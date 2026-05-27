import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EngineerSessionClient } from "./EngineerSessionClient";

export const metadata: Metadata = {
  title: "Session — Relay.green",
};

// Intentionally no StaffShell — a session room is a focused workspace.
// The engineer returns to /inbox (the post-call landing screen with
// recent calls + take-next) after they end. We still gate the route at
// the page level since it lives outside the (staff) layout.
export default async function EngineerSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff");

  const { id } = await params;
  return <EngineerSessionClient sessionId={id} />;
}
