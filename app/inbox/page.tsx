import type { Metadata } from "next";
import { EngineerShell } from "@/app/_components/EngineerShell";
import { InboxClient } from "./InboxClient";

export const metadata: Metadata = {
  title: "Inbox — Relay.green",
};

export default function InboxPage() {
  return (
    <EngineerShell>
      <InboxClient />
    </EngineerShell>
  );
}
