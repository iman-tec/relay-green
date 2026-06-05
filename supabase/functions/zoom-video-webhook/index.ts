// Zoom Video SDK webhook receiver.
//
// Replaces zoom-webhook for the Video-SDK side. Same HMAC-verify pattern,
// same URL-validation CRC challenge, but the relevant events are:
//
//   session.started         → stamp guest_calls.video_started_at + upsert call_sessions
//   session.ended           → stamp guest_calls.video_ended_at + bill via debit_credits + summarize chain
//   recording.completed     → write guest_calls.recording_play_url + recording_password + duration_minutes
//
// We key call_sessions by `session_key` (set to guest_calls.id when the
// client requests a token in zoom-video-sdk-token) so this flow stays
// fully separate from the Meeting-SDK ledger that keys on zoom_meeting_id.
//
// Endpoint URL to register in Zoom Marketplace:
//   https://<project-ref>.supabase.co/functions/v1/zoom-video-webhook
// Secret token to paste in the app config:
//   value of ZOOM_VIDEO_WEBHOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZOOM_VIDEO_WEBHOOK_SECRET =
  Deno.env.get("ZOOM_VIDEO_WEBHOOK_SECRET") ?? "";

// Same rate as the Meeting SDK side (see zoom-webhook/index.ts).
const CREDITS_PER_MINUTE = 1000 / 60; // ≈16.6667

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyZoomSignature(
  req: Request,
  body: string
): Promise<boolean> {
  if (!ZOOM_VIDEO_WEBHOOK_SECRET) return true; // allow during local setup
  const ts = req.headers.get("x-zm-request-timestamp") ?? "";
  const sig = req.headers.get("x-zm-signature") ?? "";
  if (!ts || !sig) return false;
  const expected = `v0=${await hmacHex(ZOOM_VIDEO_WEBHOOK_SECRET, `v0:${ts}:${body}`)}`;
  return expected === sig;
}

// Video SDK session events carry `payload.object.session_key` (the value we
// signed into the JWT in zoom-video-sdk-token). We treat session_key as the
// guest_calls.id verbatim.
function sessionKeyFrom(payload: any): string | null {
  return (payload?.object?.session_key as string) ?? null;
}

function topicFrom(payload: any): string | null {
  return (
    (payload?.object?.session_name as string) ??
    (payload?.object?.topic as string) ??
    null
  );
}

