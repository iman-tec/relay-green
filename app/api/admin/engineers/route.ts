/*
 * Super-admin bench — every engineer with their expertise axes, pod, presence,
 * and onboarding completeness. Powers the expertise matrix (F1) + onboarding
 * tracker (F4).
 *
 * GET /api/admin/engineers
 *   { engineers: [{ userId, name, email, pod, presenceState, isAvailable,
 *                   expertise[], technologies[], issues[], environments[],
 *                   experienceLevel, onboardingComplete, onboardingPct }] }
 *
 * super_admin only.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

// Intake axes aligned with the customer intake (post engineer-parity merge).
const AXES = ["project_types", "ai_tools", "backend_stacks", "frontend_stacks"] as const;

export async function GET() {
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

  // Engineers = holders of the engineer role.
  const { data: roleNames } = await admin.from("user_role_names").select("user_id, role").eq("role", ROLE.engineer);
  const engineerIds = [...new Set((roleNames ?? []).map((r: { user_id: string }) => r.user_id))];
  if (engineerIds.length === 0) return NextResponse.json({ engineers: [] });

  const [{ data: profs }, { data: eprofs }, { data: authList }, { data: podRows }, { data: pods }] = await Promise.all([
    admin.from("profiles").select("id, full_name, is_onboarded").in("id", engineerIds),
    admin.from("engineer_profiles").select("user_id, display_alias, project_types, ai_tools, backend_stacks, frontend_stacks, experience_level, presence_state, is_available").in("user_id", engineerIds),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("pod_members").select("user_id, pod_id").eq("pod_role", "engineer").in("user_id", engineerIds),
    admin.from("pods").select("id, name"),
  ]);

  const nameById = new Map<string, { full_name: string | null; is_onboarded: boolean | null }>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null; is_onboarded: boolean | null }[]) nameById.set(p.id, p);
  type EP = { user_id: string; display_alias: string | null; project_types: string[] | null; ai_tools: string[] | null; backend_stacks: string[] | null; frontend_stacks: string[] | null; experience_level: string | null; presence_state: string | null; is_available: boolean | null };
  const epById = new Map<string, EP>();
  for (const e of (eprofs ?? []) as EP[]) epById.set(e.user_id, e);
  const emailById = new Map<string, string>();
  for (const u of authList?.users ?? []) if (u.id && u.email) emailById.set(u.id, u.email);
  const podNameById = new Map<string, string>();
  for (const p of (pods ?? []) as { id: string; name: string }[]) podNameById.set(p.id, p.name);
  const podByUser = new Map<string, string>();
  for (const m of (podRows ?? []) as { user_id: string; pod_id: string }[]) podByUser.set(m.user_id, podNameById.get(m.pod_id) ?? "—");

  const engineers = engineerIds.map((id) => {
    const ep = epById.get(id);
    const prof = nameById.get(id);
    const axesFilled = AXES.filter((a) => Array.isArray(ep?.[a]) && (ep![a] as string[]).length > 0).length;
    const hasLevel = !!ep?.experience_level;
    // 6-step intake ≈ 4 expertise axes + experience level + onboarded flag.
    const steps = axesFilled + (hasLevel ? 1 : 0) + (prof?.is_onboarded ? 1 : 0);
    const onboardingPct = Math.round((steps / 6) * 100);
    return {
      userId: id,
      name: prof?.full_name ?? "Unnamed",
      email: emailById.get(id) ?? "",
      nickname: ep?.display_alias ?? null,   // customer-facing alias
      pod: podByUser.get(id) ?? "—",
      presenceState: ep?.presence_state ?? "offline",
      isAvailable: ep?.is_available ?? false,
      projectTypes: ep?.project_types ?? [],
      aiTools: ep?.ai_tools ?? [],
      backendStacks: ep?.backend_stacks ?? [],
      frontendStacks: ep?.frontend_stacks ?? [],
      experienceLevel: ep?.experience_level ?? null,
      onboardingComplete: onboardingPct >= 100,
      onboardingPct,
    };
  });
  engineers.sort((a, b) => a.name.localeCompare(b.name));

  const podList = ((pods ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name }));
  return NextResponse.json({ engineers, pods: podList });
}
