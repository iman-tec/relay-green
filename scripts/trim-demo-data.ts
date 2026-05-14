/*
 * Trims the demo install down to the minimum org hierarchy the UI
 * expects:
 *
 *   Internal Admin (Iris)
 *     Pod Alpha — Supervisor Sam + Engineer Alex
 *     Pod Beta  — Supervisor Beth + Engineer Ben
 *
 * Deletes the surplus seeded accounts (Aria, Bree, Sienna, Steve, Ed,
 * Erin) and clears out past + waiting guest_calls so the Supervise pit
 * and Finance pages start clean.
 *
 * Idempotent: skips users that are already gone.
 *
 *   npx tsx scripts/trim-demo-data.ts
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type AdminClient = SupabaseClient<any, "public", "public", any, any>;

const USERS_TO_DELETE = [
  // Surplus engineers from bootstrap-org-hierarchy
  "engineer.alpha2@relay.test",   // Aria
  "engineer.beta2@relay.test",    // Bree
  // Entire bootstrap-enterprise-staff set (duplicates the pod hierarchy)
  "enterprise.sup1@demoent.test", // Sienna
  "enterprise.sup2@demoent.test", // Steve
  "enterprise.eng1@demoent.test", // Ed
  "enterprise.eng2@demoent.test", // Erin
];

// Anything that isn't a live call — wipes both the demo backlog and any
// stuck queue rows so the UI lands on an empty pit.
const SESSION_STATUSES_TO_DELETE = [
  "queued", "assigned",                       // waiting
  "ended", "cancelled", "abandoned",          // past
  "expired_free", "joining", "grace",         // other terminal-ish
];

async function findUserId(admin: AdminClient, email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } }) as AdminClient;

  console.log("→ Deleting surplus demo users…");
  for (const email of USERS_TO_DELETE) {
    const id = await findUserId(admin, email);
    if (!id) {
      console.log(`  • ${email} — already gone`);
      continue;
    }

    // Best-effort cleanup of rows that don't cascade from auth.users:
    // pod_members + user_roles + org_compensation + profiles.
    await admin.from("pod_members").delete().eq("user_id", id);
    await admin.from("user_roles").delete().eq("user_id", id);
    await admin.from("org_compensation").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("id", id);

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`  ⚠ ${email}: ${error.message}`);
    else console.log(`  ✓ ${email} deleted`);
  }

  console.log("→ Clearing past + waiting sessions…");
  // Fetch ids first so we can also wipe child rows the FKs may not cover.
  const { data: doomed } = await admin
    .from("guest_calls")
    .select("id")
    .in("status", SESSION_STATUSES_TO_DELETE);
  const ids = (doomed ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    console.log("  • No sessions to delete.");
  } else {
    await admin.from("session_health").delete().in("session_id", ids);
    await admin.from("session_audit_log").delete().in("session_id", ids);
    const { error } = await admin.from("guest_calls").delete().in("id", ids);
    if (error) console.warn(`  ⚠ delete failed: ${error.message}`);
    else console.log(`  ✓ ${ids.length} session${ids.length === 1 ? "" : "s"} deleted`);
  }

  console.log("");
  console.log("✓ Demo trimmed to:");
  console.log("    Internal Admin   admin.demo@relay.test            (Iris Internal)");
  console.log("    Pod Alpha");
  console.log("      Supervisor     supervisor.demo@relay.test       (Sam Supervisor)");
  console.log("      Engineer       engineer.alpha1@relay.test       (Alex Alpha One)");
  console.log("    Pod Beta");
  console.log("      Supervisor     supervisor.beta@relay.test       (Beth Supervisor)");
  console.log("      Engineer       engineer.beta1@relay.test        (Ben Beta One)");
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
