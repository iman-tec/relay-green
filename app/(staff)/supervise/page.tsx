import type { Metadata } from "next";
import { SuperviseClient } from "./SuperviseClient";

export const metadata: Metadata = {
  title: "Supervise — Relay.green",
};

export default function SupervisePage() {
  return <SuperviseClient />;
}
