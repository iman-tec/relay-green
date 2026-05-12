import type { Metadata } from "next";
import { CustomerWidgetClient } from "./CustomerWidgetClient";

export const metadata: Metadata = {
  title: "Relay Customer Widget",
};

export default function CustomerWidgetPage() {
  return <CustomerWidgetClient />;
}
