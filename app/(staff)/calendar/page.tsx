import type { Metadata } from "next";
import { CalendarPageClient } from "./CalendarPageClient";

export const metadata: Metadata = {
  title: "Calendar — Relay.green",
};

export const dynamic = "force-dynamic";

/*
 * Engineer Calendar — top-level destination from the StaffShell sidebar.
 * Was previously buried as a tab inside the Profile pane; moved out so
 * engineers can reach it in one click. The actual UI is the same
 * CalendarTab component used inside the Profile pane before — re-mounted
 * as a standalone page via CalendarPageClient.
 */
export default function CalendarPage() {
  return <CalendarPageClient />;
}
