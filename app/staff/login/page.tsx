import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Wordmark } from "@/app/_components/Wordmark";
import { StaffLoginForm } from "./StaffLoginForm";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";

export const metadata: Metadata = {
  title: "Staff sign in — Relay.green",
  description: "Sign in to Relay.green. Enter your work email — we'll send an 8-digit code.",
};

// Server-side bounce: an already-signed-in staffer that lands on /staff/login
// shouldn't see the form again — send them to wherever their highest role
// lives (admin/enterprise/supervise/dashboard/room).
async function redirectIfSignedIn(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  redirect(landingForRoles(roles));
}

export default async function StaffLoginPage() {
  await redirectIfSignedIn();
  const devMode = process.env.NODE_ENV === "development";

  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-[var(--background)] px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(ellipse at top, color-mix(in srgb, var(--primary) 8%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="no-underline">
            <Wordmark size="lg" />
          </Link>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-serif text-2xl font-medium leading-tight text-[var(--text)]">
              Sign in to Relay
            </h1>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              The calm control room for live engineering support.
            </p>
          </div>
        </div>

        <Suspense fallback={<div className="h-44" />}>
          <StaffLoginForm devMode={devMode} />
        </Suspense>
      </div>
    </main>
  );
}
