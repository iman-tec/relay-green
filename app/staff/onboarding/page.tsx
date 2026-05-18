import type { Metadata } from "next";
import { EngineerOnboardingClient } from "./EngineerOnboardingClient";

export const metadata: Metadata = {
  title: "Engineer onboarding — Relay.green",
};

export default function EngineerOnboardingPage() {
  return <EngineerOnboardingClient />;
}
