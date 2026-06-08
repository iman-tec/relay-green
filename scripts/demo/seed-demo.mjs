// ============================================================================
// seed-demo.mjs — stand up the Epicenter channel-partner demo tree.
// ============================================================================
// Idempotent (re-run = no dupes), deterministic (seeded RNG), service-role.
// Prints the target ref and HALTS on the shared-prod backend unless you pass
//   --i-understand-prod
// Writes, in FK-safe order:
//   profiles + auth.users + user_roles  (every actor)
//   resellers (Epicenter)  → organizations (5)  → departments (15)
//   guest_calls (ended history, sentiment mix, minutes that reconcile)
// No Stripe, no Zoom, no live calls. See README.md.
// ============================================================================
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config as C, slug } from "./demo.config.mjs";

// ── env ────────────────────────────────────────────────────────────────────
function loadEnv(p) {
  const o = {};
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}
const env = loadEnv(".env.local");
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ref = URL.match(/https:\/\/([a-z0-9]+)\./)?.[1];

// ── prod guard ───────────────────────────────────────────────────────────
const PROD_REF = "vdduelvjrzeczmakxgpn"; // shared dev≡prod backend
console.log(`\nTARGET: ${URL}  (ref=${ref})`);
if (ref === PROD_REF && !process.argv.includes("--i-understand-prod")) {
  console.error(
    "\n⛔ HALT: target is the shared PROD backend.\n" +
      "   Re-run with --i-understand-prod to proceed, or point .env.local at a non-prod ref.\n"
  );
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// ── deterministic RNG ──────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(C.seed);
const randint = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ── roles ────────────────────────────────────────────────────────────────
const { data: roleRows, error: roleErr } = await sb.from("roles").select("id,name");
if (roleErr) throw roleErr;
const ROLE = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));

// ── auth user map (idempotency) ────────────────────────────────────────────
console.log("Loading existing auth users…");
const authMap = new Map(); // email → id
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  for (const u of data.users) authMap.set((u.email || "").toLowerCase(), u.id);
  if (data.users.length < 1000) break;
}

const PASSWORD = C.password;
async function ensureUser(email, fullName) {
  email = email.toLowerCase();
  const meta = {
    email_confirm: true,
    password: PASSWORD,
    app_metadata: { password_set: true, demo_namespace: C.namespace },
    user_metadata: { full_name: fullName },
  };
  let id = authMap.get(email);
  if (id) {
    const { error } = await sb.auth.admin.updateUserById(id, meta);
    if (error) throw new Error(`update ${email}: ${error.message}`);
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email, ...meta });
    if (error) throw new Error(`create ${email}: ${error.message}`);
    id = data.user.id;
    authMap.set(email, id);
  }
  return id;
}

async function ensureProfile(id, p) {
  const row = {
    id,
    full_name: p.full_name,
    primary_role_id: p.role_id,
    // Org members attached to a department with the plain client role are
    // EMPLOYEES (the member surfaces filter client_type='employee'); admins,
    // engineers, partners and individual customers stay 'client'.
    client_type:
      p.organization_id && p.department_id && p.role_id === ROLE.client
        ? "employee"
        : "client",
    status: "active",
    is_onboarded: true,
    organization_id: p.organization_id ?? null,
    department_id: p.department_id ?? null,
    reseller_id: p.reseller_id ?? null,
    allocated_minutes: p.allocated ?? 0,
    used_minutes: p.used ?? 0,
    remaining_minutes: (p.allocated ?? 0) - (p.used ?? 0),
  };
  const { error } = await sb.from("profiles").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`profile ${id}: ${error.message}`);
}

async function ensureUserRole(userId, roleId) {
  const { data } = await sb
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .limit(1);
  if (data?.length) return;
  const { error } = await sb.from("user_roles").insert({ user_id: userId, role_id: roleId });
  if (error && !/duplicate/i.test(error.message)) throw new Error(`role ${userId}: ${error.message}`);
}

// ── build the tree ─────────────────────────────────────────────────────────
const created = { users: 0, orgs: 0, depts: 0, calls: 0 };
const E = `@${C.emailDomain}`;
const P = C.prefix;

// 1) Partner owner + reseller (chicken/egg: user → reseller → backfill reseller_id)
const partnerId = await ensureUser(`${P}.partner${E}`, C.partnerOwnerName);
created.users++;
await ensureUserRole(partnerId, ROLE.reseller);

let { data: resRows } = await sb
  .from("resellers")
  .select("id")
  .eq("name", C.partnerName)
  .eq("owner_user_id", partnerId)
  .limit(1);
