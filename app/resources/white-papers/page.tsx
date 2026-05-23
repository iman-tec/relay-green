import type { Metadata } from "next";
import { SubHubPage } from "../_components/SubHubPage";

export const metadata: Metadata = {
  title: "White papers",
  description:
    "Long-form work for the people deciding whether AI-built software is allowed to ship.",
  alternates: { canonical: "/resources/white-papers" },
};

export default function WhitePapersIndexPage() {
  return <SubHubPage category="white-papers" />;
}
