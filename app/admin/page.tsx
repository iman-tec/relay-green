import type { Metadata } from "next";
import { EngineerShell } from "@/app/_components/EngineerShell";
import { AdminClient } from "./AdminClient";

export const metadata: Metadata = {
  title: "Admin — Relay.green",
};

export default function AdminPage() {
  return (
    <EngineerShell>
      <AdminClient />
    </EngineerShell>
  );
}
