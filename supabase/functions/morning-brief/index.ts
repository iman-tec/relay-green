// ============================================================================
// H3 — Morning brief (8am ops digest)
// ============================================================================
// Emails each pod's supervisor (and ops) a digest of:
//   • overnight escalations (session_escalations in the last 24h)
//   • next-24h coverage gaps (availability windows minus holidays)
//   • ended sessions awaiting review (ended, no final sentiment yet)
//
// NOT WIRED YET — deploy + schedule + email provider are on you:
//   1. Deploy:   supabase functions deploy morning-brief --no-verify-jwt
//   2. Env (Edge Function secrets):
//        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (already set for other fns)
//        RESEND_API_KEY        — transactional email (or swap sendEmail for
//                                 your provider / SMTP)
//        MORNING_BRIEF_FROM    — e.g. "Relay Ops <ops@relay.green>"
//        MORNING_BRIEF_OPS_TO  — ops fallback recipient (optional)
//   3. Schedule 08:00 daily — either:
//        • Supabase Dashboard → Edge Functions → Schedules → cron "0 8 * * *", or
//        • pg_cron: SELECT cron.schedule('relay-morning-brief','0 8 * * *',
//            $$ SELECT net.http_post(
//                 url := '<project>.functions.supabase.co/morning-brief',
//                 headers := jsonb_build_object('Authorization','Bearer <service_role>')
//               ) $$);
//
// Without RESEND_API_KEY it computes the digest and logs it (no send), so a
// manual invoke is safe to smoke-test before email is wired.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("MORNING_BRIEF_FROM") ?? "Relay Ops <ops@relay.green>";
const OPS_TO = Deno.env.get("MORNING_BRIEF_OPS_TO") ?? "";

const OPEN_HOUR = 8, CLOSE_HOUR = 22;

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.log(`[morning-brief] (no RESEND_API_KEY) would email ${to}: ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) console.error(`[morning-brief] email to ${to} failed: ${res.status} ${await res.text()}`);
}

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = new Date();
  const since24 = new Date(now.getTime() - 24 * 3_600_000).toISOString();

  // Pods + their supervisors + engineers.
  const { data: pods } = await admin.from("pods").select("id, name");
  const { data: members } = await admin.from("pod_members").select("pod_id, user_id, pod_role");
  const supByPod = new Map<string, string[]>();
  const engByPod = new Map<string, string[]>();
  for (const m of (members ?? []) as { pod_id: string; user_id: string; pod_role: string }[]) {
    const map = m.pod_role === "supervisor" ? supByPod : m.pod_role === "engineer" ? engByPod : null;
    if (!map) continue;
    if (!map.has(m.pod_id)) map.set(m.pod_id, []);
    map.get(m.pod_id)!.push(m.user_id);
  }

  // Auth emails for supervisors.
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map<string, string>();
  for (const u of authList?.users ?? []) if (u.id && u.email) emailById.set(u.id, u.email);

  let sent = 0;
  for (const pod of (pods ?? []) as { id: string; name: string }[]) {
    const engIds = engByPod.get(pod.id) ?? [];
    const supIds = supByPod.get(pod.id) ?? [];
    if (engIds.length === 0 && supIds.length === 0) continue;

    // Overnight escalations.
    const { data: escs } = engIds.length
      ? await admin.from("session_escalations").select("reason, status, created_at").in("engineer_user_id", engIds).gte("created_at", since24)
      : { data: [] };
    // Ended sessions awaiting review (no final sentiment yet).
    const { data: ended } = engIds.length
      ? await admin.from("guest_calls").select("id").in("claimed_by", engIds).eq("status", "ended").is("final_sentiment_score", null).gte("ended_at", since24)
      : { data: [] };
    // Next-24h coverage: tomorrow's weekday windows minus holidays.
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const weekday = tomorrow.getUTCDay();
    const [{ data: wins }, { data: hols }] = await Promise.all([
      engIds.length ? admin.from("engineer_availability_windows").select("engineer_user_id, start_minute, end_minute").in("engineer_user_id", engIds).eq("weekday", weekday) : Promise.resolve({ data: [] }),
      engIds.length ? admin.from("engineer_holidays").select("engineer_user_id").in("engineer_user_id", engIds).eq("holiday_date", dateStr) : Promise.resolve({ data: [] }),
    ]);
    const onHoliday = new Set((hols ?? []).map((h: { engineer_user_id: string }) => h.engineer_user_id));
    const gaps: string[] = [];
    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
      const covered = ((wins ?? []) as { engineer_user_id: string; start_minute: number; end_minute: number }[])
        .some((w) => !onHoliday.has(w.engineer_user_id) && w.start_minute < (h + 1) * 60 && w.end_minute > h * 60);
      if (!covered) gaps.push(`${String(h).padStart(2, "0")}:00`);
    }

    const escCount = (escs ?? []).length;
    const reviewCount = (ended ?? []).length;
    const html = `
      <h2>Relay — ${pod.name} morning brief</h2>
      <p><strong>Overnight escalations:</strong> ${escCount}</p>
      <p><strong>Sessions awaiting review:</strong> ${reviewCount}</p>
      <p><strong>Coverage gaps tomorrow (${dateStr}):</strong> ${gaps.length ? gaps.join(", ") : "none"}</p>
    `;
    const subject = `Relay brief — ${pod.name}: ${escCount} escalations, ${gaps.length} coverage gaps`;

    const recipients = supIds.map((id) => emailById.get(id)).filter(Boolean) as string[];
    if (OPS_TO) recipients.push(OPS_TO);
    for (const to of [...new Set(recipients)]) { await sendEmail(to, subject, html); sent++; }
  }

  return new Response(JSON.stringify({ ok: true, briefsSent: sent }), { headers: { "Content-Type": "application/json" } });
});
