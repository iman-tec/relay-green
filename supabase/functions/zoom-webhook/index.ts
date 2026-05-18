// Zoom webhook: handles meeting.started / meeting.ended and bills credits per minute.
// Rate: $30/hr at $0.03/credit  =>  1000 credits/hr  =>  ~16.6667 credits/min.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZOOM_WEBHOOK_SECRET_TOKEN = Deno.env.get("ZOOM_WEBHOOK_SECRET_TOKEN") ?? "";

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
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyZoomSignature(req: Request, body: string): Promise<boolean> {
  if (!ZOOM_WEBHOOK_SECRET_TOKEN) return true; // allow during local setup
  const ts = req.headers.get("x-zm-request-timestamp") ?? "";
  const sig = req.headers.get("x-zm-signature") ?? "";
  if (!ts || !sig) return false;
  const message = `v0:${ts}:${body}`;
  const expected = `v0=${await hmacHex(ZOOM_WEBHOOK_SECRET_TOKEN, message)}`;
  return expected === sig;
}

async function handleMeetingStarted(payload: any) {
  const obj = payload.object ?? {};
  const zoomId = String(obj.id ?? "");
  if (!zoomId) return;

  // Find the matching message + request
  const { data: msg } = await admin()
    .from("request_messages")
    .select("id, request_id, sender_id")
    .eq("meeting_zoom_id", zoomId)
    .maybeSingle();
  if (!msg) {
    console.log("No matching request_message for zoom id", zoomId);
    return;
  }
  const { data: reqRow } = await admin()
    .from("requests")
    .select("id, builder_id, assigned_engineer_id")
    .eq("id", msg.request_id)
    .maybeSingle();
  if (!reqRow) return;

  const startedAt = obj.start_time ? new Date(obj.start_time).toISOString() : new Date().toISOString();

  await admin().from("call_sessions").upsert(
    {
      zoom_meeting_id: zoomId,
      request_id: reqRow.id,
      message_id: msg.id,
      builder_id: reqRow.builder_id,
      engineer_id: reqRow.assigned_engineer_id ?? msg.sender_id,
      started_at: startedAt,
      status: "in_progress",
    },
    { onConflict: "zoom_meeting_id" },
  );
}

