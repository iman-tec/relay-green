import type { Metadata } from "next";
import { SubHubPage } from "../_components/SubHubPage";

export const metadata: Metadata = {
  title: "Guides",
  description:
    "Practical, step-through references for buyers and builders. Plainspoken, executable.",
  alternates: { canonical: "/resources/guides" },
};

export default function GuidesIndexPage() {
  return <SubHubPage category="guides" />;
}
