import { redirect } from "next/navigation";

// Legacy Channel Partner (reseller) console retired — the redesigned panel
// lives at /reseller/v2 (which role-gates + scopes to the partner's own
// enterprises). Route segment stays `reseller` internally.
export default function ResellerPage() {
  redirect("/reseller/v2");
}
