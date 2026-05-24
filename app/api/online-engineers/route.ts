/*
 * GET /api/online-engineers?technologies=Claude,Postgres&need=stuck
 *
 * Returns a single best-match engineer currently available (is_available=true
 * AND not in an active session). The customer-facing Try-RELAY funnel calls
 * this to render the "Match Found" card with a real, live engineer + their
 * pseudonym (first name + last initial).
 *
 * Service-role read — engineer rows on profiles/engineer_profiles are not
 * publicly readable under our RLS. The route returns only a sanitized
 * pseudonym + tech tags; never the engineer's full name or email.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

type EngineerRow = {
  user_id: string;
  technologies: string[] | null;
  experience_level: "Beginner" | "Intermediate" | "Experienced" | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

function experienceYears(level: EngineerRow["experience_level"]): number {
  if (level === "Experienced") return 8;
  if (level === "Intermediate") return 4;
  return 2;
}

function pseudonymize(fullName: string | null, fallback: string): {
  pseudoName: string;
  initials: string;
} {
  const raw = (fullName ?? "").trim();
  if (!raw) {
    return { pseudoName: "Engineer", initials: fallback.slice(0, 2).toUpperCase() };
  }
  const parts = raw.split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1][0]}.` : "";
  const pseudoName = lastInitial ? `${first} ${lastInitial}` : first;
  const initials = parts.length > 1
    ? `${first[0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : first.slice(0, 2).toUpperCase();
  return { pseudoName, initials };
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { engineer: null, error: "supabase_unconfigured" },
      { status: 200 },
    );
  }

  const url = new URL(req.url);
  const techParam = url.searchParams.get("technologies") ?? "";
  const requested = techParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  const sb = createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Pool of available engineers. The `match_engineer` RPC requires an
  // intake_id (full funnel pipeline); here we just want a candidate to
  // display, so we read engineer_profiles directly.
  const { data: pool, error: poolErr } = await sb
    .from("engineer_profiles")
    .select("user_id, technologies, experience_level")
    .eq("is_available", true)
    .limit(50);

  if (poolErr || !pool || pool.length === 0) {
    return NextResponse.json({ engineer: null }, { status: 200 });
  }

  // Filter out engineers currently in an active session.
  const ids = (pool as EngineerRow[]).map((r) => r.user_id);
  const { data: busy } = await sb
    .from("guest_calls")
    .select("claimed_by")
    .in("claimed_by", ids)
    .in("status", [
      "assigned",
      "joining",
      "live",
      "grace",
      "ending",
      "expired_free",
    ]);
  const busySet = new Set(((busy as { claimed_by: string }[]) ?? []).map((r) => r.claimed_by));
  const available = (pool as EngineerRow[]).filter((r) => !busySet.has(r.user_id));

  if (available.length === 0) {
    return NextResponse.json({ engineer: null }, { status: 200 });
  }

  // Rank by tech overlap, then experience.
  const ranked = available
    .map((row) => {
      const techs = (row.technologies ?? []).filter(Boolean);
      const overlap = techs.filter((t) =>
        requested.includes(String(t).toLowerCase()),
      );
      const expBonus =
        row.experience_level === "Experienced"
          ? 1.5
          : row.experience_level === "Intermediate"
            ? 1.0
            : 0.5;
      return { row, techs, overlap, score: overlap.length * 1.0 + expBonus };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];

  // Look up the engineer's display name for pseudonymization.
  const { data: prof } = await sb
    .from("profiles")
    .select("id, full_name")
    .eq("id", top.row.user_id)
    .maybeSingle();

  const { pseudoName, initials } = pseudonymize(
    (prof as ProfileRow | null)?.full_name ?? null,
    top.row.user_id,
  );

  return NextResponse.json(
    {
      engineer: {
        id: top.row.user_id,
        pseudoName,
        initials,
        technologies: top.techs,
        matchedTechnologies: top.overlap,
        experienceYears: experienceYears(top.row.experience_level),
        experienceLabel: top.row.experience_level ?? "Engineer",
        etaSeconds: 25,
      },
    },
    { status: 200 },
  );
}
