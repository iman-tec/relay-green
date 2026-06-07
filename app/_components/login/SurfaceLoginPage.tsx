/*
 * Shared scaffold for the four role-gated login surfaces.
 *
 * Each surface (/login, /staff, /partner, /business) is a thin page.tsx
 * that calls into this component with a `surface` prop. The scaffold:
 *
 *   1. Server-checks the existing session. A signed-in user whose roles
 *      are admitted on THIS surface goes to their landing (landingForRoles).
 *      A signed-in user whose roles aren't admitted is bounced to the
 *      surface they SHOULD be using, with `?wrong_surface=1` so the
 *      destination page can render a notice.
 *
 *   2. Renders the surface chrome (title/blurb/footer) + the StaffLoginForm
 *      configured for this surface. The form passes the surface through
 *      to /api/auth/{signin-password,verify-otp}, which enforce the same
 *      role gate after a successful credential check (defence in depth).
 */

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/app/_components/Wordmark";
import { StaffLoginForm } from "@/app/staff/StaffLoginForm";
import { createClient } from "@/lib/supabase/server";
import { landingForRoles } from "@/lib/relay/role-labels";
import {
  isAllowedOnSurface,
  redirectForWrongSurface,
  type LoginSurface,
} from "@/lib/relay/loginSurface";

type SurfaceCopy = {
  title: string;
  blurb: string;
  /** Optional footer line, e.g. "Not invited yet? support@relay.green". */
  footer?: React.ReactNode;
};

type Props = {
  surface: LoginSurface;
  copy: SurfaceCopy;
  /** Dev-mode quick-pick is only shown on the /staff surface in development.
   *  Other surfaces get `devMode={false}` regardless of NODE_ENV. */
  showDevQuickPick?: boolean;
  /** If a customer just hit the /login surface and was bounced from /staff
   *  with ?wrong_surface=1, render a notice strip above the form. The
   *  query-param read happens client-side via the form's useSearchParams,
   *  but the notice itself is rendered server-side based on the prop. */
  wrongSurfaceNotice?: boolean;
  /** Optional right-side panel. When provided, the page renders as a split
   *  (form left, panel right on lg+); when absent, the centered-card layout is
   *  unchanged. Used by /partner for its salesy proof panel. */
  aside?: React.ReactNode;
};

async function bounceSignedInUser(surface: LoginSurface): Promise<void> {
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

  if (isAllowedOnSurface(roles, surface)) {
    // Already signed in AND admitted on this surface → straight to landing.
    redirect(surface === "customer" ? "/room" : landingForRoles(roles));
  }
  // Signed in but on the WRONG surface — sign them out so they can try
  // again on the correct one. Without the sign-out the proxy would just
  // pingpong them between login pages forever. (signOut here is best-
  // effort; the destination page also runs its own gate.)
  await supabase.auth.signOut({ scope: "global" }).catch(() => {});
  redirect(redirectForWrongSurface(roles));
}

export async function SurfaceLoginPage({
  surface,
  copy,
  showDevQuickPick = false,
  wrongSurfaceNotice = false,
  aside,
}: Props): Promise<React.ReactElement> {
  await bounceSignedInUser(surface);
  const devMode = showDevQuickPick && process.env.NODE_ENV === "development";

  const card = (
    <div
      className="w-full max-w-md rounded-2xl border p-8 shadow-sm"
      style={{
        backgroundColor: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      <div className="mb-7 flex flex-col items-center gap-3 text-center">
        <Link href="/" className="no-underline">
          <Wordmark size="lg" />
        </Link>
        <div className="flex flex-col gap-1.5">
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--text)" }}
          >
            {copy.title}
          </h1>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            {copy.blurb}
          </p>
        </div>
      </div>

      {wrongSurfaceNotice && (
        <div
          className="mb-5 rounded-md border px-4 py-3 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--warn) 7%, transparent)",
            color: "var(--text)",
          }}
        >
          That account doesn&apos;t belong to this sign-in page. We&apos;ve
          brought you here — sign in below.
        </div>
      )}

      <Suspense fallback={<div className="h-44" />}>
        <StaffLoginForm devMode={devMode} surface={surface} />
      </Suspense>

      {copy.footer && (
        <>
          <div
            className="my-6 border-t"
            style={{ borderColor: "var(--border)" }}
          />
          <div
            className="text-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {copy.footer}
          </div>
        </>
      )}
    </div>
  );

  // Split layout when a proof panel is supplied (e.g. /partner); otherwise the
  // unchanged centered card used by /login, /staff, /business.
  if (aside) {
    return (
      <main
        className="grid min-h-screen lg:grid-cols-2"
        style={{ backgroundColor: "var(--background)" }}
      >
        <div className="flex items-center justify-center px-6 py-16">
          {card}
        </div>
        <aside
          className="hidden flex-col justify-center gap-6 border-l px-[6vw] lg:flex"
          style={{
            backgroundColor: "var(--surface-raised)",
            borderColor: "var(--border)",
          }}
        >
          {aside}
        </aside>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16"
      style={{ backgroundColor: "var(--background)" }}
    >
      {card}
    </main>
  );
}
