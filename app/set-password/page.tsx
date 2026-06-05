import type { Metadata } from "next";
import { Suspense } from "react";
import { SetPasswordClient } from "./SetPasswordClient";

// Auth-only route — never prerendered. SetPasswordClient initializes
// a Supabase browser client that requires NEXT_PUBLIC_SUPABASE_* at
// build time; force-dynamic moves the work to request time so the
// marketing-site build doesn't fail on Vercel previews without those.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set a password — Relay.green",
};

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <SetPasswordClient />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div
      className="flex min-h-screen items-center justify-center text-sm"
      style={{ color: "var(--text-muted)" }}
    >
      Loading…
    </div>
  );
}
