import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CallClient } from "./CallClient";

export const metadata: Metadata = {
  title: "Call — Relay.green",
};

/**
 * Dedicated call route — renders only the Zoom embed full-viewport, no
 * sidebar, no chat, no Relay chrome around it. Both customer (/room) and
 * engineer (/staff/session/[id]) navigate here when a call goes live, and
 * navigate back when the call ends.
 *
 * We gate on auth at the server boundary, but everything else (session
 * fetch, role detection, Zoom join) happens in the client component which
 * decides which session hook to wire up based on the viewer's role.
 */
export default async function CallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  return <CallClient sessionId={id} />;
}
