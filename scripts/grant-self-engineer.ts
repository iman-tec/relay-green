/*
 * Quick demo helper: grants the engineer role to dev.soni and adds them
 * to Pod Alpha so the demo supervisor (Sam) sees them, and the customer
 * matcher can dispatch real calls to you.
 *
 *   npx tsx scripts/grant-self-engineer.ts
 *
 * Idempotent. Safe to re-run.
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type AdminClient = SupabaseClient<any, "public", "public", any, any>;

const TARGET_EMAIL = "dev.soni@thegatewaycorp.co.in";
const POD_NAME     = "Alpha";

async function findUserId(admin: AdminClient, email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } }) as AdminClient;

  const userId = await findUserId(admin, TARGET_EMAIL);
  if (!userId) throw new Error(`${TARGET_EMAIL} not found.`);
  console.log(`→ ${TARGET_EMAIL} (${userId})`);

  // 1. Grant engineer role (additive — keeps super_admin etc).
  const { error: rErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "engineer" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  if (rErr) throw new Error(`role grant failed: ${rErr.message}`);
  console.log("  ✓ engineer role granted");

  // 2. Make sure they look claimable to the matcher: status='available' on
  //    the engineer_status row (if that table exists in this build).
  await admin
    .from("engineer_status")
    .upsert({ user_id: userId, status: "available" }, { onConflict: "user_id" })
    .then((r) => {
      if (r.error) console.log(`  • engineer_status upsert skipped: ${r.error.message}`);
      else console.log("  ✓ engineer_status = available");
    });

  // 3. Resolve Pod Alpha and put the user in it as an engineer.
  const { data: pod } = await admin
    .from("pods")
    .select("id")
    .eq("name", POD_NAME)
    .is("archived_at", null)
    .maybeSingle();
  if (!pod) throw new Error(`Pod "${POD_NAME}" not found.`);

  const { error: pErr } = await admin
    .from("pod_members")
    .upsert(
      { pod_id: (pod as { id: string }).id, user_id: userId, pod_role: "engineer" },
      { onConflict: "user_id" },
    );
  if (pErr) throw new Error(`pod_members upsert failed: ${pErr.message}`);
  console.log(`  ✓ added to Pod ${POD_NAME} as engineer`);

  console.log("");
  console.log("Done. Sign in as dev.soni and you'll have:");
  console.log("  - super_admin (existing) → /admin");
  console.log("  - engineer    (new)      → /dashboard, can claim incoming calls");
  console.log("  - pod member  (new)      → Sam's Operations table will list you");
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
