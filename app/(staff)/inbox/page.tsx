import type { Metadata } from "next";
import { InboxClient } from "./InboxClient";

export const metadata: Metadata = {
  title: "Inbox — Relay.green",
};

export default function InboxPage() {
  return <InboxClient />;
}
