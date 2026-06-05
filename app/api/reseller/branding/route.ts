/*
 * Reseller white-label branding.
 *
 * GET /api/reseller/branding   → current branding (or defaults if no row).
 * PUT /api/reseller/branding   → upsert. Body is any subset of:
 *     { whiteLabelEnabled, accentColor, displayName, supportEmail }
 *
 * Logo upload is intentionally NOT in this iteration — that needs a
 * Supabase Storage bucket + signed URLs, deferred to a follow-up.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BrandingRow = {
  reseller_id: string;
  white_label_enabled: boolean;
  accent_color: string;
  display_name: string | null;
  support_email: string | null;
};

const DEFAULTS = {
  whiteLabelEnabled: false,
  accentColor: "#16a34a",
  displayName: null as string | null,
  supportEmail: null as string | null,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { data, error } = await admin
    .from("reseller_branding")
    .select("white_label_enabled, accent_color, display_name, support_email")
    .eq("reseller_id", resellerId)
    .maybeSingle<Omit<BrandingRow, "reseller_id">>();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    branding: data
      ? {
          whiteLabelEnabled: data.white_label_enabled,
          accentColor: data.accent_color,
          displayName: data.display_name,
          supportEmail: data.support_email,
        }
      : DEFAULTS,
  });
}

export async function PUT(request: Request) {
  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    whiteLabelEnabled?: boolean;
    accentColor?: string;
    displayName?: string | null;
    supportEmail?: string | null;
  };

  if (body.accentColor != null && !HEX_COLOR.test(body.accentColor)) {
    return NextResponse.json(
      { error: "invalid_accent_color" },
      { status: 400 }
    );
  }
  if (
    body.supportEmail != null &&
    body.supportEmail !== "" &&
    !EMAIL.test(body.supportEmail)
  ) {
    return NextResponse.json(
      { error: "invalid_support_email" },
      { status: 400 }
    );
  }

  const { data: existing } = await admin
    .from("reseller_branding")
    .select("white_label_enabled, accent_color, display_name, support_email")
    .eq("reseller_id", resellerId)
    .maybeSingle<Omit<BrandingRow, "reseller_id">>();

  const merged = {
    reseller_id: resellerId,
    white_label_enabled:
      body.whiteLabelEnabled ??
      existing?.white_label_enabled ??
      DEFAULTS.whiteLabelEnabled,
    accent_color:
      body.accentColor ?? existing?.accent_color ?? DEFAULTS.accentColor,
    display_name:
      body.displayName ?? existing?.display_name ?? DEFAULTS.displayName,
    support_email:
      body.supportEmail ?? existing?.support_email ?? DEFAULTS.supportEmail,
  };

  const { error } = await admin
    .from("reseller_branding")
    .upsert(merged, { onConflict: "reseller_id" });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    branding: {
      whiteLabelEnabled: merged.white_label_enabled,
      accentColor: merged.accent_color,
      displayName: merged.display_name,
      supportEmail: merged.support_email,
    },
  });
}
