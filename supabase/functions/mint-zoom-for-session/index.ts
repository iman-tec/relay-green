// Mints a Zoom meeting for an existing guest_calls session.
//
// Privacy: participants join via meeting REGISTRATION, so each gets a
// personalised join URL that joins them under a chosen name — the engineer
// under their alias (engineer_profiles.display_alias, e.g. "Leo Hart"), the
// customer under their own name. Their real names are never shown in Zoom.
//
// Robust fallback: if registration isn't available (account tier) or any Zoom
// call in the registration path fails, we fall back to a plain instant meeting
// (today's behaviour) so calls never break — they just won't carry per-person
// names in that case.
//
// Idempotent: if the session already has a (non-stale) zoom_meeting_id, returns
// it. Caller must be the assigned engineer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID");
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID");
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET");

async function getZoomAccessToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(`Zoom OAuth failed [${r.status}]: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

// End live meetings on the host account that are NOT tied to an active Relay
// session (Zoom rejects a fresh meeting start while another is live), but never
// kill meetings tied to other in-progress Relay sessions.
async function endStaleLiveMeetings(
  token: string,
  admin: ReturnType<typeof createClient>,
  opts: { force?: boolean } = {},
): Promise<number> {
  try {
    const r = await fetch(
      "https://api.zoom.us/v2/users/me/meetings?type=live&page_size=30",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return 0;
    const data = await r.json();
    const live = (data.meetings ?? []) as Array<{ id: number | string }>;
    if (live.length === 0) return 0;

    let toEnd = live;
    if (!opts.force) {
      const ids = live.map((m) => String(m.id));
      const { data: active } = await admin
        .from("guest_calls")
        .select("zoom_meeting_id")
        .in("zoom_meeting_id", ids)
        .in("status", ["assigned", "joining", "live", "grace", "expired_free"]);
      const protectedIds = new Set(
        ((active ?? []) as Array<{ zoom_meeting_id: string }>).map((r) => r.zoom_meeting_id),
      );
      toEnd = live.filter((m) => !protectedIds.has(String(m.id)));
    }

    await Promise.all(toEnd.map((m) =>
      fetch(`https://api.zoom.us/v2/meetings/${m.id}/status`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end" }),
      }).catch(() => undefined),
    ));
    return toEnd.length;
  } catch { return 0; }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Instant-meeting create with backoff on Zoom errorCode 3000 ("host already in
// another meeting"). Used by the FALLBACK path only.
async function createMeetingWithRetry(
  token: string,
  admin: ReturnType<typeof createClient>,
  body: unknown,
  attempts = 3,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  let lastData: Record<string, unknown> = {};
  for (let i = 0; i < attempts; i++) {
    const r = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    lastData = data;
    if (r.ok) return { ok: true, data };
    if (data?.code === 3000 && i < attempts - 1) {
      await endStaleLiveMeetings(token, admin, { force: true });
      await sleep(1500 + i * 1000);
      continue;
    }
    return { ok: false, data };
  }
  return { ok: false, data: lastData };
}

// Register one participant under a display name and return their personalised
// join URL. Zoom requires a non-empty last_name, so single-word names get a
// "." placeholder (two-word aliases like "Leo Hart" split naturally).
async function addRegistrant(
  token: string,
  meetingId: string,
  displayName: string,
  email: string,
): Promise<string> {
  const tokens = displayName.split(/\s+/).filter(Boolean);
  const first = tokens[0] || "Guest";
  const last = tokens.slice(1).join(" ") || ".";
  const r = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/registrants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, first_name: first, last_name: last }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.join_url) {
    throw new Error(`registrant failed [${r.status}]: ${JSON.stringify(data)}`);
  }
  return data.join_url as string;
}

