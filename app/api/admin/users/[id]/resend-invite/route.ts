/*
 * POST /api/admin/users/:id/resend-invite
 *
 * Re-issues the magic-link invitation email for an existing user — useful
 * when the original got lost. Uses generateLink rather than the invite
 * call since the user already exists.
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;

  const { id } = await params;

  const { data: target, error: getErr } = await admin.auth.admin.getUserById(id);
  if (getErr || !target.user?.email) {
    return NextResponse.json(
      { error: getErr?.message ?? "User not found" },
      { status: 404 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  // generateLink with type=invite re-fires the invite email for an
  // existing-but-unconfirmed user. For confirmed users, type=magiclink
  // sends an ad-hoc sign-in link.
  const linkType = target.user.email_confirmed_at ? "magiclink" : "invite";
  const { error } = await admin.auth.admin.generateLink({
    type: linkType as "invite" | "magiclink",
    email: target.user.email,
    options: { redirectTo: `${appUrl}/auth/callback?next=/auth/post-signin` },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    `[admin/users] re-sent invite (${linkType}) to ${target.user.email}`,
  );

  return NextResponse.json({ resent: true });
}
