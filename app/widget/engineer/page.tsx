import type { Metadata } from "next";
import { EngineerWidgetClient } from "./EngineerWidgetClient";

export const metadata: Metadata = {
  title: "Relay Engineer Widget",
};

export default function EngineerWidgetPage() {
  return <EngineerWidgetClient />;
}