async function handleMeetingEnded(payload: any) {
  const obj = payload.object ?? {};
  const zoomId = String(obj.id ?? "");
  console.log("[meeting.ended] received — zoomId:", JSON.stringify(zoomId), "uuid:", obj.uuid);
  if (!zoomId) {
    console.log("[meeting.ended] empty zoomId, aborting");
    return;
  }

  // Path A — anonymous guest sessions. The Relay session keeps running
  // (chat continues, free/paid timer keeps ticking); we just notify the
  // chat so the join card flips to "Meeting ended". Session status is
  // intentionally NOT changed here — that's owned by the engineer's End
  // button and the free/paid timer expiry.
  const { data: gc, error: gcErr } = await admin()
    .from("guest_calls")
    .select("id")
    .eq("zoom_meeting_id", zoomId)
    .maybeSingle();
  if (gcErr) console.error("[meeting.ended] guest_calls lookup error:", gcErr);
  console.log("[meeting.ended] guest_calls match:", gc ? gc.id : "NONE");
  if (gc) {
    // Dedupe — if Zoom retries the webhook delivery, only emit one banner
    // per "live → ended" transition. Once the engineer restarts, mint posts
    // a fresh "started" message so subsequent "ended" events fall through
    // this check (the previous "ended" is older than the new "started").
    const { data: lastStart } = await admin()
      .from("guest_messages")
      .select("created_at")
      .eq("guest_call_id", gc.id)
      .eq("sender_kind", "system")
      .ilike("body", "%Zoom meeting started%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: lastEnd } = await admin()
      .from("guest_messages")
      .select("created_at")
      .eq("guest_call_id", gc.id)
      .eq("sender_kind", "system")
      .ilike("body", "%Zoom meeting ended%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const alreadyEnded = !!lastEnd && (!lastStart || new Date(lastEnd.created_at) > new Date(lastStart.created_at));
    if (!alreadyEnded) {
      const { error: insErr } = await admin().from("guest_messages").insert({
        guest_call_id: gc.id,
        sender_kind: "system",
        sender_name: "Relay",
        body: "📞 Zoom meeting ended",
      });
      if (insErr) console.error("[meeting.ended] insert system message failed:", insErr);
      else console.log("[meeting.ended] system message inserted for gc", gc.id);
    } else {
      console.log("[meeting.ended] already ended since last start, skipping");
    }
    return;
  }

  // Path B — logged-in request flow (call_sessions / billing).
  const { data: session } = await admin()
    .from("call_sessions")
    .select("*")
    .eq("zoom_meeting_id", zoomId)
    .maybeSingle();
  if (!session) {
    console.log("No call_session for zoom id", zoomId);
    return;
  }
  if (session.status === "billed") {
    console.log("Already billed", zoomId);
    return;
  }

  const endedAt = obj.end_time ? new Date(obj.end_time).toISOString() : new Date().toISOString();
  const startedAt = session.started_at ?? obj.start_time ?? endedAt;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const minutes = Math.max(0, ms / 60000);
  // Round up to next minute for fairness/predictability
  const billedMinutes = Math.ceil(minutes);
  const billedCredits = +(billedMinutes * CREDITS_PER_MINUTE).toFixed(2);

  await admin()
    .from("call_sessions")
    .update({
      ended_at: endedAt,
      actual_minutes: billedMinutes,
      billed_credits: billedCredits,
      status: "completed",
    })
    .eq("id", session.id);

  if (billedCredits > 0) {
    const { error } = await admin().rpc("debit_credits", {
      _user_id: session.builder_id,
      _amount: billedCredits,
      _reason: "call_charge",
      _request_id: session.request_id,
      _call_session_id: session.id,
      _description: `Zoom call (${billedMinutes} min)`,
      _metadata: { zoom_meeting_id: zoomId, minutes: billedMinutes },
    });
    if (error) {
      console.error("debit_credits failed:", error);
      return;
    }
  }

  // Post a system message in the chat summarizing the call
  const creditsLabel = Math.round(billedCredits).toLocaleString();
  const summary = billedMinutes > 0
    ? `📞 Zoom call ended · ${billedMinutes} min · ${creditsLabel} credits used`
    : `📞 Zoom call ended`;
  await admin().from("request_messages").insert({
    request_id: session.request_id,
    sender_id: session.engineer_id ?? session.builder_id,
    body: summary,
    message_type: "system",
  });

  await admin().from("call_sessions").update({ status: "billed" }).eq("id", session.id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Zoom URL validation challenge (CRC)
  if (payload.event === "endpoint.url_validation") {
    const plainToken = payload.payload?.plainToken ?? "";
    const encryptedToken = await hmacHex(ZOOM_WEBHOOK_SECRET_TOKEN, plainToken);
    return new Response(
      JSON.stringify({ plainToken, encryptedToken }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const valid = await verifyZoomSignature(req, body);
  if (!valid) return new Response("Invalid signature", { status: 401 });

  // Diagnostic: log every incoming event name + the object keys so we can
  // confirm whether meeting.summary_completed is arriving from Zoom and what
  // shape it has. Search Supabase edge logs for "[zoom-webhook] event".
  console.log(
    "[zoom-webhook] event:", payload.event,
    "objectKeys:", Object.keys(payload?.payload?.object ?? {}),
    "meetingId:", payload?.payload?.object?.id ?? payload?.payload?.object?.meeting_id ?? null,
  );

  try {
    if (payload.event === "meeting.started") {
      await handleMeetingStarted(payload.payload);
    } else if (payload.event === "meeting.ended") {
      await handleMeetingEnded(payload.payload);
    } else if (payload.event === "recording.completed") {
      await handleRecordingCompleted(payload.payload);
    } else if (
      payload.event === "meeting.summary_completed" ||
      payload.event === "meeting_summary.completed"
    ) {
      await handleSummaryCompleted(payload.payload);
    } else {
      console.log("Unhandled zoom event:", payload.event);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("zoom-webhook error:", e);
    return new Response("Error", { status: 500 });
  }
});

async function handleRecordingCompleted(payload: any) {
  const obj = payload.object ?? {};
  const zoomId = String(obj.id ?? "");
  if (!zoomId) return;

  const files: any[] = Array.isArray(obj.recording_files) ? obj.recording_files : [];
  const videoFile = files.find((f) => f.file_type === "MP4") ?? files[0] ?? {};
  const playUrl: string | null = obj.share_url ?? videoFile.play_url ?? null;
  const downloadUrl: string | null = videoFile.download_url ?? null;
  const password: string | null = obj.password ?? obj.recording_play_passcode ?? null;
  const duration: number | null = Number.isFinite(obj.duration) ? Number(obj.duration) : null;

  // Path A: anonymous guest sessions. Recording URL / passcode / duration
  // are persisted on guest_calls. We also post a supervisor-only system
  // line into the chat so pod_leads / ops_managers / admins viewing the
  // shared timeline see the artifact inline; the customer/engineer client
  // filters visibility='supervisor' rows out so the link never reaches them.
  const { data: gc } = await admin()
    .from("guest_calls")
    .select("id")
    .eq("zoom_meeting_id", zoomId)
    .maybeSingle();
  if (gc) {
    // Cloud recording is now in place, but the AI Companion summary is a
    // separate event that arrives 1-5 min later. If the session is sitting
    // in waiting_for_transcript, advance it to generating_zoom_summary so
    // the UI shows the "Zoom summary in progress" copy.
    const { data: gcState } = await admin()
      .from("guest_calls")
      .select("summary_state")
      .eq("id", gc.id)
      .maybeSingle();
    const update: Record<string, unknown> = {
      recording_play_url: playUrl,
      recording_password: password,
      duration_minutes: duration,
    };
    if ((gcState as { summary_state?: string } | null)?.summary_state === "waiting_for_transcript") {
      update.summary_state = "generating_zoom_summary";
      update.summary_state_updated_at = new Date().toISOString();
    }
    await admin()
      .from("guest_calls")
      .update(update)
      .eq("id", gc.id);
    if (playUrl) {
      const passLine = password ? `\nPasscode: ${password}` : "";
      await admin().from("guest_messages").insert({
        guest_call_id: gc.id,
        sender_kind: "system",
        sender_name: "Relay",
        body: `🎥 Recording available: ${playUrl}${passLine}`,
        visibility: "supervisor",
      });
    }
    return;
  }

  // Path B: logged-in request flow. Persist to call_recordings (incl.
  // builder_id / engineer_id from the matched session or the request) for
  // the supervisor view. No chat side-effect — suppressed as above.
  const { data: msg } = await admin()
    .from("request_messages")
    .select("id, request_id")
    .eq("meeting_zoom_id", zoomId)
    .maybeSingle();
  if (!msg) {
    console.log("No matching record for recording", zoomId);
    return;
  }
  const { data: session } = await admin()
    .from("call_sessions")
    .select("id, builder_id, engineer_id")
    .eq("zoom_meeting_id", zoomId)
    .maybeSingle();
  let builderId: string | null = session?.builder_id ?? null;
  let engineerId: string | null = session?.engineer_id ?? null;
  if (!builderId || !engineerId) {
    const { data: reqRow } = await admin()
      .from("requests")
      .select("builder_id, assigned_engineer_id")
      .eq("id", msg.request_id)
      .maybeSingle();
    builderId = builderId ?? reqRow?.builder_id ?? null;
    engineerId = engineerId ?? reqRow?.assigned_engineer_id ?? null;
  }

  await admin().from("call_recordings").upsert(
    {
      call_session_id: session?.id ?? null,
      request_id: msg.request_id,
      zoom_meeting_id: zoomId,
      recording_play_url: playUrl,
      recording_download_url: downloadUrl,
      recording_password: password,
      duration_minutes: duration,
      recording_files: files,
      builder_id: builderId,
      engineer_id: engineerId,
    },
    { onConflict: "zoom_meeting_id" },
  );
}

async function handleSummaryCompleted(payload: any) {
  const obj = payload.object ?? payload;
  const zoomId = String(obj.meeting_id ?? obj.id ?? "");
  if (!zoomId) return;

  const title: string | null = obj.summary_title ?? obj.meeting_topic ?? null;
  const overview: string | null = obj.summary_overview ?? obj.summary_content ?? null;
  const details = obj.summary_details ?? obj.summary ?? null;
  const nextSteps = obj.next_steps ?? null;

  // Path A: anonymous guest sessions.
  //
  // We deliberately do NOT touch guest_calls.ai_summary_* here — those are
  // owned by the session-level summary (summarize-guest-call → OpenAI),
  // which runs once at session end and aggregates across every call. The
  // per-call summary from Zoom AI Companion lives as a system chat message
  // so each call's summary is preserved in the timeline, not overwritten
  // on the session row.
  const { data: gc } = await admin()
    .from("guest_calls")
    .select("id, thread_id, status")
    .eq("zoom_meeting_id", zoomId)
    .maybeSingle();
  if (gc) {
    const lines: string[] = ["🤖 AI Companion summary"];
    if (title) lines.push(title);
    if (overview) lines.push(overview);
    if (Array.isArray(nextSteps) && nextSteps.length > 0) {
      lines.push("\nNext steps:");
      for (const step of nextSteps) {
        const text = typeof step === "string" ? step : step?.text ?? step?.description;
        if (text) lines.push(`• ${text}`);
      }
    }
    const summaryBody = lines.join("\n");
    // Dedupe: Zoom retries the webhook on non-2xx / timeout, and sometimes
    // fires both meeting.summary_completed and meeting_summary.completed for
    // the same call. Without this check we end up with N identical AI
    // Companion summary rows for the same meeting.
    const { data: existingSummary } = await admin()
      .from("guest_messages")
      .select("id")
      .eq("guest_call_id", gc.id)
      .eq("sender_kind", "system")
      .eq("body", summaryBody)
      .limit(1)
      .maybeSingle();
    if (existingSummary) {
      console.log("[meeting.summary_completed] duplicate body, skipping insert for gc", gc.id);
      return;
    }
    await admin().from("guest_messages").insert({
      guest_call_id: gc.id,
      sender_kind: "system",
      sender_name: "Relay",
      body: summaryBody,
    });

    if (gc.thread_id) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/regenerate-guest-brief`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ thread_id: gc.thread_id }),
        });
      } catch (e) {
        console.error("brief refresh failed:", e);
      }
    }

    // Re-summarize the session if it's already ended. The Zoom AI Companion
    // typically lands 1-5 minutes after end-time, so the original
    // summarize-guest-call run had nothing but chat (or nothing at all).
    // Re-running now gives the model the call-side observations and
    // produces a real summary. The receiving function detects status==='ended'
    // and only refreshes the summary fields — no duplicate Session-ended
    // chips, no double-counted minutes, no second sentiment row.
    if (gc.status === "ended") {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/summarize-guest-call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ guest_call_id: gc.id }),
        });
      } catch (e) {
        console.error("[meeting.summary_completed] refresh summarize-guest-call failed:", e);
      }
    }
    return;
  }

  // Path B: logged-in request flow
  const { data: msg } = await admin()
    .from("request_messages")
    .select("id, request_id")
    .eq("meeting_zoom_id", zoomId)
    .maybeSingle();
  if (!msg) {
    console.log("No matching record for summary", zoomId);
    return;
  }
  const { data: session } = await admin()
    .from("call_sessions")
    .select("id")
    .eq("zoom_meeting_id", zoomId)
    .maybeSingle();

  await admin().from("call_recordings").upsert(
    {
      call_session_id: session?.id ?? null,
      request_id: msg.request_id,
      zoom_meeting_id: zoomId,
      ai_summary_title: title,
      ai_summary_overview: overview,
      ai_summary_details: details,
      ai_next_steps: nextSteps,
    },
    { onConflict: "zoom_meeting_id" },
  );

  const lines: string[] = ["🤖 **AI Companion summary**"];
  if (title) lines.push(`**${title}**`);
  if (overview) lines.push(overview);
  if (Array.isArray(nextSteps) && nextSteps.length > 0) {
    lines.push("\n**Next steps:**");
    for (const step of nextSteps) {
      const text = typeof step === "string" ? step : step?.text ?? step?.description;
      if (text) lines.push(`• ${text}`);
    }
  }
  await admin().from("request_messages").insert({
    request_id: msg.request_id,
    sender_id: null,
    body: lines.join("\n"),
    message_type: "system",
  });
}