let resellerId = resRows?.[0]?.id;
if (!resellerId) {
  const { data, error } = await sb
    .from("resellers")
    .insert({
      name: C.partnerName,
      owner_user_id: partnerId,
      created_by_user_id: partnerId,
      tier: C.reseller.tier,
      commission: C.reseller.commission,
      default_passthrough_pct: C.reseller.defaultPassthroughPct,
      email: `${P}.partner${E}`,
      payout_email: `${P}.partner${E}`,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw new Error(`reseller: ${error.message}`);
  resellerId = data.id;
}
await ensureProfile(partnerId, {
  full_name: C.partnerOwnerName,
  role_id: ROLE.reseller,
  reseller_id: resellerId,
});

// 2) Enterprises → departments → employees
const tree = []; // for rollups + credentials
let empIdx = 0,
  dAdminIdx = 0;

for (let ei = 0; ei < C.enterprises.length; ei++) {
  const ent = C.enterprises[ei];

  // organization
  let { data: orgRows } = await sb
    .from("organizations")
    .select("id")
    .eq("reseller_id", resellerId)
    .eq("name", ent.name)
    .limit(1);
  let orgId = orgRows?.[0]?.id;
  if (!orgId) {
    const { data, error } = await sb
      .from("organizations")
      .insert({
        name: ent.name,
        reseller_id: resellerId,
        created_by_user_id: partnerId,
        enterprise_type: "inorganic",
        billing_currency: "EUR",
        discount_pct: ent.discountPct,
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(`org ${ent.name}: ${error.message}`);
    orgId = data.id;
    created.orgs++;
  }

  // enterprise admin
  const eaName = C.enterpriseAdminNames[ei];
  const eaId = await ensureUser(`${P}.admin.${ent.slug}${E}`, eaName);
  created.users++;
  await ensureUserRole(eaId, ROLE.enterprise_admin);
  await ensureProfile(eaId, { full_name: eaName, role_id: ROLE.enterprise_admin, organization_id: orgId });

  // Pre-accept the enterprise MSA clickwrap (terms_type='enterprise_msa') so
  // the login gate doesn't modal every visit. Idempotent on (org, type, version).
  {
    const { data: hasMsa } = await sb
      .from("terms_acceptances")
      .select("id")
      .eq("enterprise_id", orgId)
      .eq("terms_type", "enterprise_msa")
      .eq("terms_version", C.termsVersion)
      .limit(1);
    if (!hasMsa?.length) {
      await sb.from("terms_acceptances").insert({
        enterprise_id: orgId,
        admin_user_id: eaId,
        terms_type: "enterprise_msa",
        terms_version: C.termsVersion,
      });
    }
  }

  const entNode = { ent, orgId, eaId, depts: [] };

  // departments
  for (let di = 0; di < C.departments.length; di++) {
    const dname = C.departments[di];
    let { data: dRows } = await sb
      .from("departments")
      .select("id")
      .eq("enterprise_id", orgId)
      .eq("name", dname)
      .limit(1);
    let deptId = dRows?.[0]?.id;
    if (!deptId) {
      const { data, error } = await sb
        .from("departments")
        .insert({ enterprise_id: orgId, name: dname, created_by_user_id: partnerId, status: "active" })
        .select("id")
        .single();
      if (error) throw new Error(`dept ${ent.name}/${dname}: ${error.message}`);
      deptId = data.id;
      created.depts++;
    }

    // department admin
    const daName = C.deptAdminNames[dAdminIdx++];
    const daId = await ensureUser(`${P}.dadmin.${ent.slug}.${slug(dname)}${E}`, daName);
    created.users++;
    await ensureUserRole(daId, ROLE.department_admin);
    await ensureProfile(daId, {
      full_name: daName,
      role_id: ROLE.department_admin,
      organization_id: orgId,
      department_id: deptId,
    });
    await sb.from("departments").update({ admin_user_id: daId }).eq("id", deptId);

    // employees (3 per dept)
    const perDept = Math.round(C.employeesPerEnterprise / C.departments.length);
    const emps = [];
    for (let k = 0; k < perDept; k++) {
      const name = C.employeeNames[empIdx++];
      const id = await ensureUser(`${P}.${ent.slug}.${slug(name)}${E}`, name);
      created.users++;
      await ensureUserRole(id, ROLE.client);
      await ensureProfile(id, {
        full_name: name,
        role_id: ROLE.client,
        organization_id: orgId,
        department_id: deptId,
      });
      emps.push({ id, name, email: `${P}.${ent.slug}.${slug(name)}${E}` });
    }
    entNode.depts.push({ deptId, name: dname, daId, daName, emps });
  }
  tree.push(entNode);
}

// 2b) Partner clickwrap (terms_type='partner_commercial'). enterprise_id is
// NOT NULL, so anchor it on the first enterprise (mirrors existing convention).
if (tree.length) {
  const firstOrg = tree[0].orgId;
  const { data: hasPc } = await sb
    .from("terms_acceptances")
    .select("id")
    .eq("enterprise_id", firstOrg)
    .eq("terms_type", "partner_commercial")
    .eq("terms_version", C.termsVersion)
    .limit(1);
  if (!hasPc?.length) {
    await sb.from("terms_acceptances").insert({
      enterprise_id: firstOrg,
      admin_user_id: partnerId,
      terms_type: "partner_commercial",
      terms_version: C.termsVersion,
    });
  }
}

// 3) Engineers (claimed the sessions; not part of any org)
const engineers = [];
for (let i = 0; i < C.engineers; i++) {
  const name = `Engineer ${["Ada", "Boris", "Chen", "Dara", "Esi", "Finn"][i] || i}`;
  const id = await ensureUser(`${P}.eng.${i + 1}${E}`, name);
  created.users++;
  await ensureUserRole(id, ROLE.engineer);
  await ensureProfile(id, { full_name: name, role_id: ROLE.engineer });
  engineers.push(id);
}

// 4) Usage — ended guest_calls with reconciling minutes + sentiment mix.
// Idempotent: skip if this namespace already has calls.
const { count: existingCalls } = await sb
  .from("guest_calls")
  .select("id", { count: "exact", head: true })
  .like("guest_local_id", `${C.namespace}#%`);

const empUsed = new Map(); // employee id → used minutes
if (!existingCalls) {
  const now = Date.now();
  let n = 0;
  const calls = [];
  for (const en of tree) {
    for (const d of en.depts) {
      for (const emp of d.emps) {
        const nSessions = randint(2, 6);
        let used = 0;
        for (let s = 0; s < nSessions; s++) {
          const dur = randint(8, 45);
          used += dur;
          // business-hours-ish start within last 30 days
          const daysAgo = randint(1, 30);
          const start = new Date(now - daysAgo * 86400000);
          start.setHours(randint(9, 17), randint(0, 59), 0, 0);
          const end = new Date(start.getTime() + dur * 60000);
          // sentiment mix: mostly healthy, some shaky, few at-risk
          const r = rng();
          const sentiment = r < 0.65 ? 0.7 + rng() * 0.25 : r < 0.85 ? 0.45 + rng() * 0.2 : 0.18 + rng() * 0.22;
          calls.push({
            guest_name: emp.name,
            guest_email: emp.email,
            status: "ended",
            customer_user_id: emp.id,
            claimed_by: pick(engineers),
            organization_id: en.orgId,
            started_at: start.toISOString(),
            ended_at: end.toISOString(),
            duration_minutes: dur,
            free_minutes_used: Math.min(dur, 10),
            ended_reason: "completed",
            final_sentiment_score: Math.round(sentiment * 100) / 100,
            guest_local_id: `${C.namespace}#${en.ent.slug}-${++n}`,
            project_name: `${en.ent.name} support`,
          });
        }
        empUsed.set(emp.id, used);
      }
    }
  }
  // insert in chunks
  for (let i = 0; i < calls.length; i += 200) {
    const { error } = await sb.from("guest_calls").insert(calls.slice(i, i + 200));
    if (error) throw new Error(`guest_calls: ${error.message}`);
  }
  created.calls = calls.length;
} else {
  console.log(`Usage already seeded (${existingCalls} calls) — skipping, recomputing rollups from DB.`);
  // recompute used from existing demo calls so rollups stay correct
  const { data } = await sb
    .from("guest_calls")
    .select("customer_user_id,duration_minutes")
    .like("guest_local_id", `${C.namespace}#%`);
  for (const r of data || []) empUsed.set(r.customer_user_id, (empUsed.get(r.customer_user_id) || 0) + Number(r.duration_minutes || 0));
}

// 5) Minutes rollup: employee → dept → org → reseller. allocated = used + buffer.
const buffer = (used) => Math.max(60, Math.ceil((used * 1.4) / 10) * 10); // allocated headroom
let resUsed = 0,
  resAlloc = 0;
for (const en of tree) {
  let orgUsed = 0,
    orgAlloc = 0;
  for (const d of en.depts) {
    let dUsed = 0,
      dAlloc = 0;
    for (const emp of d.emps) {
      const used = empUsed.get(emp.id) || 0;
      const alloc = buffer(used);
      await sb
        .from("profiles")
        .update({ allocated_minutes: alloc, used_minutes: used, remaining_minutes: alloc - used })
        .eq("id", emp.id);
      dUsed += used;
      dAlloc += alloc;
    }
    await sb
      .from("departments")
      .update({ allocated_minutes: dAlloc, used_minutes: dUsed, remaining_minutes: dAlloc - dUsed })
      .eq("id", d.deptId);
    orgUsed += dUsed;
    orgAlloc += dAlloc;
  }
  await sb
    .from("organizations")
    .update({ allocated_minutes: orgAlloc, used_minutes: orgUsed, remaining_minutes: orgAlloc - orgUsed })
    .eq("id", en.orgId);
  resUsed += orgUsed;
  resAlloc += orgAlloc;
}
await sb
  .from("resellers")
  .update({ allocated_minutes: resAlloc, used_minutes: resUsed, remaining_minutes: resAlloc - resUsed })
  .eq("id", resellerId);

console.log("\n✅ Seed complete:", JSON.stringify(created));
console.log(`Reseller minutes: used=${resUsed} allocated=${resAlloc}`);
console.log(`Gross spend ≈ €${(resUsed * C.ratePerMin).toLocaleString()} (before passthrough)`);
console.log("\nRun: node scripts/demo/print-credentials.mjs");
