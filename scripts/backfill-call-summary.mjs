/*
 * One-off: invoke summarize-call for the most recent guest_call so the
 * "Call summary" capsule backfills onto a session that ended before the fix.
 *   node scripts/backfill-call-summary.mjs
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;

const recent = await fetch(
  `${url}/rest/v1/guest_calls?select=id,guest_name,created_at,video_started_at,video_ended_at&order=created_at.desc&limit=5`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
).then((r) => r.json());
console.log("Recent guest_calls:");
for (const c of recent) {
  console.log(`  ${c.id}  ${c.guest_name ?? "?"}  video_ended=${c.video_ended_at ?? "—"}`);
}

const target = recent[0];
if (!target) {
  console.log("No guest_calls found.");
  process.exit(0);
}
console.log(`\nInvoking summarize-call for ${target.id} …`);
const res = await fetch(`${url}/functions/v1/summarize-call`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ session_id: target.id }),
});
console.log("Result:", res.status, await res.text());
