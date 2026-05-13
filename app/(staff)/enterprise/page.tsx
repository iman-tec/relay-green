import type { Metadata } from "next";
import { EnterpriseClient } from "./EnterpriseClient";

export const metadata: Metadata = {
  title: "Enterprise — Relay.green",
};

export default function EnterprisePage() {
  return <EnterpriseClient />;
}
