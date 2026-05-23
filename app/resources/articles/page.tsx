import type { Metadata } from "next";
import { SubHubPage } from "../_components/SubHubPage";

export const metadata: Metadata = {
  title: "Articles",
  description:
    "Essays, field notes, and industry pieces on the human layer behind AI-built software.",
  alternates: { canonical: "/resources/articles" },
};

export default function ArticlesIndexPage() {
  return <SubHubPage category="articles" />;
}
