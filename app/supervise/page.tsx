import type { Metadata } from "next";
import { EngineerShell } from "@/app/_components/EngineerShell";
import { SuperviseClient } from "./SuperviseClient";

export const metadata: Metadata = {
  title: "Supervise — Relay.green",
};

export default function SupervisePage() {
  return (
    <EngineerShell>
      <SuperviseClient />
    </EngineerShell>
  );
}
