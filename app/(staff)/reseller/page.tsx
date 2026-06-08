import { redirect } from "next/navigation";

// Legacy Channel Partner (reseller) console retired — the redesigned panel
// lives at /partner/v2 now (moved from /reseller/v2 to sit under the /partner
// surface). Keep this redirect so /reseller still lands on the portal.
export default function ResellerPage() {
  redirect("/partner/v2");
}
