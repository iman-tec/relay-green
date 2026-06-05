/*
 * Dev-only diagnostic for the "no engineer is online" customer notification.
 *
 * GET /api/dev/why-no-match?customer_email=foo@bar.com
 *   or  /api/dev/why-no-match?intake_id=<uuid>
 *   or  /api/dev/why-no-match                          (uses most recent intake)
 *
 * Runs the same filter chain match_engineer() applies and reports, for every
 * engineer in user_roles, whether they would be matched and — if not — which
 * specific filter knocked them out. Surfaces the actual is_available /
 * presence_state / heartbeat values so drift between them is obvious.
 *
 * Service-role read; hard-disabled in production via NODE_ENV.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIVE_SESSION_STATES = [
  "assigned",
  "joining",
  "live",
  "grace",
  "expired_free",
  "ending",
];

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "dev_only" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "supabase_unconfigured" },
      { status: 500 }
    );
  }
  const sb = createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const url = new URL(req.url);
  const intakeIdParam = url.searchParams.get("intake_id");
  const customerEmail = url.searchParams.get("customer_email");

  type IntakeRow = {
    id: string;
    customer_user_id: string | null;
    guest_call_id: string | null;
    technologies: string[] | null;
    issues: string[] | null;
    environments: string[] | null;
    declined_by: string[] | null;
  };

  // Resolve the intake we're diagnosing.
  let intake: IntakeRow | null = null;

  if (intakeIdParam) {
    const { data } = await sb
      .from("client_intakes")
      .select(
        "id, customer_user_id, guest_call_id, technologies, issues, environments, declined_by"
      )
      .eq("id", intakeIdParam)
      .maybeSingle();
    intake = (data as IntakeRow | null) ?? null;
  } else if (customerEmail) {
    const { data: userRow } = await sb
      .from("profiles")
      .select("id")
      .eq("email", customerEmail)
      .maybeSingle();
    const customerUid = (userRow as { id?: string } | null)?.id ?? null;
    if (customerUid) {
      const { data } = await sb
        .from("client_intakes")
        .select(
          "id, customer_user_id, guest_call_id, technologies, issues, environments, declined_by"
        )
        .eq("customer_user_id", customerUid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      intake = (data as IntakeRow | null) ?? null;
    }
  } else {
    const { data } = await sb
      .from("client_intakes")
      .select(
        "id, customer_user_id, guest_call_id, technologies, issues, environments, declined_by"
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    intake = (data as IntakeRow | null) ?? null;
  }

  if (!intake) {
    return NextResponse.json(
      {
        error: "no_intake_found",
        hint: "Pass ?intake_id=<uuid> or ?customer_email=...",
      },
      { status: 404 }
    );
  }

  // Pull every engineer-role user via the same view the matcher uses.
  // user_roles is (user_id, role_id) → roles(name); user_role_names is the
  // view that joins those into (user_id, role).
  const { data: engineerRoles, error: rolesErr } = await sb
    .from("user_role_names")
    .select("user_id")
    .eq("role", "engineer");
  if (rolesErr) {
    return NextResponse.json(
      {
        error: "user_role_names_query_failed",
        detail: rolesErr.message,
      },
      { status: 500 }
    );
  }
  const engineerIds = Array.from(
    new Set(
      ((engineerRoles ?? []) as { user_id: string }[]).map((r) => r.user_id)
    )
  );

  if (engineerIds.length === 0) {
    return NextResponse.json({
      intake_id: intake.id,
      guest_call_id: intake.guest_call_id,
      total_engineers_in_user_role_names: 0,
      diagnosis:
        "Zero rows in user_role_names with role='engineer'. The matcher's first filter excludes everyone. Check the roles lookup table + user_roles assignments.",
      engineers: [],
    });
  }

  // Hydrate the per-engineer data the matcher reads.
  const [
    profilesRes,
    presenceRes,
    identitiesRes,
    activeSessionsRes,
    offersRes,
  ] = await Promise.all([
    sb
      .from("engineer_profiles")
      .select(
        "user_id, is_available, presence_state, technologies, issues, environments, experience_level"
      )
      .in("user_id", engineerIds),
    sb
      .from("engineer_presence")
      .select("engineer_id, last_seen_at, focused")
      .in("engineer_id", engineerIds),
    sb.from("profiles").select("id, email, full_name").in("id", engineerIds),
    sb
      .from("guest_calls")
      .select("id, claimed_by, status")
      .in("claimed_by", engineerIds)
      .in("status", ACTIVE_SESSION_STATES),
    intake.guest_call_id
      ? sb
          .from("engineer_match_offers")
          .select("engineer_user_id")
          .eq("intake_id", intake.id)
          .eq("guest_call_id", intake.guest_call_id)
      : Promise.resolve({ data: [] as { engineer_user_id: string }[] }),
  ]);

  const profilesById = new Map(
    ((profilesRes.data ?? []) as any[]).map((p) => [p.user_id, p])
  );
  const presenceById = new Map(
    ((presenceRes.data ?? []) as any[]).map((p) => [p.engineer_id, p])
  );
  const identityById = new Map(
    ((identitiesRes.data ?? []) as any[]).map((p) => [p.id, p])
  );
  const inActiveSessionByEngineer = new Map<
    string,
    { id: string; status: string }
  >();
  for (const row of (activeSessionsRes.data ?? []) as {
    id: string;
    claimed_by: string;
    status: string;
  }[]) {
    inActiveSessionByEngineer.set(row.claimed_by, {
      id: row.id,
      status: row.status,
    });
  }
  const alreadyOfferedIds = new Set(
    ((offersRes.data ?? []) as { engineer_user_id: string }[]).map(
      (r) => r.engineer_user_id
    )
  );

  const declinedBy = new Set((intake.declined_by ?? []) as string[]);
  const customerUid = intake.customer_user_id ?? null;

  const nowMs = Date.now();
  const isHot = (last: string | null, focused: boolean | null): boolean => {
    if (!last) return false;
    const ageMs = nowMs - new Date(last).getTime();
    return ageMs < 30_000 && focused === true;
  };

  const engineers = engineerIds.map((uid) => {
    const profile = profilesById.get(uid) ?? null;
    const presence = presenceById.get(uid) ?? null;
    const identity = identityById.get(uid) ?? null;
    const activeSession = inActiveSessionByEngineer.get(uid) ?? null;
    const alreadyOffered = alreadyOfferedIds.has(uid);

    // Apply matcher filters in the same order as match_engineer.
    let exclusion_reason: string | null = null;
    if (customerUid && uid === customerUid) {
      exclusion_reason = "is the customer";
    } else if (profile && profile.is_available === false) {
      exclusion_reason = `engineer_profiles.is_available = false (presence_state = ${profile.presence_state ?? "null"})`;
    } else if (declinedBy.has(uid)) {
      exclusion_reason = "in intake.declined_by";
    } else if (activeSession) {
      exclusion_reason = `already in active session ${activeSession.id} (status=${activeSession.status})`;
    } else if (alreadyOffered) {
      exclusion_reason = "already has an offer row for this intake";
    }

    return {
      user_id: uid,
      email: identity?.email ?? null,
      full_name: identity?.full_name ?? null,
      would_match: exclusion_reason === null,
      exclusion_reason,
      profile: profile
        ? {
            is_available: profile.is_available,
            presence_state: profile.presence_state,
            experience_level: profile.experience_level,
            technologies: profile.technologies,
          }
        : { missing: true },
      presence: presence
        ? {
            last_seen_at: presence.last_seen_at,
            focused: presence.focused,
            age_seconds: presence.last_seen_at
              ? Math.round(
                  (nowMs - new Date(presence.last_seen_at).getTime()) / 1000
                )
              : null,
            is_hot: isHot(presence.last_seen_at, presence.focused),
          }
        : { missing: true },
      in_active_session: activeSession,
      already_offered: alreadyOffered,
    };
  });

  const wouldMatchCount = engineers.filter((e) => e.would_match).length;
  const summary =
    wouldMatchCount === 0
      ? `ZERO engineers would be matched. Most common reason: is_available=false on engineer_profiles (check the "exclusion_reason" field per engineer).`
      : `${wouldMatchCount} engineer(s) would be matched. If the customer is still seeing 'no engineers', re-check intake.guest_call_id and the matcher RPC permissions.`;

  return NextResponse.json(
    {
      intake_id: intake.id,
      guest_call_id: intake.guest_call_id,
      customer_user_id: customerUid,
      intake_signals: {
        technologies: intake.technologies,
        issues: intake.issues,
        environments: intake.environments,
        declined_by: intake.declined_by,
      },
      total_engineers_in_user_role_names: engineerIds.length,
      would_match_count: wouldMatchCount,
      summary,
      engineers,
    },
    { status: 200 }
  );
}
