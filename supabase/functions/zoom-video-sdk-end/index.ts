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
      .select("id, claimed_by, customer_user_id, video_ended_at")
      .eq("id", session_id)
      .maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ error: "SESSION_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorise: caller must be a party to this session — the engineer
    // (claimed_by), the customer (customer_user_id), or a supervisor-class
    // staffer. The engineer/supervisor branch fires the full end-for-all
    // bookkeeping (summarize chain, video_ended_at); the customer branch
    // just posts the system message so the chat card flips to ended on
    // both sides.
    const isEngineer = session.claimed_by === userId;
    const isCustomer = (session as { customer_user_id?: string }).customer_user_id === userId;
    let isSupervisor = false;
    if (!isEngineer && !isCustomer) {
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
    if (!isEngineer && !isCustomer && !isSupervisor) {
      return new Response(JSON.stringify({ error: "NOT_AUTHORIZED" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const endForAll = isEngineer || isSupervisor;

    // Engineer/supervisor path: stamp the global video_ended_at and chain
    // summarize. Customer-leave skips both — they just want THEIR side
    // marked as done so the chat card flips.
    if (endForAll && !session.video_ended_at) {
      await admin
        .from("guest_calls")
        .update({ video_ended_at: new Date().toISOString() })
        .eq("id", session.id)
        .is("video_ended_at", null);
    }

    // Clear participant-joined flags so the NEXT call cycle's chat card
    // shows the Join button again (otherwise MeetingChatEntry sees the
    // stale engineer_joined_at / customer_joined_at and renders "You're
    // on the call" instead of the Join CTA). Only the leaving party's
    // flag is cleared; the other side may still be on the call.
    const update: Record<string, unknown> = {};
    if (isEngineer || isSupervisor) update.engineer_joined_at = null;
    if (isCustomer)                  update.customer_joined_at = null;
    if (Object.keys(update).length > 0) {
      await admin.from("guest_calls").update(update).eq("id", session.id);
    }

    // Post the "📞 Zoom meeting ended" system message — body is the exact
    // string MeetingChatEntry's chat-card pairing logic looks for, so the
    // ongoing card flips to its ended state on both client UIs.
    // Dedupe: only post if the latest started/ended pair shows we're still
    // in the "started but not ended" half.
    const { data: lastMsgs } = await admin
      .from("guest_messages")
      .select("body, created_at")
      .eq("guest_call_id", session.id)
      .or("body.ilike.%Zoom meeting started%,body.ilike.%Zoom meeting ended%")
      .order("created_at", { ascending: false })
      .limit(2);
    const latestStarted = (lastMsgs ?? []).find((m) => /started/i.test((m as { body: string }).body));
    const latestEnded   = (lastMsgs ?? []).find((m) => /ended/i.test((m as { body: string }).body));
    const shouldPost = !latestEnded ||
      (latestStarted &&
       new Date((latestStarted as { created_at: string }).created_at).getTime() >
       new Date((latestEnded as { created_at: string }).created_at).getTime());

    if (shouldPost) {
      const { error: insErr } = await admin.from("guest_messages").insert({
        guest_call_id: session.id,
        sender_kind:   "system",
        sender_name:   "Relay",
        body:          "📞 Zoom meeting ended",
      });
      if (insErr) console.error("[zoom-video-sdk-end] insert system msg failed:", insErr);
    }

    // Audit.
    await admin.from("session_video_events").insert({
      guest_call_id: session.id,
      kind:          endForAll ? "end_for_all" : "participant_left",
      actor_user_id: userId,
    });

    // Only the engineer/supervisor end-for-all triggers the summary chain.
    if (endForAll) {
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
    }

    return new Response(
      JSON.stringify({ ok: true, end_for_all: endForAll }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
