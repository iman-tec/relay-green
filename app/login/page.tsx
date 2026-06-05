import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "./SignInForm";
import { CookieConsent } from "@/app/_marketing/CookieConsent";
import { Wordmark } from "@/app/_components/Wordmark";
import { createClient } from "@/lib/supabase/server";
import {
  isAllowedOnSurface,
  redirectForWrongSurface,
} from "@/lib/relay/loginSurface";

export const metadata: Metadata = {
  title: "Sign in, Relay.green",
  description: "Sign in to Relay.green.",
  alternates: { canonical: "/login" },
};

// Server-side bounce: an already-signed-in user that lands on /login is
// handled by their role. A `client` lands on /room. Staff / partner /
// business roles get bounced to THEIR sign-in surface so they can't
// accidentally consume the customer experience.
//
// `redirect()` throws a sentinel error that the framework catches, so the
// try/catch only wraps the Supabase calls — the actual redirect runs after.
// If Supabase isn't reachable (e.g. env not provisioned locally), we just
// render the form; the form's own submission surfaces the real error.
async function redirectIfSignedIn(): Promise<void> {
  let roles: string[];
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: roleRows } = await supabase
      .from("user_role_names")
      .select("role")
      .eq("user_id", user.id);
    roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  } catch {
    return;
  }
  // Customers on the customer surface → land directly.
  if (isAllowedOnSurface(roles, "customer")) {
    redirect("/room");
  }
  // Non-customer role hit the customer surface — bounce to their correct
  // surface with a notice. Doesn't affect the post-OTP role gate in the
  // API endpoint; this is just the pre-form check for already-signed-in
  // users.
  redirect(redirectForWrongSurface(roles));
}

export default async function LoginPage() {
  await redirectIfSignedIn();
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-[var(--background)] px-6 py-16">
      {/* Atmospheric top gradient — quiet, never noisy */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(ellipse at top, color-mix(in srgb, var(--primary) 8%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="no-underline">
            <Wordmark size="lg" />
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="font-serif text-2xl leading-tight font-medium text-[var(--text)]">
              Sign in to Relay
            </h1>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              Enter your email — we&apos;ll send you an 8-digit code.
            </p>
          </div>
        </div>

        <SignInForm />

        <div className="my-6 border-t border-[var(--border)]" />

        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xs text-[var(--text-muted)]">
            New to Relay?{" "}
            <Link
              href="/product"
              className="text-[var(--text)] underline-offset-2 hover:underline"
            >
              Learn how it works
            </Link>
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Need help?{" "}
            <a
              href="mailto:support@relay.green"
              className="text-[var(--text)] underline-offset-2 hover:underline"
            >
              support@relay.green
            </a>
          </p>
        </div>
      </div>

      <p className="relative z-10 mt-6 text-center text-xs text-[var(--text-muted)]">
        By signing in you agree to our{" "}
        <Link
          href="/legal/terms-consumer"
          className="text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
        >
          Terms
        </Link>{" "}
        and{" "}
        <Link
          href="/legal/privacy-policy"
          className="text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
        >
          Privacy Policy
        </Link>
        .
      </p>

      <CookieConsent />
    </main>
  );
}
