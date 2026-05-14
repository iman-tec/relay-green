/*
 * Seeds 4 staff members under Demo Enterprise Co so Eric (the
 * enterprise_admin) has people to manage:
 *
 *   Sienna Sup    enterprise.sup1@demoent.test  (pod_lead)
 *   Steve Sup     enterprise.sup2@demoent.test  (pod_lead)
 *   Ed Engineer   enterprise.eng1@demoent.test  (engineer)
 *   Erin Engineer enterprise.eng2@demoent.test  (engineer)
 *
 * All bound to organization_id = Demo Enterprise Co. Eric himself is the
 * 5th staff member — counts to 5 in /enterprise → Staff tab.
 *
 * Idempotent.
 *
 *   npx tsx scripts/bootstrap-enterprise-staff.ts
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type AdminClient = SupabaseClient<any, "public", "public", any, any>;

const DEMO_PASSWORD = "RelayDev123!";
const ORG_NAME = "Demo Enterprise Co";

const ENT_STAFF = [
  { email: "enterprise.sup1@demoent.test", name: "Sienna Supervisor", role: "pod_lead", primaryRole: "pod_lead" },
  { email: "enterprise.sup2@demoent.test", name: "Steve Supervisor",  role: "pod_lead", primaryRole: "pod_lead" },
  { email: "enterprise.eng1@demoent.test", name: "Ed Engineer",       role: "engineer", primaryRole: "engineer" },
  { email: "enterprise.eng2@demoent.test", name: "Erin Engineer",     role: "engineer", primaryRole: "engineer" },
];

async function findUserByEmail(admin: AdminClient, email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function ensureStaff(
  admin: AdminClient,
  email: string,
  name: string,
  role: string,
  primaryRole: string,
  orgId: string,
): Promise<void> {
  let userId = await findUserByEmail(admin, email);
  if (userId) {
    console.log(`  → ${email} exists (${userId})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
    userId = data.user.id;
    console.log(`  → ${email} created (${userId})`);
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       name,
        primary_role:    primaryRole,
        organization_id: orgId,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );
  if (profileErr) throw new Error(`profile upsert failed for ${email}: ${profileErr.message}`);

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  if (roleErr) throw new Error(`role grant failed for ${email}: ${roleErr.message}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } }) as AdminClient;

  console.log(`→ Finding "${ORG_NAME}"…`);
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("name", ORG_NAME)
    .single();
  if (!org) throw new Error(`Org "${ORG_NAME}" not found. Run bootstrap-enterprise-demo.ts first.`);
  const orgId = (org as { id: string }).id;
  console.log(`  ✓ org ${orgId}`);

  console.log("→ Ensuring enterprise staff…");
  for (const s of ENT_STAFF) {
    await ensureStaff(admin, s.email, s.name, s.role, s.primaryRole, orgId);
  }

  console.log("");
  console.log(`✓ Demo Enterprise Co staff complete (5 total).`);
  console.log("");
  console.log("  Eric Enterprise          enterprise.demo@relay.test         (enterprise_admin)");
  console.log("  Sienna Supervisor        enterprise.sup1@demoent.test       (pod_lead)");
  console.log("  Steve Supervisor         enterprise.sup2@demoent.test       (pod_lead)");
  console.log("  Ed Engineer              enterprise.eng1@demoent.test       (engineer)");
  console.log("  Erin Engineer            enterprise.eng2@demoent.test       (engineer)");
  console.log(`  Shared password: ${DEMO_PASSWORD}`);
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
