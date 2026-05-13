import type { Metadata } from "next";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = {
  title: "Dashboard — Relay.green",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
