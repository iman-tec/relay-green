import type { Metadata } from "next";
import { IntakeClient } from "./IntakeClient";

export const metadata: Metadata = {
  title: "Find an engineer — Relay.green",
};

export default function IntakePage() {
  return <IntakeClient />;
}
