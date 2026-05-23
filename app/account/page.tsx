import type { Metadata } from "next";
import { AccountClient } from "./AccountClient";

export const metadata: Metadata = {
  title: "Your profile — Relay.green",
  description: "Manage your name, interests, photo, and password.",
};

export default function AccountPage() {
  return <AccountClient />;
}
