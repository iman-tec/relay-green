#!/usr/bin/env node
/*
 * One-shot: delete every row from public.guest_calls.
 *
 * FK constraints on guest_messages / session_events / etc. are ON DELETE
 * CASCADE, so dependent rows go with them. Bypasses RLS via the
 * service-role key.
 *
 * Usage:   node scripts/clear-all-sessions.mjs
 * Env:     NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from
 *          .env.local automatically).
 */
import fs from "node:fs";
import path from "node:path";

// Load .env.local manually — Node doesn't read it by default.
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal,count=exact",
};

async function deleteAll(table) {
  // PostgREST requires a filter on DELETE — use `id=not.is.null` to match all rows.
  const res = await fetch(`${url}/rest/v1/${table}?id=not.is.null`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DELETE ${table} → ${res.status} ${body.slice(0, 200)}`);
  }
  const range = res.headers.get("content-range") ?? "";
  return range.split("/")[1] ?? "?";
}

(async () => {
  console.log("Clearing guest_calls (cascades to messages / events / etc.)…");
  const count = await deleteAll("guest_calls");
  console.log(`  deleted ${count} guest_calls row(s).`);
  console.log("Done.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
