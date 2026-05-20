#!/usr/bin/env node
/**
 * One-shot DB reset for Relay (solo-dev edition).
 *
 * Wipes ALL transactional data + every non-canonical auth user, then
 * re-provisions five demo accounts so you can test the full flow without
 * needing real emails or OTP codes.
 *
 *   ─────────────────────────────────────────────────────────────
 *    Email                                Password         Role
 *   ─────────────────────────────────────────────────────────────
 *    dev.soni@thegatewaycorp.co.in        RelayDev123!     engineer
 *    supervisor.demo@relay.test           RelayDev123!     supervisor
 *    admin.demo@relay.test                RelayDev123!     department_admin
 *    enterprise.demo@relay.test           RelayDev123!     enterprise_admin
 *   ─────────────────────────────────────────────────────────────
 *
 * (No customer demo account — customer sign-in goes through real OTP.)
 *
 * To sign in as any of them, hit /api/dev/sign-in-as?role=engineer (etc).
 * The /login and /staff/login pages have quick-pick buttons wired to it.
 *
 *   node scripts/reset.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../.env.local");
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const [k, ...r] = l.split("="); return [k.trim(), r.join("=").trim()]; })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ────────────────────────────────────────────────────────────────────────
// DEMO ACCOUNTS  ·  Same password for all, dev-only.
// Edit emails here if you want different personas.
// ────────────────────────────────────────────────────────────────────────
export const DEMO_PASSWORD = "RelayDev123!";

const DEMO_USERS = [
  { role: "engineer",   email: "dev.soni@thegatewaycorp.co.in", full_name: "Dev Soni",          primary_role: "engineer",         userRole: "engineer"         },
  { role: "supervisor", email: "supervisor.demo@relay.test",    full_name: "Sam Supervisor",    primary_role: "supervisor",       userRole: "supervisor"       },
  { role: "internal",   email: "admin.demo@relay.test",         full_name: "Iris Internal",     primary_role: "department_admin", userRole: "department_admin" },
  { role: "enterprise", email: "enterprise.demo@relay.test",    full_name: "Eric Enterprise",   primary_role: "enterprise_admin", userRole: "enterprise_admin" },
];
const KEEP_EMAILS = DEMO_USERS.map((u) => u.email);

// ────────────────────────────────────────────────────────────────────────

const PASS = "\x1b[32m✓\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";
const STEP = "\x1b[36m→\x1b[0m";
const log = console.log;

async function main() {
  log("\n\x1b[1mRelay DB reset\x1b[0m\n");

  // ── 1. Wipe transactional data (children first) ─────────────────────
  log(`${STEP} Wiping transactional data…`);
  const tables = [
    "call_sessions", "request_messages", "requests", "request_reads",
    "notifications", "guest_messages", "session_recalls", "session_audit_log",
    "guest_calls", "guest_threads", "customer_entitlements",
    "credit_transactions", "credit_wallets",
  ];
  for (const t of tables) {
    let q = sb.from(t).delete();
    if (t === "session_audit_log") q = q.gte("id", 0);
    else if (t === "request_reads") q = q.neq("user_id", "00000000-0000-0000-0000-000000000000");
    else if (t === "credit_wallets") q = q.neq("user_id", "00000000-0000-0000-0000-000000000000");
    else if (t === "customer_entitlements") q = q.neq("customer_user_id", "00000000-0000-0000-0000-000000000000");
    else q = q.neq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await q;
    if (error) log(`    ${WARN} ${t}: ${error.message}`);
    else log(`    ${PASS} ${t}`);
  }

  // ── 2. Remove auth users not in the demo list ───────────────────────
  log(`\n${STEP} Removing non-canonical auth users…`);
  let removed = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    const users = data?.users ?? [];
    const toRemove = users.filter((u) => !KEEP_EMAILS.includes(u.email ?? ""));
    if (toRemove.length === 0) break;
    for (const u of toRemove) {
      await sb.from("user_roles").delete().eq("user_id", u.id);
      await sb.from("profiles").delete().eq("id", u.id);
      const { error } = await sb.auth.admin.deleteUser(u.id, false);
      if (error) log(`    ${WARN} ${u.email}: ${error.message}`);
      else { log(`    ${PASS} removed ${u.email}`); removed++; }
    }
  }
  log(`    ${removed} removed`);

  // ── 3. Load roles lookup so we can write role_id / primary_role_id ─
  log(`\n${STEP} Loading roles lookup…`);
  const { data: roleRows, error: rolesErr } = await sb.from("roles").select("id, name");
  if (rolesErr) {
    log(`    ${WARN} couldn't load roles lookup: ${rolesErr.message}`);
    log(`    ${WARN} did you apply 20260521120000_roles_lookup_fk.sql?`);
    process.exit(1);
  }
  const roleIds = new Map((roleRows ?? []).map((r) => [r.name, r.id]));

  // ── 4. Ensure all demo users exist + have password + role ──────────
  log(`\n${STEP} Provisioning ${DEMO_USERS.length} demo accounts…`);
  for (const u of DEMO_USERS) {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = data?.users?.find((x) => x.email === u.email);

    let userId;
    if (existing) {
      userId = existing.id;
      // Force-reset the password so it always matches DEMO_PASSWORD
      await sb.auth.admin.updateUserById(userId, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
      });
      log(`    ${PASS} ${u.email}   (existed, password reset)`);
    } else {
      const { data: created, error } = await sb.auth.admin.createUser({
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
      });
      if (error || !created.user) {
        log(`    ${WARN} could not create ${u.email}: ${error?.message}`);
        continue;
      }
      userId = created.user.id;
      log(`    ${PASS} ${u.email}   (created)`);
    }

    // Profile
    const primaryRoleId = roleIds.get(u.primary_role);
    if (!primaryRoleId) {
      log(`    ${WARN} unknown primary role "${u.primary_role}" for ${u.email}, skipping profile upsert`);
      continue;
    }
    await sb.from("profiles").upsert({
      id: userId,
      full_name: u.full_name,
      primary_role_id: primaryRoleId,
      is_onboarded: true,
    });

    // Role (skip for customer)
    if (u.userRole) {
      const roleId = roleIds.get(u.userRole);
      if (!roleId) {
        log(`    ${WARN} unknown role "${u.userRole}" for ${u.email}, skipping role grant`);
        continue;
      }
      await sb.from("user_roles").upsert(
        { user_id: userId, role_id: roleId },
        { onConflict: "user_id,role_id" },
      );
    }
  }

  // ── 5. Final state ──────────────────────────────────────────────────
  log(`\n${STEP} Final state:`);
  const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  log(`  Auth users: ${users?.users?.length ?? 0}`);
  for (const u of (users?.users ?? [])) log(`    · ${u.email}`);
  const { data: roles } = await sb.from("user_role_names").select("role, user_id");
  log(`  user_roles: ${roles?.length ?? 0}`);
  for (const r of (roles ?? [])) log(`    · ${r.role} → ${r.user_id.slice(0, 8)}…`);

  log(`\n\x1b[32mReady.\x1b[0m  One-click staff sign-in:`);
  log(`  https://10.0.1.207:3000/staff/login    → \x1b[36mEngineer / Supervisor / Internal / Enterprise\x1b[0m`);
  log(``);
  log(`  Customer sign-in goes through real OTP at https://10.0.1.207:3000/login`);
  log(``);
  log(`  Or hit the API directly:`);
  log(`    /api/dev/sign-in-as?role=engineer    → engineer dashboard`);
  log(`    /api/dev/sign-in-as?role=supervisor  → supervisor`);
  log(`    /api/dev/sign-in-as?role=internal    → internal admin`);
  log(`    /api/dev/sign-in-as?role=enterprise  → enterprise admin\n`);
}

main().catch((err) => {
  console.error("\n\x1b[31mReset failed:\x1b[0m", err);
  process.exit(1);
});
