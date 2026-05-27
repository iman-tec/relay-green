/*
 * Super-admin engineer profile edit (F2).
 *
 * PATCH /api/admin/engineers/:id
 *   Body: { expertise?, technologies?, issues?, environments?: string[],
 *           experienceLevel?: string|null, isAvailable?: boolean }
 *   Updates the engineer's expertise axes + on/off-duty flag. super_admin only.
 *
 * Writes go through this gated service-role endpoint (the codebase's pattern),
 * so engineer_profiles RLS stays "engineer writes own" without opening a
 * broad super-admin write policy.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ARRAY_FIELDS = ["project_types", "ai_tools", "backend_stacks", "frontend_stacks"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data: roleRows } = await supabase.from("user_role_names").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes(ROLE.super_admin)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ARRAY_FIELDS) {
    if (Array.isArray(body[f])) patch[f] = (body[f] as unknown[]).map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof body.experienceLevel === "string" || body.experienceLevel === null) patch.experience_level = body.experienceLevel;
  if (typeof body.isAvailable === "boolean") {
    patch.is_available = body.isAvailable;
    patch.presence_state = body.isAvailable ? "online" : "offline";
  }

  const { error } = await admin.from("engineer_profiles").update(patch).eq("user_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
