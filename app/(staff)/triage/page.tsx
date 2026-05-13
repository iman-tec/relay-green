import type { Metadata } from "next";
import { TriageClient } from "./TriageClient";

export const metadata: Metadata = {
  title: "Triage — Relay.green",
};

export default function TriagePage() {
  return <TriageClient />;
}
