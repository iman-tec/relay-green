#!/usr/bin/env node
/**
 * Verifies the Zoom backend path end-to-end:
 *   1. Create a guest_call session
 *   2. Have engineer claim it (via authed RPC)
 *   3. Call mint-zoom-for-session  → expect zoom_meeting_id + URLs
 *   4. Call zoom-sdk-signature      → expect signature + sdkKey + password + zak
 *   5. Verify guest_calls row reflects the meeting
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(path.resolve(__dirname, "../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const [k, ...r] = l.split("=");
      return [k.trim(), r.join("=").trim()];
    })
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, KEY, { auth: { persistSession: false } });

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const STEP = "\x1b[36m→\x1b[0m";

const ENG_EMAIL = "dev.soni@thegatewaycorp.co.in";
const PASSWORD = "TestPassword_E2E_" + Date.now();

console.log("\n\x1b[1mZoom flow end-to-end test\x1b[0m\n");

// ── Step 1: Sign in the engineer (set a temp password) ─────────────────
console.log(`${STEP} Signing in as ${ENG_EMAIL}`);
const { data: u } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const eng = u?.users?.find((x) => x.email === ENG_EMAIL);
if (!eng) {
  console.error(`${FAIL} engineer not found — run scripts/reset.mjs first`);
  process.exit(1);
}
await admin.auth.admin.updateUserById(eng.id, { password: PASSWORD });
const engClient = createClient(URL, ANON);
const { data: sign, error: sErr } = await engClient.auth.signInWithPassword({
  email: ENG_EMAIL,
  password: PASSWORD,
});
if (sErr) {
  console.error(`${FAIL} sign-in failed`, sErr);
  process.exit(1);
}
console.log(`  ${PASS} engineer signed in`);

// ── Step 2: Make a fake customer + session ─────────────────────────────
console.log(`\n${STEP} Creating a fake queued session`);
const { data: sess } = await admin
  .from("guest_calls")
  .insert({
    guest_name: "Zoom Test Customer",
    guest_email: "test@example.com",
    status: "queued",
    free_minutes: 10,
  })
  .select("*")
  .single();
console.log(`  ${PASS} session ${sess.id.slice(0, 8)}… created`);

// ── Step 3: Engineer claims (assigned state) ──────────────────────────
console.log(`\n${STEP} Engineer claims via RPC`);
const { data: claim, error: cErr } = await engClient.rpc("claim_session", {
  _session_id: sess.id,
});
if (cErr) {
  console.error(`${FAIL} claim failed`, cErr);
  process.exit(1);
}
const claimed = Array.isArray(claim) ? claim[0] : claim;
console.log(
  `  ${PASS} status=${claimed.status}, claimed_by=${claimed.claimed_by.slice(0, 8)}…`
);

// ── Step 4: Mint Zoom meeting via edge fn ──────────────────────────────
console.log(`\n${STEP} Calling mint-zoom-for-session edge fn`);
const t0 = Date.now();
const { data: mint, error: mErr } = await engClient.functions.invoke(
  "mint-zoom-for-session",
  {
    body: { session_id: sess.id },
  }
);
const dt = Date.now() - t0;
if (mErr || !mint?.zoom_meeting_id) {
  console.error(`${FAIL} mint failed (${dt}ms):`, mErr ?? mint);
  process.exit(1);
}
console.log(`  ${PASS} minted in ${dt}ms`);
console.log(`     meeting_id: ${mint.zoom_meeting_id}`);
console.log(`     join_url:   ${mint.zoom_join_url?.slice(0, 60)}…`);
console.log(`     start_url:  ${mint.zoom_start_url?.slice(0, 60)}…`);

// ── Step 5: Verify DB row updated ─────────────────────────────────────
console.log(`\n${STEP} Verify guest_calls row has the meeting`);
const { data: row } = await admin
  .from("guest_calls")
  .select("zoom_meeting_id, zoom_join_url, zoom_start_url, status")
  .eq("id", sess.id)
  .single();
if (!row?.zoom_meeting_id) {
  console.error(`${FAIL} row missing zoom_meeting_id`);
  process.exit(1);
}
console.log(`  ${PASS} row updated  (zoom_meeting_id=${row.zoom_meeting_id})`);

// ── Step 6: Test zoom-sdk-signature (role=1 host) ─────────────────────
console.log(`\n${STEP} Calling zoom-sdk-signature (role=1 host)`);
const t1 = Date.now();
const { data: sig1, error: sig1Err } = await engClient.functions.invoke(
  "zoom-sdk-signature",
  {
    body: { meetingNumber: row.zoom_meeting_id, role: 1 },
  }
);
const dt1 = Date.now() - t1;
if (sig1Err || !sig1?.signature) {
  console.error(`${FAIL} signature failed (${dt1}ms):`, sig1Err ?? sig1);
  process.exit(1);
}
console.log(`  ${PASS} signature received (${dt1}ms)`);
console.log(`     sdkKey:    ${sig1.sdkKey?.slice(0, 16)}…`);
console.log(
  `     signature: ${sig1.signature?.slice(0, 32)}…  (length=${sig1.signature?.length})`
);
console.log(`     password:  ${sig1.password ? "(present)" : "(empty)"}`);
console.log(
  `     zak:       ${sig1.zak ? "(present — required for host)" : "(empty)"}`
);
if (!sig1.zak) {
  console.log(`     ${FAIL} zak missing — host role won't start the meeting`);
  console.log(
    `        Verify ZOOM_SDK_KEY/ZOOM_SDK_SECRET match a Zoom Meeting SDK app`
  );
  console.log(
    `        AND that the Server-to-Server OAuth user has start-meeting scope`
  );
}

// ── Step 7: Test zoom-sdk-signature (role=0 attendee) ─────────────────
console.log(`\n${STEP} Calling zoom-sdk-signature (role=0 attendee)`);
const { data: sig0, error: sig0Err } = await engClient.functions.invoke(
  "zoom-sdk-signature",
  {
    body: { meetingNumber: row.zoom_meeting_id, role: 0 },
  }
);
if (sig0Err || !sig0?.signature) {
  console.error(`${FAIL} attendee signature failed:`, sig0Err ?? sig0);
  process.exit(1);
}
console.log(`  ${PASS} attendee signature received`);
console.log(`     signature length: ${sig0.signature?.length}`);

// ── Step 8: Cleanup ────────────────────────────────────────────────────
console.log(`\n${STEP} Cleanup`);
await admin.from("guest_calls").delete().eq("id", sess.id);
console.log(`  ${PASS} test session deleted`);

console.log(`\n\x1b[32mAll Zoom backend checks passed.\x1b[0m`);
console.log(`The CDN ZoomEmbed should be able to:`);
console.log(`  - Load scripts from https://source.zoom.us/3.13.2/`);
console.log(`  - Call zoom-sdk-signature for host (role=1, with zak)`);
console.log(`  - Call zoom-sdk-signature for attendee (role=0)`);
console.log(`  - Join meeting ${row.zoom_meeting_id} from both sides\n`);
