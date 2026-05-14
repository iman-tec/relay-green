/*
 * Staff route-group layout.
 *
 * All authenticated staff surfaces — /admin, /admin/users, /supervise,
 * /dashboard, /inbox, /enterprise — live under app/(staff). The route
 * group means the URL paths stay the same
 * (no /staff prefix), but they share this layout. Crucially, navigating
 * between siblings (e.g. /admin → /supervise) no longer remounts the
 * shell — which is what made each click feel like a page reload.
 *
 * Auth check lives here, so individual pages don't need to repeat it.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StaffShell } from "@/app/_components/StaffShell";

export default async function StaffGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");

  return <StaffShell>{children}</StaffShell>;
}
