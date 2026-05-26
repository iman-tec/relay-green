import { redirect } from "next/navigation";

// Legacy departments console retired — redesigned panel lives at
// /enterprise/v2 (Departments tab).
export default function DepartmentsPage() {
  redirect("/enterprise/v2?tab=departments");
}