// Registration path: scheduled meeting with auto-approve registration, then a
// registrant per participant. Returns named join URLs. Throws on any failure
// so the caller can fall back.
async function mintWithRegistration(
  token: string,
  opts: { topic: string; engAlias: string; custName: string },
): Promise<{ meetingId: string; engineerUrl: string; customerUrl: string; observerUrl: string }> {
  const start = new Date(Date.now() + 60_000).toISOString();
  const r = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: opts.topic,
      type: 2,                 // scheduled (required for registration)
      start_time: start,
      duration: 180,
      settings: {
        join_before_host: true,           // host account never joins
        waiting_room: false,
        approval_type: 0,                 // auto-approve registrants
        registration_type: 1,
        registrants_email_notification: false, // we hand out the link in-app
        auto_recording: "none",
        auto_start_meeting_summary: true,
        auto_start_ai_companion_questions: true,
        meeting_summary: true,
        ai_companion_auto_start: true,
      },
    }),
  });
  const m = await r.json().catch(() => ({}));
  if (!r.ok || !m.id) {
    throw new Error(`create(type2) failed [${r.status}]: ${JSON.stringify(m)}`);
  }
  const meetingId = String(m.id);
  const engineerUrl = await addRegistrant(token, meetingId, opts.engAlias, `eng-${meetingId}@relay.invalid`);
  const customerUrl = await addRegistrant(token, meetingId, opts.custName, `cust-${meetingId}@relay.invalid`);
  // Anonymous supervisor observer — joins under a generic name so neither the
  // customer nor the engineer learns who is monitoring. Any covering
  // supervisor reuses this single registrant URL.
  const observerUrl = await addRegistrant(token, meetingId, "Relay Supervisor", `sup-${meetingId}@relay.invalid`);
  return { meetingId, engineerUrl, customerUrl, observerUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      throw new Error("Zoom credentials are not configured");
    }

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId: string | undefined = body.session_id;
    if (!sessionId) return json({ error: "session_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: session, error: sErr } = await admin
      .from("guest_calls")
      .select("id, claimed_by, zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_observer_url, guest_name, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (sErr || !session) return json({ error: "Session not found" }, 404);
    if (session.claimed_by !== u.user.id) return json({ error: "Not assigned to you" }, 403);

    // Idempotency vs restart: reuse the existing meeting unless the latest
    // lifecycle message is an "ended" one (meeting is stale → mint fresh).
    let isStale = false;
    if (session.zoom_meeting_id) {
      const { data: lastEnd } = await admin
        .from("guest_messages").select("created_at")
        .eq("guest_call_id", sessionId).eq("sender_kind", "system")
        .ilike("body", "%Zoom meeting ended%")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: lastStart } = await admin
        .from("guest_messages").select("created_at")
        .eq("guest_call_id", sessionId).eq("sender_kind", "system")
        .ilike("body", "%Zoom meeting started%")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (lastEnd) {
        isStale = !lastStart || new Date(lastEnd.created_at) > new Date(lastStart.created_at);
      }
      if (!isStale) {
        return json({
          ok: true,
          zoom_meeting_id: session.zoom_meeting_id,
          zoom_join_url: session.zoom_join_url,
          zoom_start_url: session.zoom_start_url,
          zoom_observer_url: session.zoom_observer_url,
          existing: true,
        });
      }
    }

    // ── Mint ──────────────────────────────────────────────────────────────
    const token = await getZoomAccessToken();
    const endedCount = await endStaleLiveMeetings(token, admin);
    if (endedCount > 0) await sleep(1200);

    // Customer-facing names: engineer alias + customer name.
    const custName = (session.guest_name || "Guest").toString().trim();
    let engAlias = "Relay Engineer";
    if (session.claimed_by) {
      const { data: prof } = await admin
        .from("engineer_profiles").select("display_alias")
        .eq("user_id", session.claimed_by).maybeSingle();
      if (prof?.display_alias) engAlias = String(prof.display_alias).trim();
    }

    let meetingId: string;
    let customerJoinUrl: string;
    let engineerJoinUrl: string;
    let observerJoinUrl: string;
    let named = false;

    try {
      const reg = await mintWithRegistration(token, {
        topic: `Relay session — ${custName}`,
        engAlias,
        custName,
      });
      meetingId = reg.meetingId;
      engineerJoinUrl = reg.engineerUrl; // engineer opens zoom_start_url
      customerJoinUrl = reg.customerUrl; // customer opens zoom_join_url
      observerJoinUrl = reg.observerUrl; // supervisor opens zoom_observer_url
      named = true;
    } catch (regErr) {
      // Fallback — plain instant meeting (no per-person names, but it works).
      console.warn(
        "mint-zoom: registration path failed, falling back to instant:",
        regErr instanceof Error ? regErr.message : String(regErr),
      );
      const createBody = {
        topic: `Relay session — ${custName}`,
        type: 1,
        settings: {
          join_before_host: true,
          waiting_room: false,
          approval_type: 2,
          auto_recording: "none",
          auto_start_meeting_summary: true,
          auto_start_ai_companion_questions: true,
          meeting_summary: true,
          ai_companion_auto_start: true,
        },
      };
      const { ok, data: z } = await createMeetingWithRetry(token, admin, createBody);
      if (!ok) {
        console.error("Zoom create failed", z);
        return json({ error: "Zoom create failed", detail: z }, 502);
      }
      meetingId = String(z.id);
      customerJoinUrl = z.join_url as string;
      engineerJoinUrl = z.start_url as string;
      // Instant meeting has no per-person registrants — the supervisor joins
      // via the same shared join URL as the customer.
      observerJoinUrl = z.join_url as string;
    }

    const { error: updErr } = await admin
      .from("guest_calls")
      .update({
        zoom_meeting_id: meetingId,
        zoom_join_url: customerJoinUrl,
        zoom_start_url: engineerJoinUrl,
        zoom_observer_url: observerJoinUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("guest_messages").insert({
      guest_call_id: sessionId,
      sender_kind: "system",
      sender_name: "Relay",
      body: isStale ? "📞 New Zoom meeting started" : "📞 Zoom meeting started",
    });

    return json({
      ok: true,
      zoom_meeting_id: meetingId,
      zoom_join_url: customerJoinUrl,
      zoom_start_url: engineerJoinUrl,
      zoom_observer_url: observerJoinUrl,
      existing: false,
      restarted: isStale,
      named,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
