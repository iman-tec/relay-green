import type { Metadata } from "next";
import { EngineerShell } from "@/app/_components/EngineerShell";
import { EnterpriseClient } from "./EnterpriseClient";

export const metadata: Metadata = {
  title: "Enterprise — Relay.green",
};

export default function EnterprisePage() {
  return (
    <EngineerShell>
      <EnterpriseClient />
    </EngineerShell>
  );
}
