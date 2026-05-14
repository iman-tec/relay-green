import { redirect } from "next/navigation";

// /enterprise/supervise was the original home for the org-scoped grid,
// but the route was unified into /supervise (which branches server-side
// on the caller's role). Keep this redirect so any bookmarked URL still
// works.
export default function EnterpriseSuperviseRedirect() {
  redirect("/supervise");
}
