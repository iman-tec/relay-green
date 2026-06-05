/*
 * Read-only check for the Whisper transcription pipeline.
 * Prints the most recent session_captions rows so we can confirm
 * transcribe-chunk is inserting voice transcript.
 *
 *   node scripts/check-captions.mjs
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env"
  );
  process.exit(1);
}

const res = await fetch(
  `${url}/rest/v1/session_captions?select=created_at,session_id,speaker,text,window_start,window_end&order=created_at.desc&limit=20`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }
);
if (!res.ok) {
  console.error("Query failed:", res.status, await res.text());
  process.exit(1);
}
const rows = await res.json();
console.log(`\n${rows.length} most-recent session_captions rows:\n`);
for (const r of rows) {
  console.log(
    `[${r.created_at}] session=${r.session_id.slice(0, 8)} speaker=${r.speaker ?? "—"}\n   "${r.text}"\n`
  );
}
