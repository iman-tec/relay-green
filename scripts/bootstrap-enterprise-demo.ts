/*
 * One-time fix for the Enterprise Admin dev shortcut.
 *
 * Before the /enterprise console existed, the seeded Eric Enterprise
 * (enterprise.demo@relay.test) had role='admin' with no organization.
 * The new /api/enterprise/* routes require:
 *   - enterprise_admin role
 *   - profiles.organization_id ≠ NULL
 *
 * This script:
 *   1. Ensures a "Demo Enterprise Co" organization exists
 *   2. Grants enterprise_admin to Eric (additive — keeps existing roles)
 *   3. Binds Eric's profile to that org
 *
 * Idempotent. Run after `scripts/reset.mjs` whenever the demo accounts
 * are recreated.
 *
 *   npx tsx scripts/bootstrap-enterprise-demo.ts
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ENTERPRISE_DEMO_EMAIL = "enterprise.demo@relay.test";
const DEMO_ORG_NAME = "Demo Enterprise Co";

type AdminClient = SupabaseClient<any, "public", "public", any, any>;

const CROCKFORD = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
function randSegment(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  }
  return out;
}

async function ensureOrg(
  admin: AdminClient
): Promise<{ id: string; name: string; code: string }> {
  const { data: existing } = await admin
    .from("organizations")
    .select("id, name, enterprise_code")
    .eq("name", DEMO_ORG_NAME)
    .maybeSingle();
  if (existing) {
    console.log(
      `  → org exists (${existing.id}) code=${existing.enterprise_code}`
    );
    return {
      id: existing.id,
      name: existing.name,
      code: existing.enterprise_code,
    };
  }
  const slug = DEMO_ORG_NAME.toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const code = `${slug}-${randSegment(4)}-${randSegment(4)}`;
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: DEMO_ORG_NAME, enterprise_code: code })
    .select("id, name, enterprise_code")
    .single();
  if (error || !data)
    throw new Error(`Couldn't create demo org: ${error?.message}`);
  console.log(`  → org created (${data.id}) code=${data.enterprise_code}`);
  return { id: data.id, name: data.name, code: data.enterprise_code };
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

  console.log(`→ Looking up ${ENTERPRISE_DEMO_EMAIL}…`);
  const { data: page } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const user = page?.users?.find(
    (u) => u.email?.toLowerCase() === ENTERPRISE_DEMO_EMAIL
  );
  if (!user) {
    throw new Error(
      `${ENTERPRISE_DEMO_EMAIL} not found. Run \`node scripts/reset.mjs\` first to create the demo accounts.`
    );
  }
  console.log(`  ✓ user ${user.id}`);

  console.log(`→ Ensuring "${DEMO_ORG_NAME}" organization…`);
  const org = await ensureOrg(admin);

  // Resolve enterprise_admin role_id once.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", "enterprise_admin")
    .maybeSingle();
  const enterpriseAdminRoleId = (roleRow as { id: string } | null)?.id;
  if (!enterpriseAdminRoleId) {
    throw new Error(
      "enterprise_admin role not seeded — did you apply 20260521120000_roles_lookup_fk.sql?"
    );
  }

  console.log(`→ Binding Eric to org…`);
  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      id: user.id,
      full_name: "Eric Enterprise",
      primary_role_id: enterpriseAdminRoleId,
      organization_id: org.id,
      is_onboarded: true,
    },
    { onConflict: "id" }
  );
  if (profileErr)
    throw new Error(`Profile upsert failed: ${profileErr.message}`);
  console.log(`  ✓ profile.organization_id = ${org.id}`);

  console.log(`→ Granting enterprise_admin role (additive)…`);
  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: user.id, role_id: enterpriseAdminRoleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true }
    );
  if (roleErr) throw new Error(`Role grant failed: ${roleErr.message}`);
  console.log(`  ✓ enterprise_admin granted`);

  console.log("");
  console.log(`✓ Enterprise demo ready.`);
  console.log(`  Email:           ${ENTERPRISE_DEMO_EMAIL}`);
  console.log(`  Org:             ${DEMO_ORG_NAME}`);
  console.log(`  Enterprise code: ${org.code}`);
  console.log(
    `  Sign in via:     /staff → Developer shortcuts → Enterprise Admin`
  );
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
