/*
 * One-shot: delete every guest_calls row owned by a customer (by email).
 *
 * Usage:
 *   npx tsx scripts/clear-customer-sessions.ts <email>
 *
 * Examples:
 *   npx tsx scripts/clear-customer-sessions.ts rutul.trivedi@thegatewaycorp.co.in
 *   npx tsx scripts/clear-customer-sessions.ts -- --dry rutul.trivedi@thegatewaycorp.co.in
 *
 * Flags:
 *   --dry          Print what would be deleted, don't actually delete.
 *
 * Idempotent: if there's nothing to delete, exits 0 with a "0 rows" note.
 * Cascade clears guest_messages, session_events, session_health, etc.
 *
 * Prereqs: .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

async function main() {
  const args  = process.argv.slice(2);
  const dry   = args.includes("--dry");
  const email = args.find((a) => !a.startsWith("--"));

  if (!email) {
    console.error("Usage: npx tsx scripts/clear-customer-sessions.ts [--dry] <email>");
    process.exit(2);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Resolve email → user_id via auth admin API (no profiles dependency).
  const { data: page, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  const match = page?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!match) {
    console.error(`✗ No auth user found for ${email}`);
    process.exit(1);
  }
  const userId = match.id;
  console.log(`→ ${email} = ${userId}`);

  // 2) Count first — both as customer and as engineer — show the user what's coming.
  const [{ count: asCustomer }, { count: asEngineer }] = await Promise.all([
    sb.from("guest_calls").select("id", { count: "exact", head: true }).eq("customer_user_id", userId),
    sb.from("guest_calls").select("id", { count: "exact", head: true }).eq("claimed_by", userId),
  ]);
  console.log(`  • ${asCustomer ?? 0} sessions as customer`);
  console.log(`  • ${asEngineer ?? 0} sessions as engineer (claimed_by — NOT touched)`);

  if ((asCustomer ?? 0) === 0) {
    console.log("✓ Nothing to delete.");
    return;
  }

  if (dry) {
    console.log(`(dry run) would delete ${asCustomer} customer sessions.`);
    return;
  }

  // 3) Delete. Cascade handles guest_messages, session_events, session_health, etc.
  const { data: deleted, error: delErr } = await sb
    .from("guest_calls")
    .delete()
    .eq("customer_user_id", userId)
    .select("id");
  if (delErr) throw new Error(`delete failed: ${delErr.message}`);

  console.log(`✓ Deleted ${deleted?.length ?? 0} session row(s).`);
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
