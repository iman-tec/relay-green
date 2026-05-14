/*
 * Seeds guest_calls rows for the Demo Enterprise Co org so the dashboards
 * have something to render.
 *
 * Creates:
 *   - 3 customer (builder) users under the org
 *   - 1 live session
 *   - 1 queued session
 *   - 12 ended sessions spread over the last 30 days
 *
 * Idempotent — won't duplicate if re-run. Picks engineers from the seeded
 * Pod Alpha/Beta pool.
 *
 *   npx tsx scripts/bootstrap-session-data.ts
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type AdminClient = SupabaseClient<any, "public", "public", any, any>;

const DEMO_PASSWORD = "RelayDev123!";
const ORG_NAME = "Demo Enterprise Co";

const CUSTOMERS = [
  { email: "customer.alpha@demoent.test", name: "Alice Customer" },
  { email: "customer.bravo@demoent.test", name: "Bob Customer" },
  { email: "customer.charlie@demoent.test", name: "Carol Customer" },
];

const ENGINEER_EMAILS = [
  "engineer.alpha1@relay.test",
  "engineer.alpha2@relay.test",
  "engineer.beta1@relay.test",
  "engineer.beta2@relay.test",
];

const PROJECT_NAMES = [
  "Inventory sync bug", "Stripe webhook failures", "Email deliverability",
  "Pricing tier confusion", "Login OTP delays", "Dashboard 500s",
  "Slack integration", "PDF export", "Mobile crash on iOS 18",
];

const SAMPLE_SUMMARIES = [
  "Customer needed help debugging a 503 on their webhook handler. Resolved by retrying the failed batch.",
  "Walked through the Stripe payout schedule and how holds work.",
  "Showed how to export reports as CSV from the analytics tab.",
  "Helped diagnose a flaky build by surfacing a dependency version mismatch.",
  "Set up SSO for their new org and verified login flow end-to-end.",
  "Customer was confused about the credit refresh policy. Clarified billing cycle.",
  "Recovered a deleted project from soft-delete. Confirmed they don't lose data.",
  "Diagnosed a mobile crash and routed to the correct on-call engineer.",
];

const URGENCIES = ["normal", "normal", "normal", "normal", "urgent", "critical"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function findUserByEmail(admin: AdminClient, email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function ensureCustomer(
  admin: AdminClient,
  email: string,
  name: string,
  orgId: string,
): Promise<string> {
  let userId = await findUserByEmail(admin, email);
  if (userId) {
    console.log(`  → customer ${email} exists (${userId})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
    userId = data.user.id;
    console.log(`  → customer ${email} created (${userId})`);
  }

  await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       name,
        primary_role:    "builder",
        organization_id: orgId,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );
  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "builder" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  return userId;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } }) as AdminClient;

  // 1. Resolve org id
  console.log(`→ Finding "${ORG_NAME}"…`);
  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("name", ORG_NAME)
    .single();
  if (!org) throw new Error(`Org "${ORG_NAME}" not found. Run bootstrap-enterprise-demo.ts first.`);
  const orgId = (org as { id: string }).id;
  console.log(`  ✓ org ${orgId}`);

  // 2. Resolve engineer ids
  console.log("→ Resolving engineers…");
  const engineerIds: { id: string; email: string }[] = [];
  for (const eEmail of ENGINEER_EMAILS) {
    const id = await findUserByEmail(admin, eEmail);
    if (!id) throw new Error(`Engineer ${eEmail} not found. Run bootstrap-org-hierarchy.ts first.`);
    engineerIds.push({ id, email: eEmail });
  }
  console.log(`  ✓ ${engineerIds.length} engineers`);

  // 3. Ensure customer users under the org
  console.log("→ Ensuring customer users…");
  const customerIds: { id: string; email: string; name: string }[] = [];
  for (const c of CUSTOMERS) {
    const id = await ensureCustomer(admin, c.email, c.name, orgId);
    customerIds.push({ id, email: c.email, name: c.name });
  }

  // 4. Wipe out any existing demo sessions for this org so re-runs stay
  // clean (idempotency without dupes).
  console.log("→ Clearing prior demo sessions for the org…");
  const { error: delErr, count } = await admin
    .from("guest_calls")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);
  if (delErr) {
    console.warn(`  ⚠ couldn't clear prior sessions: ${delErr.message}`);
  } else {
    console.log(`  ✓ cleared ${count ?? 0} rows`);
  }

  // 5. Insert sessions: 12 ended over 30 days, 1 live, 1 queued
  console.log("→ Inserting demo sessions…");
  const now = Date.now();
  const rows: Record<string, unknown>[] = [];

  // 12 ended sessions spread across last 30 days
  for (let i = 0; i < 12; i++) {
    const daysAgo  = Math.floor(Math.random() * 30);
    const createdAt = new Date(now - daysAgo * 86_400_000 - Math.random() * 8 * 3_600_000);
    const duration  = +(2 + Math.random() * 18).toFixed(1); // 2–20 min
    const endedAt   = new Date(createdAt.getTime() + duration * 60_000);
    const cust = pick(customerIds);
    const eng  = pick(engineerIds);
    rows.push({
      guest_name:        cust.name,
      guest_email:       cust.email,
      customer_user_id:  cust.id,
      organization_id:   orgId,
      claimed_by:        eng.id,
      agent_name:        eng.email.split("@")[0],
      status:            "ended",
      urgency:           pick(URGENCIES),
      recall_count:      Math.random() < 0.2 ? 1 : 0,
      created_at:        createdAt.toISOString(),
      claimed_at:        new Date(createdAt.getTime() + 30_000).toISOString(),
      joined_at:         new Date(createdAt.getTime() + 60_000).toISOString(),
      started_at:        new Date(createdAt.getTime() + 60_000).toISOString(),
      ended_at:          endedAt.toISOString(),
      duration_minutes:  duration,
      project_name:      pick(PROJECT_NAMES),
      ai_summary_title:  pick(SAMPLE_SUMMARIES).split(".")[0] + ".",
      summary:           pick(SAMPLE_SUMMARIES),
    });
  }

  // 1 live session — started ~6 minutes ago, no ended_at
  {
    const cust = customerIds[0]!;
    const eng  = engineerIds[0]!;
    const startedAt = new Date(now - 6 * 60_000);
    rows.push({
      guest_name:        cust.name,
      guest_email:       cust.email,
      customer_user_id:  cust.id,
      organization_id:   orgId,
      claimed_by:        eng.id,
      agent_name:        eng.email.split("@")[0],
      status:            "live",
      urgency:           "normal",
      recall_count:      0,
      created_at:        new Date(startedAt.getTime() - 90_000).toISOString(),
      claimed_at:        new Date(startedAt.getTime() - 60_000).toISOString(),
      joined_at:         startedAt.toISOString(),
      started_at:        startedAt.toISOString(),
      project_name:      "Pricing tier confusion",
    });
  }

  // 1 queued session — created ~80 seconds ago, not yet claimed
  {
    const cust = customerIds[1]!;
    rows.push({
      guest_name:        cust.name,
      guest_email:       cust.email,
      customer_user_id:  cust.id,
      organization_id:   orgId,
      status:            "queued",
      urgency:           "urgent",
      recall_count:      0,
      created_at:        new Date(now - 80_000).toISOString(),
      project_name:      "Login OTP delays",
    });
  }

  const { error: insErr, data: inserted } = await admin
    .from("guest_calls")
    .insert(rows)
    .select("id, status");
  if (insErr) throw new Error(`Insert failed: ${insErr.message}`);
  console.log(`  ✓ inserted ${inserted?.length ?? 0} sessions`);

  console.log("");
  console.log("✓ Session data seeded for Demo Enterprise Co.");
  console.log("");
  console.log("  Visit:");
  console.log("    /enterprise           → KPIs, sparkline, recent sessions populated");
  console.log("    /supervise            → Live (1), Waiting (1), Past (12)");
  console.log("    /admin                → super_admin sees the same data org-wide");
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
