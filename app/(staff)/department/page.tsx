import { redirect } from "next/navigation";

// Legacy department console retired — the redesigned panel lives at
// /department/v2 (which role-gates + scopes to the caller's department).
export default function DepartmentPage() {
  redirect("/department/v2");
}
