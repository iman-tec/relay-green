import type { Metadata } from "next";
import { SubHubPage } from "../_components/SubHubPage";

export const metadata: Metadata = {
  title: "Research",
  description:
    "What we learn from running the bench. Numbers, methods, and what they imply.",
  alternates: { canonical: "/resources/research" },
};

export default function ResearchIndexPage() {
  return <SubHubPage category="research" />;
}
