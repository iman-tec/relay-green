// Engineer-initiated "end Video SDK session for everyone".
//
// The browser client calls `client.leave({ end: true })` first which kicks
// every participant out (Video SDK closes the session a few seconds later).
// This server function then:
//   1. Verifies caller is the engineer (claimed_by) or a supervisor.
//   2. Stamps guest_calls.video_ended_at = now() so the room UI flips back
//      to its post-call layout immediately, ahead of the webhook's
//      session.ended event.
//   3. Posts a "📞 Zoom video session ended" system message (deduped vs the
//      latest "started"/"ended" pair, matching end-zoom-meeting's behaviour).
//   4. Fires summarize-guest-call as fire-and-forget so the summary lands in
//      the customer's room without blocking the engineer.
//   5. Records the action in session_video_events.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: session } = await admin
      .from("guest_calls")
      .select("id, claimed_by, video_ended_at")
      .eq("id", session_id)
      .maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ error: "SESSION_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorise: engineer or supervisor-class staff.
    const isEngineer = session.claimed_by === userId;
    let isSupervisor = false;
    if (!isEngineer) {
      const { data: roleRows } = await admin
        .from("user_role_names")
        .select("role")
        .eq("user_id", userId);
      const roles = new Set((roleRows ?? []).map((r) => (r as { role: string }).role));
      isSupervisor =
        roles.has("supervisor") || roles.has("pod_lead") ||
        roles.has("ops_manager") || roles.has("admin") ||
        roles.has("super_admin");
    }
    if (!isEngineer && !isSupervisor) {
      return new Response(JSON.stringify({ error: "NOT_AUTHORIZED" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stamp the end timestamp (idempotent — only set if NULL).
    if (!session.video_ended_at) {
      await admin
        .from("guest_calls")
        .update({ video_ended_at: new Date().toISOString() })
        .eq("id", session.id)
        .is("video_ended_at", null);
    }

    // Post system message; dedupe against any prior "ended" newer than the
    // latest "started" (same shape as end-zoom-meeting).
    const { data: lastMsgs } = await admin
      .from("guest_messages")
      .select("body, created_at")
      .eq("session_id", session.id)
      .or("body.ilike.%Zoom meeting started%,body.ilike.%Zoom video session started%,body.ilike.%Zoom meeting ended%,body.ilike.%Zoom video session ended%")
      .order("created_at", { ascending: false })
      .limit(2);
    const latestStarted = (lastMsgs ?? []).find((m) => /started/i.test((m as { body: string }).body));
    const latestEnded   = (lastMsgs ?? []).find((m) => /ended/i.test((m as { body: string }).body));
    const shouldPost = !latestEnded ||
      (latestStarted &&
       new Date((latestStarted as { created_at: string }).created_at).getTime() >
       new Date((latestEnded as { created_at: string }).created_at).getTime());

    if (shouldPost) {
      await admin.from("guest_messages").insert({
        session_id: session.id,
        body: "📞 Zoom video session ended",
        role: "system",
      });
    }

    // Audit.
    await admin.from("session_video_events").insert({
      guest_call_id: session.id,
      kind:          "end_for_all",
      actor_user_id: userId,
    });

    // Fire-and-forget summarize-guest-call. Same pattern as zoom-webhook.
    try {
      void fetch(`${SUPABASE_URL}/functions/v1/summarize-guest-call`, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session_id: session.id }),
      });
    } catch { /* best-effort */ }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
