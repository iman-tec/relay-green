import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "./SignInForm";
import { CookieConsent } from "@/app/_marketing/CookieConsent";
import { Wordmark } from "@/app/_components/Wordmark";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";

export const metadata: Metadata = {
  title: "Sign in — Relay.green",
  description: "Sign in to Relay.green with a magic link. No password needed.",
};

// Server-side bounce: an already-signed-in user that lands on /login shouldn't
// see the form again — send them to wherever their highest role lives.
async function redirectIfSignedIn(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  redirect(landingForRoles(roles));
}

export default async function LoginPage() {
  await redirectIfSignedIn();
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16"
      style={{ backgroundColor: "var(--background)" }}
    >
      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl border p-8 shadow-sm"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        {/* Wordmark */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="no-underline">
            <Wordmark size="lg" />
          </Link>

          <div className="flex flex-col gap-1">
            <h1
              className="text-2xl font-medium"
              style={{
                fontFamily: "var(--font-source-serif)",
                color: "var(--text)",
              }}
            >
              Welcome back
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Sign in with your email  
            </p>
          </div>
        </div>

        {/* Form */}
        <SignInForm />

        {/* Divider */}
        <div
          className="my-6 border-t"
          style={{ borderColor: "var(--border)" }}
        />

        {/* Footer links */}
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            New to Relay?{" "}
            <Link
              href="/#try"
              className="underline-offset-3 hover:underline"
              style={{ color: "var(--text)" }}
            >
              Learn how it works
            </Link>
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Need help?{" "}
            <a
              href="mailto:support@relay.green"
              className="underline-offset-3 hover:underline"
              style={{ color: "var(--text)" }}
            >
              support@relay.green
            </a>
          </p>
        </div>
      </div>

      {/* Fine print */}
      <p className="mt-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
        By signing in you agree to our{" "}
        <Link href="/legal/terms" className="underline-offset-3 hover:underline" style={{ color: "var(--text-muted)" }}>
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="underline-offset-3 hover:underline" style={{ color: "var(--text-muted)" }}>
          Privacy Policy
        </Link>
        .
      </p>

      <CookieConsent />
    </main>
  );
}
