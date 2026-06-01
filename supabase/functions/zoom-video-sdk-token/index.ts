// Signs a Zoom Video SDK JWT so the browser SDK can join a session.
// HS256 with ZOOM_VIDEO_SDK_SECRET. The Video SDK app's JWT shape is:
//
//   {
//     "app_key":   <SDK key>,
//     "tpc":       relay-session-<guest_calls.id>,
//     "role_type": 1 (engineer host) | 0 (customer participant),
//     "version":   1,
//     "iat":       unix(),
//     "exp":       unix() + 2h,
//     "user_identity": <auth.uid>,
//     "session_key":   <guest_calls.id>,
//     "cloud_recording_option": 0
//   }
//
// Authorisation: caller must be the session's claimed_by (engineer) OR
// customer_user_id. Anyone else gets 403. The function also idempotently
// stamps guest_calls.video_topic on first call so the webhook handler can
// reconcile sessions by topic.

import { create } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZOOM_VIDEO_SDK_KEY        = Deno.env.get("ZOOM_VIDEO_SDK_KEY");
const ZOOM_VIDEO_SDK_SECRET     = Deno.env.get("ZOOM_VIDEO_SDK_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!ZOOM_VIDEO_SDK_KEY || !ZOOM_VIDEO_SDK_SECRET) {
      return new Response(
        JSON.stringify({ error: "ZOOM_VIDEO_SDK_KEY/SECRET not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the caller. We need the user-context Supabase client to read
    // auth.uid(); fall back to 401 if no bearer.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData.user?.id ?? null;
    if (!userId) {
      return new Response(JSON.stringify({ error: "NOT_AUTHENTICATED" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for DB writes that bypass RLS.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: session, error: sErr } = await admin
      .from("guest_calls")
      .select("id, claimed_by, customer_user_id, video_topic, supervisor_user_id, is_appointment")
      .eq("id", session_id)
      .maybeSingle();
    if (sErr || !session) {
      return new Response(JSON.stringify({ error: "SESSION_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isEngineer = session.claimed_by === userId;
    const isCustomer = session.customer_user_id === userId;
    // APPOINTMENT ONLY: the owning supervisor (moderator) may host the call so
    // a supervisor + customer can talk before/without an engineer. This branch
    // is gated on is_appointment, so the normal engineer↔customer flow is
    // untouched (a supervisor on a regular session still gets 403 here).
    const isAppointmentSupervisor =
      session.is_appointment === true && session.supervisor_user_id === userId;
    if (!isEngineer && !isCustomer && !isAppointmentSupervisor) {
      return new Response(JSON.stringify({ error: "NOT_AUTHORIZED" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const topic = session.video_topic ?? `relay-session-${session.id}`;

    // Idempotent stamp: only writes if NULL today.
    if (!session.video_topic) {
      await admin
        .from("guest_calls")
        .update({ video_topic: topic })
        .eq("id", session.id)
        .is("video_topic", null);
    }

    // Post a "📞 Zoom meeting started" system message so MeetingChatEntry
    // renders the inline call-card on BOTH sides with a Join button. We
    // dedupe: only post when the latest started/ended pair shows the cycle
    // is closed (latest is "ended" or no messages exist yet). This way a
    // second restart inside the same session gets its own card pair, and
    // repeated token mints (re-issue, page reload) don't spam the chat.
    const { data: lastMsgs } = await admin
      .from("guest_messages")
      .select("body, created_at")
      .eq("guest_call_id", session.id)
      .or("body.ilike.%Zoom meeting started%,body.ilike.%Zoom meeting ended%")
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = (lastMsgs ?? [])[0] as { body: string } | undefined;
    const cycleClosed = !latest || /ended/i.test(latest.body);
    if (cycleClosed) {
      const { error: insErr } = await admin.from("guest_messages").insert({
        guest_call_id: session.id,
        sender_kind:   "system",
        sender_name:   "Relay",
        body:          "📞 Zoom meeting started",
      });
      if (insErr) console.error("[zoom-video-sdk-token] insert started msg failed:", insErr);
    }

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 2 * 60 * 60; // 2h

    const payload = {
      app_key:               ZOOM_VIDEO_SDK_KEY,
      tpc:                   topic,
      // Host (1) for the engineer, or the appointment's supervisor when they're
      // hosting the call themselves; customer joins as participant (0).
      role_type:             isEngineer || isAppointmentSupervisor ? 1 : 0,
      version:               1,
      iat,
      exp,
      user_identity:         userId,
      session_key:           session.id,
      cloud_recording_option: 0,
    };

    // HS256 with the SDK secret.
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(ZOOM_VIDEO_SDK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const token = await create({ alg: "HS256", typ: "JWT" }, payload, cryptoKey);

    // Audit row.
    await admin.from("session_video_events").insert({
      guest_call_id: session.id,
      kind:          "token_issued",
      actor_user_id: userId,
      payload:       { role_type: payload.role_type, topic },
    });

    return new Response(
      JSON.stringify({
        token,
        topic,
        session_key:   session.id,
        user_identity: userId,
        role_type:     payload.role_type,
        sdk_key:       ZOOM_VIDEO_SDK_KEY,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
