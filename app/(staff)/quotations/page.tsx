import type { Metadata } from "next";
import { QuotationsClient } from "./QuotationsClient";

export const metadata: Metadata = {
  title: "Quotation — Relay.green",
};

export default function QuotationsPage() {
  return <QuotationsClient />;
}
