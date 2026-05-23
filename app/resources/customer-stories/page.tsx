import type { Metadata } from "next";
import { SubHubPage } from "../_components/SubHubPage";

export const metadata: Metadata = {
  title: "Customer stories",
  description:
    "How real teams use a press to ship things they otherwise wouldn’t have shipped.",
  alternates: { canonical: "/resources/customer-stories" },
};

export default function CustomerStoriesIndexPage() {
  return <SubHubPage category="customer-stories" />;
}
