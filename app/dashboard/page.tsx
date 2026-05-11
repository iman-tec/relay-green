import type { Metadata } from "next";
import { EngineerShell } from "@/app/_components/EngineerShell";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = {
  title: "Dashboard — Relay.green",
};

export default function DashboardPage() {
  return (
    <EngineerShell>
      <DashboardClient />
    </EngineerShell>
  );
}
