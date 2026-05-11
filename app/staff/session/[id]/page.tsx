import type { Metadata } from "next";
import { EngineerSessionClient } from "./EngineerSessionClient";

export const metadata: Metadata = {
  title: "Session — Relay.green",
};

// Intentionally no <EngineerShell> — a session room is a focused workspace.
// The engineer returns to /inbox (which carries the global nav) after they
// end the call.
export default async function EngineerSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EngineerSessionClient sessionId={id} />;
}
