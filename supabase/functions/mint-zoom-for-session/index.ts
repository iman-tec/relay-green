// Mints a Zoom meeting for an existing guest_calls session.
// Idempotent: if the session already has zoom_meeting_id, returns it.
// Caller must be the assigned engineer.

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
// session. Necessary because Zoom rejects a fresh meeting start while another
// is live ("Already has other meetings in progress"); but we must not kill
// meetings tied to other in-progress Relay sessions, otherwise concurrent
// engineers get kicked.
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
      // Which meeting IDs belong to an in-progress Relay session?
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

// CREATE-meeting with backoff on Zoom errorCode 3000 ("Already has other
// meetings in progress"). The end-meeting API is async — if we just minted
// after ending the previous one, Zoom's host-state may still report busy
// for a few seconds. We retry after force-ending any stragglers.
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
    // Zoom code 3000 = host already in another meeting → force-end + wait + retry.
    if (data?.code === 3000 && i < attempts - 1) {
      await endStaleLiveMeetings(token, admin, { force: true });
      await sleep(1500 + i * 1000);
      continue;
    }
    return { ok: false, data };
  }
  return { ok: false, data: lastData };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      throw new Error("Zoom credentials are not configured");
    }

    // Auth: validate the engineer's token
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const sessionId: string | undefined = body.session_id;
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Authorisation: must be the assigned engineer for this session
    const { data: session, error: sErr } = await admin
      .from("guest_calls")
      .select("id, claimed_by, zoom_meeting_id, zoom_join_url, zoom_start_url, guest_name, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (sErr || !session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (session.claimed_by !== u.user.id) {
      return new Response(JSON.stringify({ error: "Not assigned to you" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency vs. restart: if zoom_meeting_id is still set but the
    // latest meeting-lifecycle system message in chat is an "ended" one,
    // the existing meeting is stale — mint a fresh Zoom. Otherwise return
    // the current meeting as before.
    let isStale = false;
    if (session.zoom_meeting_id) {
      const { data: lastEnd } = await admin
        .from("guest_messages")
        .select("created_at")
        .eq("guest_call_id", sessionId)
        .eq("sender_kind", "system")
        .ilike("body", "%Zoom meeting ended%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: lastStart } = await admin
        .from("guest_messages")
        .select("created_at")
        .eq("guest_call_id", sessionId)
        .eq("sender_kind", "system")
        .ilike("body", "%Zoom meeting started%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastEnd) {
        isStale = !lastStart || new Date(lastEnd.created_at) > new Date(lastStart.created_at);
      }
      if (!isStale) {
        return new Response(JSON.stringify({
          ok: true,
          zoom_meeting_id: session.zoom_meeting_id,
          zoom_join_url: session.zoom_join_url,
          zoom_start_url: session.zoom_start_url,
          existing: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Mint new meeting
    const token = await getZoomAccessToken();
    const endedCount = await endStaleLiveMeetings(token, admin);
    // Zoom's end-meeting API is async; if we just nuked any, give propagation
    // a beat before asking it to start a new one.
    if (endedCount > 0) await sleep(1200);

    const createBody = {
      topic: `Relay session — ${session.guest_name}`,
      type: 1, // instant
      settings: {
        join_before_host: true,
        waiting_room: false,
        approval_type: 2,
        auto_recording: "cloud",
        auto_start_meeting_summary: true,
        auto_start_ai_companion_questions: true,
        meeting_summary: true,
        ai_companion_auto_start: true,
      },
    };

    const { ok, data: z } = await createMeetingWithRetry(token, admin, createBody);
    if (!ok) {
      console.error("Zoom create failed", z);
      return new Response(JSON.stringify({ error: "Zoom create failed", detail: z }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persist on the session row
    const { error: updErr } = await admin
      .from("guest_calls")
      .update({
        zoom_meeting_id: String(z.id),
        zoom_join_url: z.join_url,
        zoom_start_url: z.start_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Post a "Zoom meeting started" system message into the chat. The
    // client-side card tracks the latest started-vs-ended event to decide
    // whether to show "Join meeting" or "Meeting ended". The first-ever
    // mint posts this too so the same logic works for the initial call.
    await admin.from("guest_messages").insert({
      guest_call_id: sessionId,
      sender_kind: "system",
      sender_name: "Relay",
      body: isStale ? "📞 New Zoom meeting started" : "📞 Zoom meeting started",
    });

    return new Response(JSON.stringify({
      ok: true,
      zoom_meeting_id: String(z.id),
      zoom_join_url: z.join_url,
      zoom_start_url: z.start_url,
      existing: false,
      restarted: isStale,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
