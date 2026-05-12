/*
 * Relay.green public landing page.
 *
 * Renders the marketing surface for unauthenticated visitors. Signed-in
 * users are redirected to their role dashboard via the demo-auth helpers;
 * if the database is unavailable (DATABASE_URL unset, Postgres down) the
 * auth check fails soft and the marketing site still renders so previews
 * work without a backing DB.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, dashboardForRole } from "@/lib/auth";
import { MarketingHome } from "./_marketing/Home";

export const metadata: Metadata = {
  title: "Build with AI. Ship with engineers.",
  description:
    "Press once. A software engineer joins your AI build in seconds, and stays with you from build to shipped to running.",
  alternates: { canonical: "/" },
};

export default async function Home() {
  // Only attempt auth if a DB is configured. The try/catch wraps just the
  // DB-touching call so Next's `redirect()` (which throws NEXT_REDIRECT) is
  // never caught here.
  let user = null;
  if (process.env.DATABASE_URL) {
    try {
      user = await getSessionUser();
    } catch {
      user = null;
    }
  }
  if (user) redirect(dashboardForRole(user.role));

  return <MarketingHome />;
}
