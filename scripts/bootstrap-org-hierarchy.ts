/*
 * Seeds a clean test hierarchy on top of the existing demo accounts:
 *
 *   Super Admin     → dev.soni@thegatewaycorp.co.in        (already exists)
 *   Enterprise Adm. → enterprise.demo@relay.test  / Eric   (already exists)
 *   Internal Admin  → admin.demo@relay.test       / Iris   (already exists)
 *      Pod "Alpha"
 *        Supervisor → supervisor.demo@relay.test  / Sam    (already exists)
 *        Engineer   → engineer.alpha1@relay.test  / Alex Alpha One   (new)
 *        Engineer   → engineer.alpha2@relay.test  / Aria Alpha Two   (new)
 *      Pod "Beta"
 *        Supervisor → supervisor.beta@relay.test  / Beth Supervisor  (new)
 *        Engineer   → engineer.beta1@relay.test   / Ben Beta One     (new)
 *        Engineer   → engineer.beta2@relay.test   / Bree Beta Two    (new)
 *
 * Idempotent — re-running won't duplicate anything. All users get the
 * shared DEMO_PASSWORD ("RelayDev123!") so they can sign in via the
 * existing /api/dev/sign-in-as bypass during testing.
 *
 *   npx tsx scripts/bootstrap-org-hierarchy.ts
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const DEMO_PASSWORD = "RelayDev123!";

type SeedUser = { email: string; name: string; role: string; primaryRole: string };

const NEW_USERS: SeedUser[] = [
  // Supervisor for Pod Beta (Sam already exists for Pod Alpha)
  { email: "supervisor.beta@relay.test",  name: "Beth Supervisor", role: "pod_lead", primaryRole: "pod_lead" },
  // Pod Alpha engineers
  { email: "engineer.alpha1@relay.test",  name: "Alex Alpha One",  role: "engineer", primaryRole: "engineer" },
  { email: "engineer.alpha2@relay.test",  name: "Aria Alpha Two",  role: "engineer", primaryRole: "engineer" },
  // Pod Beta engineers
  { email: "engineer.beta1@relay.test",   name: "Ben Beta One",    role: "engineer", primaryRole: "engineer" },
  { email: "engineer.beta2@relay.test",   name: "Bree Beta Two",   role: "engineer", primaryRole: "engineer" },
];

type PodSpec = {
  name: string;
  supervisorEmail: string;
  engineerEmails: string[];
};

const PODS: PodSpec[] = [
  {
    name: "Alpha",
    supervisorEmail: "supervisor.demo@relay.test",
    engineerEmails: ["engineer.alpha1@relay.test", "engineer.alpha2@relay.test"],
  },
  {
    name: "Beta",
    supervisorEmail: "supervisor.beta@relay.test",
    engineerEmails: ["engineer.beta1@relay.test", "engineer.beta2@relay.test"],
  },
];

type AdminClient = SupabaseClient<any, "public", "public", any, any>;

async function findUserByEmail(admin: AdminClient, email: string): Promise<string | null> {
  // listUsers caps at 1000/page — fine for a demo install.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = data?.users?.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  return u?.id ?? null;
}

const ORG_NAME = "Demo Enterprise Co";

async function findOrgId(admin: AdminClient): Promise<string | null> {
  const { data } = await admin
    .from("organizations")
    .select("id")
    .eq("name", ORG_NAME)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

async function bindUserToOrg(admin: AdminClient, userId: string, orgId: string, label: string) {
  const { error } = await admin
    .from("profiles")
    .update({ organization_id: orgId })
    .eq("id", userId);
  if (error) throw new Error(`org bind failed for ${label}: ${error.message}`);
}

async function ensureUser(admin: AdminClient, u: SeedUser, orgId: string | null): Promise<string> {
  let userId = await findUserByEmail(admin, u.email);
  if (userId) {
    console.log(`  → ${u.email} exists (${userId})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email:         u.email,
      password:      DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: u.name },
    });
    if (error || !data.user) throw new Error(`createUser failed for ${u.email}: ${error?.message}`);
    userId = data.user.id;
    console.log(`  → ${u.email} created (${userId})`);
  }

  // Profile upsert — bind supervisor/engineer accounts to the same org as
  // the Internal Admin (Iris) so the enterprise + finance dashboards can
  // scope by organization_id.
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       u.name,
        primary_role:    u.primaryRole,
        is_onboarded:    true,
        ...(orgId ? { organization_id: orgId } : {}),
      },
      { onConflict: "id" },
    );
  if (profileErr) throw new Error(`profile upsert failed for ${u.email}: ${profileErr.message}`);

  // Role grant — additive.
  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: u.role },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  if (roleErr) throw new Error(`role grant failed for ${u.email}: ${roleErr.message}`);

  return userId;
}

async function ensurePod(admin: AdminClient, name: string): Promise<string> {
  const { data: existing } = await admin
    .from("pods")
    .select("id")
    .eq("name", name)
    .is("archived_at", null)
    .maybeSingle();
  if (existing) {
    console.log(`  → pod "${name}" exists (${(existing as { id: string }).id})`);
    return (existing as { id: string }).id;
  }
  // Generate a slug; rely on the unique index to surface collisions.
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
  const { data, error } = await admin
    .from("pods")
    .insert({ name, slug })
    .select("id")
    .single();
  if (error || !data) throw new Error(`pod create failed for "${name}": ${error?.message}`);
  console.log(`  → pod "${name}" created (${(data as { id: string }).id})`);
  return (data as { id: string }).id;
}

async function ensurePodMember(
  admin: AdminClient,
  podId: string,
  userId: string,
  podRole: "supervisor" | "engineer",
  label: string,
): Promise<void> {
  // pod_members has UNIQUE(user_id) — one user, one pod. Upsert keyed on
  // user_id so re-running the script just reseats them in the same pod.
  const { error } = await admin
    .from("pod_members")
    .upsert(
      { pod_id: podId, user_id: userId, pod_role: podRole },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`pod_member upsert failed for ${label}: ${error.message}`);
  console.log(`  → ${label} → pod ${podId} (${podRole})`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } }) as AdminClient;

  // 0. Resolve the Demo Enterprise Co org and bind Iris (Internal Admin)
  //    to it so all her pod members can inherit the same organization_id.
  console.log(`→ Resolving "${ORG_NAME}"…`);
  const orgId = await findOrgId(admin);
  if (!orgId) {
    throw new Error(`Org "${ORG_NAME}" not found. Run bootstrap-enterprise-demo.ts first.`);
  }
  console.log(`  → org ${orgId}`);

  const irisId = await findUserByEmail(admin, "admin.demo@relay.test");
  if (irisId) {
    await bindUserToOrg(admin, irisId, orgId, "admin.demo@relay.test (Iris)");
    console.log(`  → Iris bound to org`);
  } else {
    console.warn("  ⚠ admin.demo@relay.test not found — Internal Admin will be missing.");
  }

  // 1. Create the new staff users (Beth + 4 engineers).
  console.log("→ Ensuring staff users…");
  const userIds = new Map<string, string>();
  for (const u of NEW_USERS) {
    userIds.set(u.email, await ensureUser(admin, u, orgId));
  }

  // 2. Resolve the pre-existing Sam by lookup and reseat his org_id too.
  console.log("→ Resolving pre-existing supervisor (Sam)…");
  const samId = await findUserByEmail(admin, "supervisor.demo@relay.test");
  if (!samId) {
    throw new Error("supervisor.demo@relay.test not found. Run `node scripts/reset.mjs` first to seed the base demo accounts.");
  }
  userIds.set("supervisor.demo@relay.test", samId);
  if (orgId) {
    await admin.from("profiles").update({ organization_id: orgId }).eq("id", samId);
  }
  console.log(`  → supervisor.demo@relay.test (${samId})`);

  // 3. Create the pods + memberships.
  console.log("→ Building pods…");
  for (const pod of PODS) {
    console.log(`  Pod "${pod.name}":`);
    const podId = await ensurePod(admin, pod.name);
    const supId = userIds.get(pod.supervisorEmail);
    if (!supId) throw new Error(`Couldn't resolve ${pod.supervisorEmail}`);
    await ensurePodMember(admin, podId, supId, "supervisor", pod.supervisorEmail);
    for (const engEmail of pod.engineerEmails) {
      const engId = userIds.get(engEmail);
      if (!engId) throw new Error(`Couldn't resolve ${engEmail}`);
      await ensurePodMember(admin, podId, engId, "engineer", engEmail);
    }
  }

  console.log("");
  console.log("✓ Org hierarchy seeded.");
  console.log("");
  console.log("  Super admin       dev.soni@thegatewaycorp.co.in");
  console.log("  Enterprise admin  enterprise.demo@relay.test     (Eric Enterprise, org=Demo Enterprise Co)");
  console.log("  Internal admin    admin.demo@relay.test          (Iris Internal)");
  console.log("    Pod Alpha");
  console.log("      Supervisor    supervisor.demo@relay.test     (Sam Supervisor)");
  console.log("      Engineer      engineer.alpha1@relay.test     (Alex Alpha One)");
  console.log("      Engineer      engineer.alpha2@relay.test     (Aria Alpha Two)");
  console.log("    Pod Beta");
  console.log("      Supervisor    supervisor.beta@relay.test     (Beth Supervisor)");
  console.log("      Engineer      engineer.beta1@relay.test      (Ben Beta One)");
  console.log("      Engineer      engineer.beta2@relay.test      (Bree Beta Two)");
  console.log("");
  console.log(`  All new users share the demo password: ${DEMO_PASSWORD}`);
  console.log(`  Sign in via /staff/login (OTP) or the Developer Shortcuts panel.`);
}

main().catch((err) => {
  console.error("✗", err.message ?? err);
  process.exit(1);
});
