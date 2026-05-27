/*
 * Back-compat redirect.
 *
 * The staff sign-in surface moved from /staff/login to /staff as part of
 * the four-surface auth split. Any saved bookmarks or older invite emails
 * still pointing at /staff/login (or its query-param variants like
 * /staff/login?invite=...) should land on the new URL with their params
 * preserved.
 */

import { redirect } from "next/navigation";

export default async function StaffLoginLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0]);
  }
  const tail = qs.toString();
  redirect(tail ? `/staff?${tail}` : "/staff");
}
