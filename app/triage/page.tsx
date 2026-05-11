import type { Metadata } from "next";
import { EngineerShell } from "@/app/_components/EngineerShell";
import { TriageClient } from "./TriageClient";

export const metadata: Metadata = {
  title: "Triage — Relay.green",
};

export default function TriagePage() {
  return (
    <EngineerShell>
      <TriageClient />
    </EngineerShell>
  );
}
