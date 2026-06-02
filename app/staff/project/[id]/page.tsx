import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectDetailClient } from "./ProjectDetailClient";

export const metadata: Metadata = {
  title: "Project — Relay.green",
};

// Standalone full-viewport workspace (no StaffShell) — its own 3-pane layout:
// left = customer + project + sessions, center = summary + docs + files,
// right = AI project assistant. Gated at the page level since it lives outside
// the (staff) layout group.
export default async function ProjectDetailPage({
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
  return <ProjectDetailClient projectId={id} />;
}
