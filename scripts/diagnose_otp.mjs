#!/usr/bin/env node
/**
 * Diagnose the OTP / SMTP delivery issue.
 *
 * Steps:
 *   1. Try to send an OTP to a fresh email through the public anon endpoint
 *      (same code path /login and /staff/login use).
 *   2. Report the Supabase response.
 *   3. Try generating a magic-link via admin API as a fallback (this DOESN'T
 *      use SMTP — Supabase returns the link directly).
 *
 * Usage:
 *   node scripts/diagnose_otp.mjs someone@example.com
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

const TEST_EMAIL = process.argv[2];
if (!TEST_EMAIL) {
  console.error("Usage: node scripts/diagnose_otp.mjs <email>");
  process.exit(1);
}

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const STEP = "\x1b[36m→\x1b[0m";

const anon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

console.log(`\n\x1b[1mOTP diagnosis for ${TEST_EMAIL}\x1b[0m\n`);

// ── Step 1: Try the actual OTP send (what the UI does) ─────────────────
console.log(`${STEP} Attempt 1: signInWithOtp (public anon API)`);
const t0 = Date.now();
const r1 = await anon.auth.signInWithOtp({
  email: TEST_EMAIL,
  options: { shouldCreateUser: true },
});
const ms1 = Date.now() - t0;
if (r1.error) {
  console.log(
    `   ${FAIL} ${r1.error.message}  (${r1.error.status ?? "?"})  ${ms1}ms`
  );
  if (r1.error.status === 429) {
    console.log(
      `     ↳ \x1b[33mRate-limited\x1b[0m by Supabase default mailer.`
    );
  } else if (/email rate/i.test(r1.error.message)) {
    console.log(`     ↳ \x1b[33mEmail rate limit\x1b[0m hit.`);
  }
} else {
  console.log(`   ${PASS} Supabase accepted the request  (${ms1}ms)`);
  console.log(
    `     ↳ But this only means the API returned 200. Email may still be silently dropped.`
  );
}

// ── Step 2: Check whether the user got created ─────────────────────────
console.log(`\n${STEP} Did the user land in auth.users?`);
{
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = data?.users?.find((u) => u.email === TEST_EMAIL);
  if (found) {
    console.log(`   ${PASS} user exists: ${found.id}`);
    console.log(`     last_sign_in_at: ${found.last_sign_in_at ?? "never"}`);
    console.log(`     confirmed_at:    ${found.email_confirmed_at ?? "never"}`);
  } else {
    console.log(
      `   ${FAIL} user not created — Supabase rejected the request silently`
    );
  }
}

// ── Step 3: Try admin generateLink (bypasses SMTP completely) ──────────
console.log(`\n${STEP} Generating a magic-link via admin API (no SMTP needed)`);
{
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
    options: {
      redirectTo: "https://10.0.1.207:3000/auth/callback",
    },
  });
  if (error) {
    console.log(`   ${FAIL} ${error.message}`);
  } else if (data?.properties?.action_link) {
    console.log(
      `   ${PASS} magic link ready — paste into a browser to sign in as this user:`
    );
    console.log(`\n\x1b[36m${data.properties.action_link}\x1b[0m\n`);
    console.log(
      `     ↳ This works regardless of SMTP. Use it to unblock other test accounts.`
    );
  }
}

// ── Step 4: Print rate-limit guidance ──────────────────────────────────
console.log(`\n${STEP} Diagnosis summary`);
console.log(`
  Supabase's \x1b[1mdefault\x1b[0m mailer rate-limits to ~3-4 emails/hour per project
  and 1 email/30s per recipient. New recipients are silently dropped once
  the quota's hit — you'll see the API return 200 but the email never arrives.

  Fixes (pick one):

  \x1b[36m1. Use admin generateLink for tests\x1b[0m  ← what I just demoed above
      For seed accounts: scripts/reset.mjs creates users with email_confirm=true,
      then admin.generateLink mints a one-click signin URL. No SMTP involved.

  \x1b[36m2. Configure custom SMTP\x1b[0m (production-grade)
      Supabase Dashboard → Project Settings → Auth → SMTP Settings
      Plug in Resend / SendGrid / Postmark / Mailgun credentials. Once enabled
      the rate limit is gone — quotas come from your SMTP provider.

  \x1b[36m3. Bump Supabase project rate limit\x1b[0m (paid tier)
      Auth → Rate Limits → "Token refresh and confirmation" — needs the Pro
      tier on Supabase.
`);
