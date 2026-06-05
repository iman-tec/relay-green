/*
 * Deletes the legacy demo project names ("dev soni", "dev.soni",
 * "new-project") for dev.soni@thegatewaycorp.co.in. The "project" project
 * (current default) is preserved. Sessions previously linked to deleted
 * projects keep their guest_calls row — projects.id is FK'd with
 * ON DELETE SET NULL, so they just fall back to the General bucket.
 *
 *   npx tsx scripts/cleanup-stale-projects.ts
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const OWNER_EMAIL = "dev.soni@thegatewaycorp.co.in";
const NAMES_TO_DELETE = ["dev soni", "dev.soni", "new-project"];

type AdminClient = SupabaseClient<any, "public", "public", any, any>;

async function findUserId(
  admin: AdminClient,
  email: string
): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (
    data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())
      ?.id ?? null
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );

  const admin = createClient(url, key, {
    auth: { persistSession: false },
  }) as AdminClient;

  const ownerId = await findUserId(admin, OWNER_EMAIL);
  if (!ownerId) {
    throw new Error(`Couldn't find ${OWNER_EMAIL}.`);
  }
  console.log(`→ Owner ${OWNER_EMAIL} (${ownerId})`);

  const { data: projects } = await admin
    .from("projects")
    .select("id, name")
    .eq("customer_id", ownerId);
  const all = (projects ?? []) as { id: string; name: string }[];

  const lowered = new Set(NAMES_TO_DELETE.map((n) => n.toLowerCase()));
  const doomed = all.filter((p) => lowered.has(p.name.toLowerCase()));

  if (doomed.length === 0) {
    console.log("  • Nothing to delete.");
    return;
  }

  console.log(
    `→ Deleting ${doomed.length} stale project${doomed.length === 1 ? "" : "s"}:`
  );
  for (const p of doomed) {
    const { error } = await admin.from("projects").delete().eq("id", p.id);
    if (error) console.warn(`  ⚠ ${p.name}: ${error.message}`);
    else console.log(`  ✓ ${p.name} (${p.id})`);
  }
  console.log("");
  console.log(
    "Sessions previously linked to those projects now sit under General."
  );
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
