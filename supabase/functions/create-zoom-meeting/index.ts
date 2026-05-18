// Create a Zoom meeting via Server-to-Server OAuth, then post a chat message in the request thread.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID");
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID");
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET");

async function getZoomAccessToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(`Zoom OAuth failed [${r.status}]: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      throw new Error("Zoom credentials are not configured");
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate user via anon client + provided JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const requestId: string | undefined = body.request_id;
    const topic: string = (body.topic ?? "").toString().trim();
    const startAtIso: string | undefined = body.start_at;
    const duration: number = Number.isFinite(body.duration_minutes) ? Number(body.duration_minutes) : 30;

    if (!requestId || !topic || !startAtIso) {
      return new Response(JSON.stringify({ error: "Missing request_id, topic, or start_at" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const startAt = new Date(startAtIso);
    if (isNaN(startAt.getTime())) {
      return new Response(JSON.stringify({ error: "Invalid start_at" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role client to check permissions and insert message bypassing missing RLS UPDATE
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Permission: must be staff (engineer/pod_lead/ops_manager/admin)
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isStaff =
      roleSet.has("engineer") ||
      roleSet.has("pod_lead") ||
      roleSet.has("ops_manager") ||
      roleSet.has("admin");
    if (!isStaff) {
      return new Response(JSON.stringify({ error: "Only staff can schedule Zoom meetings" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm the request exists
    const { data: reqRow, error: reqErr } = await admin
      .from("requests")
      .select("id")
      .eq("id", requestId)
      .maybeSingle();
    if (reqErr || !reqRow) {
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get OAuth token + create meeting
    const accessToken = await getZoomAccessToken();
    const zoomBody = {
      topic,
      type: 2, // scheduled
      start_time: startAt.toISOString(),
      duration,
      timezone: "UTC",
      settings: {
        join_before_host: true,
        waiting_room: false,
        approval_type: 2,
        // Force auto_recording=none to override any Zoom account-level
        // "Automatic recording" default. Recording is opt-in — the engineer
        // hits Zoom's native ⏺ Record button inside the meeting if they
        // want it. AI Companion stays auto-on so the per-call summary
        // fires if/when recording is started.
        auto_recording: "none",
        auto_start_meeting_summary: true,
        auto_start_ai_companion_questions: true,
        meeting_summary: true,
        ai_companion_auto_start: true,
      },
    };
    const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(zoomBody),
    });
    const zoomData = await zoomRes.json();
    if (!zoomRes.ok) {
      throw new Error(`Zoom create meeting failed [${zoomRes.status}]: ${JSON.stringify(zoomData)}`);
    }

    const joinUrl: string = zoomData.join_url;
    const zoomId: string = String(zoomData.id);
    const hostEmail: string | null = zoomData.host_email ?? null;

    // Insert chat message of type zoom_meeting
    const { data: msg, error: msgErr } = await admin
      .from("request_messages")
      .insert({
        request_id: requestId,
        sender_id: userId,
        body: `📹 Zoom meeting scheduled: ${topic}`,
        message_type: "zoom_meeting",
        meeting_topic: topic,
        meeting_start_at: startAt.toISOString(),
        meeting_duration_minutes: duration,
        meeting_join_url: joinUrl,
        meeting_host_email: hostEmail,
        meeting_zoom_id: zoomId,
      })
      .select("*")
      .single();
    if (msgErr) throw new Error(`Failed to insert message: ${msgErr.message}`);

    return new Response(JSON.stringify({ success: true, message: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("create-zoom-meeting error:", errorMessage);
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
