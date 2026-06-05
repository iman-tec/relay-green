// End an active Zoom meeting for an existing guest_calls session.
// Caller must be the assigned engineer for the session.
//
// This lets the engineer hang up the Zoom call directly from the Relay
// chat (the "End" button next to Join on the inline meeting card) without
// having to actually open Zoom and click "End meeting for all" inside it.
//
// The function also posts the "📞 Zoom meeting ended" system message into
// the chat so the card flips immediately. When Zoom subsequently delivers
// the meeting.ended webhook, its dedupe (latest ended vs latest started)
// suppresses a duplicate message.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID");
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID");
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET");

async function getZoomAccessToken(): Promise<string> {
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } }
  );
  const data = await r.json();
  if (!r.ok)
    throw new Error(`Zoom OAuth failed [${r.status}]: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      throw new Error("Zoom credentials are not configured");
    }

    // Auth: validate the engineer's token.
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

    // Authorization: either the assigned engineer OR the customer who owns
    // the session can end the Zoom meeting. Both are session participants
    // and either ending the session should also hang up Zoom. Supervisors
    // and other readers stay forbidden.
    const { data: session, error: sErr } = await admin
      .from("guest_calls")
      .select("id, claimed_by, customer_user_id, zoom_meeting_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sErr || !session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isParticipant =
      session.claimed_by === u.user.id ||
      session.customer_user_id === u.user.id;
    if (!isParticipant) {
      return new Response(
        JSON.stringify({ error: "Not a session participant" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (!session.zoom_meeting_id) {
      // Nothing to hang up. Treat as success so callers don't have to know
      // whether a Zoom was ever minted for this session — keeps the
      // "end session → end zoom" wiring idempotent on the call site.
      return new Response(JSON.stringify({ ok: true, noop: "no_meeting" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // End the Zoom meeting via the REST API. Treat Zoom code 3027
    // ("meeting is not started") as success — that just means nobody had
    // joined yet, and the engineer's intent is "make this meeting end
    // either way."
    const token = await getZoomAccessToken();
    const r = await fetch(
      `https://api.zoom.us/v2/meetings/${session.zoom_meeting_id}/status`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "end" }),
      }
    );
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      if (data?.code !== 3027) {
        console.error("Zoom end failed:", r.status, data);
        return new Response(
          JSON.stringify({ error: "Couldn't end Zoom meeting", detail: data }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Post the "📞 Zoom meeting ended" system message into chat right away
    // so the inline meeting card flips without waiting on the webhook.
    // Dedupe vs. the webhook: only insert if the latest "ended" message in
    // this session is older than the latest "started" — same condition the
    // webhook uses, so whichever runs second skips its insert.
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
    const alreadyEnded =
      !!lastEnd &&
      (!lastStart ||
        new Date(lastEnd.created_at) > new Date(lastStart.created_at));
    if (!alreadyEnded) {
      await admin.from("guest_messages").insert({
        guest_call_id: sessionId,
        sender_kind: "system",
        sender_name: "Relay",
        body: "📞 Zoom meeting ended",
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
