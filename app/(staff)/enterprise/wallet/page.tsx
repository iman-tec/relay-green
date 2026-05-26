import { redirect } from "next/navigation";

// Legacy wallet console retired — billing lives in the redesigned panel at
// /enterprise/v2 (Billing tab).
export default function WalletPage() {
  redirect("/enterprise/v2?tab=billing");
}
