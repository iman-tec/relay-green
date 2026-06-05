// Mint a fresh Zoom meeting for an existing guest_call.
// De-duped: if a new meeting was created in the last 30s, return that one
// instead of minting another. Otherwise, delete the old Zoom meeting and create a fresh one
// so nobody is stranded in an orphaned room.
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

const DEDUPE_WINDOW_MS = 30_000;

async function getZoomAccessToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(`Zoom OAuth failed [${r.status}]: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function endAndDeleteZoomMeeting(token: string, meetingId: string) {
  try {
    // End first (kicks all participants), then delete the record.
    await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/status`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "end" }),
    });
    const r = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok && r.status !== 404) {
      const t = await r.text();
      console.warn(`Zoom delete returned ${r.status}: ${t}`);
    }
  } catch (e) {
    console.warn("Zoom end/delete failed (non-fatal):", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      throw new Error("Zoom credentials are not configured");
    }
    const { guest_call_id } = await req.json().catch(() => ({}));
    if (!guest_call_id) {
      return new Response(JSON.stringify({ error: "guest_call_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: gc, error: gcErr } = await admin
      .from("guest_calls")
      .select(
        "id, guest_name, status, zoom_meeting_id, zoom_join_url, zoom_start_url, updated_at"
      )
      .eq("id", guest_call_id)
      .maybeSingle();
    if (gcErr || !gc) throw new Error("Session not found");
    if (gc.status === "ended") throw new Error("Session already ended");

    // De-dupe: if a meeting was minted very recently (likely by the other side
    // clicking restart at nearly the same time), reuse it instead of creating another.
    const lastUpdated = gc.updated_at ? new Date(gc.updated_at).getTime() : 0;
    const ageMs = Date.now() - lastUpdated;
    if (gc.zoom_meeting_id && gc.zoom_join_url && ageMs < DEDUPE_WINDOW_MS) {
      console.log(
        `Reusing fresh meeting ${gc.zoom_meeting_id} (age ${ageMs}ms)`
      );
      return new Response(
        JSON.stringify({
          ok: true,
          reused: true,
          zoom_join_url: gc.zoom_join_url,
          zoom_start_url: gc.zoom_start_url,
          zoom_meeting_id: gc.zoom_meeting_id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const accessToken = await getZoomAccessToken();

    // End then delete the previous Zoom meeting so the host slot is free.
    if (gc.zoom_meeting_id) {
      await endAndDeleteZoomMeeting(accessToken, gc.zoom_meeting_id);
    }

    const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: `Relay session — ${gc.guest_name}`,
        type: 1,
        settings: {
          join_before_host: true,
          waiting_room: false,
          approval_type: 2,
          // Force-disable cloud recording (overrides Zoom account default).
          // Engineer can manually hit ⏺ Record in the meeting.
          auto_recording: "none",
          auto_start_meeting_summary: true,
          auto_start_ai_companion_questions: true,
          meeting_summary: true,
          ai_companion_auto_start: true,
        },
      }),
    });
    const zoomData = await zoomRes.json();
    if (!zoomRes.ok)
      throw new Error(`Zoom create failed: ${JSON.stringify(zoomData)}`);

    await admin
      .from("guest_calls")
      .update({
        zoom_meeting_id: String(zoomData.id),
        zoom_join_url: zoomData.join_url,
        zoom_start_url: zoomData.start_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", guest_call_id);

    await admin.from("guest_messages").insert({
      guest_call_id,
      sender_kind: "system",
      sender_name: "Relay",
      body: "🔄 New video room created — click Start video call to rejoin.",
    });

    return new Response(
      JSON.stringify({
        ok: true,
        reused: false,
        zoom_join_url: zoomData.join_url,
        zoom_start_url: zoomData.start_url,
        zoom_meeting_id: String(zoomData.id),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("restart-guest-zoom error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
