import type { Metadata } from "next";
import { AccountClient } from "./AccountClient";

// Auth-only route — never prerendered. AccountClient initializes a
// Supabase browser client at module level, which throws if
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY aren't set
// at build time (e.g. on a Vercel preview deploy that hasn't had those
// vars wired yet). force-dynamic moves the work to request time so a
// missing build-env doesn't break the public marketing site's build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your profile — Relay.green",
  description: "Manage your name, interests, photo, and password.",
};

export default function AccountPage() {
  return <AccountClient />;
}
