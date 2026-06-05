/*
 * Lightweight "am I an employee?" probe for the customer (/room) surface.
 *
 * GET /api/customer/me-employment
 *   Reads the caller's profile (cookie-bound, no service role needed for the
 *   read — RLS allows a user to read their own profile). When the user is
 *   an employee (client_type='employee'), joins to organizations + departments
 *   to label the info strip; otherwise returns isEmployee:false so the UI
 *   simply hides the strip.
 *
 *   Per spec, this surface MUST NOT reveal whether the enterprise is organic
 *   or inorganic — so reseller info is never returned here.
 *
 *   Output:
 *     { isEmployee: false }
 *   | { isEmployee: true,
 *       enterpriseName,
 *       departmentName,
 *       allocatedMinutes, usedMinutes, remainingMinutes }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, client_type, organization_id, department_id, allocated_minutes, used_minutes, remaining_minutes"
    )
    .eq("id", user.id)
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!profile) return NextResponse.json({ isEmployee: false });

  const p = profile as {
    id: string;
    client_type: string;
    organization_id: string | null;
    department_id: string | null;
    allocated_minutes: number;
    used_minutes: number;
    remaining_minutes: number;
  };

  if (p.client_type !== "employee" || !p.organization_id) {
    return NextResponse.json({ isEmployee: false });
  }

  // Look up enterprise + department names. RLS allows the user's own
  // organization + department through (existing policies in
  // 20260521130000_enterprise_hierarchy.sql).
  const [{ data: org }, { data: dept }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", p.organization_id)
      .maybeSingle(),
    p.department_id
      ? supabase
          .from("departments")
          .select("name")
          .eq("id", p.department_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    isEmployee: true,
    enterpriseName: (org as { name: string } | null)?.name ?? "",
    departmentName: (dept as { name: string } | null)?.name ?? null,
    allocatedMinutes: Number(p.allocated_minutes ?? 0),
    usedMinutes: Number(p.used_minutes ?? 0),
    remainingMinutes: Number(p.remaining_minutes ?? 0),
  });
}
