// Anonymous endpoint: a visitor types their name (and optional email) on the landing page
// and gets dropped into a meeting room. Stitches each session to a persistent guest_thread
// so the next available agent sees full history + AI brief.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID");
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID");
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET");

async function getZoomAccessToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(`Zoom OAuth failed [${r.status}]: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

// End every live meeting on the account before creating a new one.
// Without this, the Zoom SDK throws "Already has other meetings in progress"
// when the host tries to start a second meeting while the first is still active.
async function endAllLiveMeetings(accessToken: string): Promise<void> {
  try {
    const r = await fetch(
      "https://api.zoom.us/v2/users/me/meetings?type=live&page_size=30",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) return;
    const data = await r.json();
    const meetings = (data.meetings ?? []) as Array<{ id: number | string }>;
    await Promise.all(
      meetings.map((m) =>
        fetch(`https://api.zoom.us/v2/meetings/${m.id}/status`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end" }),
        }).catch(() => {/* non-fatal */})
      ),
    );
    if (meetings.length > 0) console.log(`Ended ${meetings.length} live meeting(s).`);
  } catch (e) {
    console.error("endAllLiveMeetings failed (non-fatal):", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const guestName: string = (body.guest_name ?? "").toString().trim().slice(0, 80);
    const guestEmail: string = (body.guest_email ?? "").toString().trim().slice(0, 200);
    const guestLocalId: string = (body.guest_local_id ?? "").toString().trim().slice(0, 80);
    if (!guestName) {
      return new Response(JSON.stringify({ error: "Name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find or create the persistent guest thread
    const { data: threadId, error: threadErr } = await admin.rpc("find_or_create_guest_thread", {
      _email: guestEmail || null,
      _local_id: guestLocalId || null,
      _display_name: guestName,
    });
    if (threadErr) console.error("thread upsert failed:", threadErr);

    // Carry the cumulative free-minute usage forward so the next session
    // starts at (30 − used) minutes, not a fresh 30. We sum every prior
    // call's free_minutes_used directly rather than relying on the
    // guest_threads column — that column only updates on a clean
    // "End & save", so abandoned sessions would otherwise leak free time.
    // Live sessions get their usage written every 30s by the engineer's
    // heartbeat in Room.tsx, so even an abandoned session contributes the
    // last-known minute count here.
    const FREE_QUOTA = 10;
    let threadUsed = 0;
    if (threadId) {
      const { data: prevCalls } = await admin
        .from("guest_calls")
        .select("free_minutes_used, duration_minutes, started_at, ended_at, status")
        .eq("thread_id", threadId);
      threadUsed = (prevCalls ?? []).reduce((sum: number, c: any) => {
        const recorded = Number(c.free_minutes_used) || 0;
        // Always trust duration_minutes if it's been set — that's the canonical
        // wall-clock duration written by summarize-guest-call and the engineer
        // heartbeat. Without this fallback, an old call with duration_minutes
        // but no free_minutes_used would be counted as 0 and the consumer
        // would get bonus free time on the next session.
        const recordedDuration = Number(c.duration_minutes) || 0;
        // Last-resort fallback: live or abandoned session with neither field
        // — estimate from started_at to ended_at (or now).
        let liveEstimate = 0;
        if (recorded === 0 && recordedDuration === 0 && c.started_at) {
          const end = c.ended_at ? new Date(c.ended_at).getTime() : Date.now();
          liveEstimate = Math.max(0, (end - new Date(c.started_at).getTime()) / 60000);
        }
        return sum + Math.max(recorded, recordedDuration, liveEstimate);
      }, 0);
    }
    const remainingMinutes = Math.max(0, Math.floor(FREE_QUOTA - threadUsed));

    let zoomJoinUrl: string | null = null;
    let zoomStartUrl: string | null = null;
    let zoomId: string | null = null;

    if (ZOOM_ACCOUNT_ID && ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET) {
      try {
        const accessToken = await getZoomAccessToken();
        await endAllLiveMeetings(accessToken);
        const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: `Relay session — ${guestName}`,
            type: 1, // instant
            settings: {
              join_before_host: true,
              waiting_room: false,
              approval_type: 2,
              // Force-disable cloud recording (overrides Zoom account-level
              // auto-record default). Engineer can manually hit ⏺ Record in
              // the meeting. AI Companion stays auto-on for the summary.
              auto_recording: "none",
              auto_start_meeting_summary: true,
              auto_start_ai_companion_questions: true,
              meeting_summary: true,
              ai_companion_auto_start: true,
            },
          }),
        });
        const zoomData = await zoomRes.json();
        if (zoomRes.ok) {
          zoomJoinUrl = zoomData.join_url;
          zoomStartUrl = zoomData.start_url;
          zoomId = String(zoomData.id);
        } else {
          console.error("Zoom create failed", zoomData);
        }
      } catch (e) {
        console.error("Zoom error (continuing without):", e);
      }
    }

    const { data: gc, error } = await admin
      .from("guest_calls")
      .insert({
        guest_name: guestName,
        guest_email: guestEmail || null,
        guest_local_id: guestLocalId || null,
        thread_id: threadId,
        zoom_meeting_id: zoomId,
        zoom_join_url: zoomJoinUrl,
        zoom_start_url: zoomStartUrl,
        status: "waiting",
        free_minutes: remainingMinutes,
      })
      .select("id")
      .single();

    if (error || !gc) throw new Error(error?.message || "Failed to create session");

    // Seed a system welcome message — short and warm, no minute counts.
    // The sidebar timer + paywall already communicate quota state visually.
    await admin.from("guest_messages").insert({
      guest_call_id: gc.id,
      sender_kind: "system",
      sender_name: "Relay",
      body: `Hi ${guestName} 👋 — welcome to Relay.`,
    });

    // Notify any engineers who exist
    const { data: engs } = await admin.from("user_role_names").select("user_id").eq("role", "engineer");
    for (const row of (engs ?? []) as { user_id: string }[]) {
      await admin.rpc("create_notification", {
        _user_id: row.user_id,
        _request_id: null,
        _kind: "guest_waiting",
        _title: `${guestName} is waiting in the relay room`,
        _body: `room:${gc.id}`,
      });
    }

    return new Response(JSON.stringify({ id: gc.id, thread_id: threadId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("start-guest-call error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
