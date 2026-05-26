import { redirect } from "next/navigation";

// Legacy enterprise console retired — the redesigned panel lives at
// /enterprise/v2. Redirect so old links + the StaffShell home land there.
export default function EnterprisePage() {
  redirect("/enterprise/v2");
}