// Try session_key first; fall back to topic regex if missing.
async function resolveGuestCallId(payload: any): Promise<string | null> {
  const key = sessionKeyFrom(payload);
  if (key) {
    const { data } = await admin()
      .from("guest_calls")
      .select("id")
      .eq("id", key)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  const topic = topicFrom(payload);
  if (topic && topic.startsWith("relay-session-")) {
    const id = topic.slice("relay-session-".length);
    const { data } = await admin()
      .from("guest_calls")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  return null;
}

async function handleSessionStarted(payload: any): Promise<void> {
  const gcId = await resolveGuestCallId(payload);
  if (!gcId) return;
  const sessionKey = sessionKeyFrom(payload) ?? gcId;
  const startedAt =
    (payload?.object?.start_time as string) ?? new Date().toISOString();

  // Stamp guest_calls.video_started_at (idempotent — only if NULL).
  await admin()
    .from("guest_calls")
    .update({ video_started_at: startedAt })
    .eq("id", gcId)
    .is("video_started_at", null);

  // Look up customer + engineer for the call_sessions upsert.
  const { data: gc } = await admin()
    .from("guest_calls")
    .select("customer_user_id, claimed_by")
    .eq("id", gcId)
    .maybeSingle();

  await admin()
    .from("call_sessions")
    .upsert(
      {
        session_key: sessionKey,
        builder_id:
          (gc as { customer_user_id?: string } | null)?.customer_user_id ??
          null,
        engineer_id: (gc as { claimed_by?: string } | null)?.claimed_by ?? null,
        started_at: startedAt,
        status: "in_progress",
      },
      { onConflict: "session_key" }
    );

  await admin()
    .from("session_video_events")
    .insert({
      guest_call_id: gcId,
      kind: "session_started",
      payload: payload ?? {},
    });
}

async function handleSessionEnded(payload: any): Promise<void> {
  const gcId = await resolveGuestCallId(payload);
  if (!gcId) return;
  const sessionKey = sessionKeyFrom(payload) ?? gcId;
  const endedAt =
    (payload?.object?.end_time as string) ?? new Date().toISOString();

  // Stamp guest_calls.video_ended_at (idempotent).
  await admin()
    .from("guest_calls")
    .update({ video_ended_at: endedAt })
    .eq("id", gcId)
    .is("video_ended_at", null);

  // Look up the call_sessions row we created at session.started.
  const { data: cs } = await admin()
    .from("call_sessions")
    .select("id, started_at, builder_id")
    .eq("session_key", sessionKey)
    .maybeSingle();

  let actualMinutes = 0;
  let billedCredits = 0;
  let csId: string | null = null;
  let builderId: string | null = null;
  if (cs) {
    csId = (cs as { id: string }).id;
    builderId = (cs as { builder_id: string | null }).builder_id ?? null;
    const startedAt = (cs as { started_at: string }).started_at;
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    actualMinutes = Math.max(0, Math.ceil(ms / 60_000));
    billedCredits = Math.round(actualMinutes * CREDITS_PER_MINUTE * 100) / 100;

    await admin()
      .from("call_sessions")
      .update({
        ended_at: endedAt,
        actual_minutes: actualMinutes,
        billed_credits: billedCredits,
        status: "completed",
      })
      .eq("id", csId);
  }

  // Debit credits if we have a billable customer + minutes. Best-effort: a
  // missing builder_id (anonymous guest) means we don't charge anyone; that
  // matches the Meeting SDK side's behaviour.
  if (csId && builderId && billedCredits > 0) {
    try {
      await admin().rpc("debit_credits", {
        _user_id: builderId,
        _amount: billedCredits,
        _reason: "call_charge",
        _request_id: null,
        _call_session_id: csId,
        _description: "Relay video session",
        _metadata: {
          source: "zoom-video-webhook",
          session_key: sessionKey,
          minutes: actualMinutes,
        },
      });
      await admin()
        .from("call_sessions")
        .update({ status: "billed" })
        .eq("id", csId);
    } catch (e) {
      console.error("[zoom-video-webhook] debit_credits failed:", e);
    }
  }

  // System chat message — mirrors zoom-webhook's "Zoom meeting ended" row.
  // Body must contain "Zoom meeting ended" so MeetingChatEntry's pairing
  // logic flips the ongoing card to its ended state on the client.
  await admin()
    .from("guest_messages")
    .insert({
      guest_call_id: gcId,
      sender_kind: "system",
      sender_name: "Relay",
      body: `📞 Zoom meeting ended${actualMinutes ? ` · ${actualMinutes} min` : ""}`,
    });

  await admin()
    .from("session_video_events")
    .insert({
      guest_call_id: gcId,
      kind: "session_ended",
      payload: { actual_minutes: actualMinutes, billed_credits: billedCredits },
    });

  // Chain summarize-guest-call (fire-and-forget).
  try {
    void fetch(`${SUPABASE_URL}/functions/v1/summarize-guest-call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session_id: gcId }),
    });
  } catch {
    /* best-effort */
  }
}

async function handleRecordingCompleted(payload: any): Promise<void> {
  const gcId = await resolveGuestCallId(payload);
  if (!gcId) return;
  const obj = payload?.object ?? {};

  const files: any[] = Array.isArray(obj.recording_files)
    ? obj.recording_files
    : [];
  const videoFile = files.find((f) => f.file_type === "MP4") ?? files[0] ?? {};
  const playUrl: string | null = obj.share_url ?? videoFile.play_url ?? null;
  const password: string | null =
    obj.password ?? obj.recording_play_passcode ?? null;
  const duration: number | null = Number.isFinite(obj.duration)
    ? Number(obj.duration)
    : null;

  await admin()
    .from("guest_calls")
    .update({
      recording_play_url: playUrl,
      recording_password: password,
      duration_minutes: duration,
    })
    .eq("id", gcId);

  await admin()
    .from("session_video_events")
    .insert({
      guest_call_id: gcId,
      kind: "recording_completed",
      payload: {
        play_url: playUrl ? "[set]" : null,
        duration_minutes: duration,
      },
    });

  // Supervisor-only chat row with the recording link — mirrors the existing
  // visibility='supervisor' pattern.
  if (playUrl) {
    await admin()
      .from("guest_messages")
      .insert({
        guest_call_id: gcId,
        sender_kind: "system",
        sender_name: "Relay",
        body: `🎥 Recording available${password ? ` (passcode ${password})` : ""}: ${playUrl}`,
        visibility: "supervisor",
      });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  const body = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // CRC URL-validation challenge (Zoom asks for it once when you save the
  // event-subscription URL).
  if (payload?.event === "endpoint.url_validation") {
    const plainToken = payload?.payload?.plainToken ?? "";
    const encryptedToken = await hmacHex(ZOOM_VIDEO_WEBHOOK_SECRET, plainToken);
    return new Response(JSON.stringify({ plainToken, encryptedToken }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!(await verifyZoomSignature(req, body))) {
    return new Response("Invalid signature", { status: 401 });
  }

  console.log(
    "[zoom-video-webhook] event:",
    payload?.event,
    "session_key:",
    sessionKeyFrom(payload?.payload),
    "topic:",
    topicFrom(payload?.payload)
  );

  try {
    switch (payload?.event) {
      case "session.started":
        await handleSessionStarted(payload.payload);
        break;
      case "session.ended":
        await handleSessionEnded(payload.payload);
        break;
      case "recording.completed":
        await handleRecordingCompleted(payload.payload);
        break;
      default:
        console.log("[zoom-video-webhook] unhandled event:", payload?.event);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[zoom-video-webhook] error:", e);
    return new Response("Error", { status: 500 });
  }
});
