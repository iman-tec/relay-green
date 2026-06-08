# Department admin console reimagining — Phase 0 study

> STUDY ONLY. No code written. Every claim carries file:line evidence.
> Goal: reframe Sessions + Usage around the **employee and the budget**, add a
> How-to-use to Resources, fix member propagation/verification — metadata-only,
> department-scoped, behind the enterprise/dept v2 flag, money-path untouched.

> ⚠️ **CONCURRENCY — read §7 before any build.** Another session is actively
> rewriting the department/enterprise client layer (the "supervise" rebuild). The
> files this brief's client-side phases (A Sessions, B Usage UI, C Resources UI,
> E nav) would edit are **uncommitted and in flux right now**. Only the
> server-side and new-file slices are collision-free.

---

## 0. Headline findings

1. **Most "metadata-only" gating already exists** server-side. Dept sessions
   endpoint omits email + AI summary; enterprise endpoint similar. The brief's new
   requirement is to ALSO keep AI sentiment/health (content-derived) out — confirm
   the dept view uses only the **deterministic** health (urgency/recall/queue-wait),
   never `session_health`/`sup_sentiment` (AI, content).
2. **Member propagation is actually consistent today** — all surfaces read the
   same `profiles` table, so a member added anywhere appears everywhere. The REAL
   gap is **invite/verification-status asymmetry**: dept-add records an invite,
   enterprise-add and attach do NOT → the verification-tracking table is missing
   enterprise-sourced members. That's the propagation fix, not the member row.
   (Code wins over the brief's "exists in one console but not another" framing.)
3. **Budget data is real columns**; spend is synthetic (`minutes × 300¢`). Runway
   projection is buildable from `remaining_minutes` + recent burn rate.
4. **Department nav-escape (Phase E) is ALREADY FIXED** in the in-flight session
   (`LINKS=[]`, Supervise is now an in-console tab). Don't redo it.
5. **k-anonymity suppression exists** in the usage endpoint — a by-employee view
   for the dept admin's OWN dept is allowed (own-dept member names are permitted),
   but reuse the same suppression rules where aggregation could de-anonymize.

---

## 1. Session fields available + metadata vs content classification

**Spec boundary (authoritative):**
- `docs/RelayGreen_Spec_Decisions_v1.md:563` — "enterprise admin = **NO content
  access (metadata only)**" (access-tier list, I4.b).
- `docs/RelayGreen_Build_Ready_PRD_v1.md:484-509` — Enterprise admin **allowed
  metadata**: user name, email, department, team, **project name**, AI tool track,
  session duration, spend, engineer alias, date/time, session status, recording
  enabled y/n, billing source. **Cannot see**: transcripts, recordings, chat
  content, uploaded files, code, detailed engineering notes.
- `project_name` is explicitly **metadata** (`PRD:492`) — safe to show ("what
  project", not conversation).

**Fields available to a department-scoped query** (`app/api/department/sessions/route.ts:43-78`):
`id, status, urgency, created_at, joined_at, ended_at, duration_minutes,
customer_user_id→memberName, project_name`. Already omits email + engineer name +
AI summary (`:77` "no email, no AI summary — minimized").

**Content (must stay gated out):**
- AI sentiment/health: `supabase/migrations/20260513160000_session_health.sql:1-6,24-26`
  — `score-session-health` edge fn LLM-scores the **last 60s of chat** per minute →
  `session_health` rows + `latest_session_health` view (`score, summary,
  computed_at, message_count`). Content-derived → **never** in the dept view.
  Same for `latest_sup_sentiment`/`sup_sentiment`.
- `docs/gdpr-data-access-matrix.md:37,69-72` — "Session content (AI summary
  title/body): 🚫 not in mgmt views"; flags `/api/enterprise/sessions` + `/billing`
  as **current violations** shipping email/summary/guest_name/Stripe IDs the UI
  never shows. (Tighten, don't widen.)

**Deterministic health is metadata-safe:** the enterprise/dept `SuperviseView`
`deriveHealth()` keys on `urgency`, `status`, `recall_count`, queue-wait seconds —
NOT on AI sentiment. That is metadata and OK to surface. The line to hold: never
read `session_health`/`sup_sentiment` into a management view.

---

## 2. Department scoping (the working path)

- `lib/department-auth.ts` `requireDepartmentAdmin()` resolves the department from
  the **caller's own profile**; dept admin scoped to own department, server-enforced.
- Sessions scope: `profiles WHERE department_id` → ids → `guest_calls WHERE
  customer_user_id IN (ids)` (`app/api/department/sessions/route.ts:29-48`).
  **Avoids `guest_calls.organization_id`** (the 0/505-populated landmine —
  `docs/audit/project_guest_calls_org_scoping.md`). ✅ correct path.

---

## 3. Budget / allocation / spend / refill

**Allocation columns** (`supabase/migrations/20260521170000_enterprise_refill_and_minutes.sql:91-97`):
`departments.allocated_minutes`, `used_minutes`, `remaining_minutes` (numeric,
default 0). `remaining_minutes` is the literal "left" (pre-debited at transfer).
- Exposed: `app/api/enterprise/departments/route.ts:34-35`,
  `app/api/department/employees/route.ts:36-37`.

**Used-minutes rollup** (on session end —
`supabase/migrations/20260521200000_end_session_employee_billing.sql:141-168`):
debits `profiles.used_minutes`/`remaining_minutes`, rolls `duration_min` UP →
`departments.used_minutes` → `organizations.used_minutes` → `resellers.used_minutes`.
`used_minutes` is reporting rollup; `remaining_minutes` was pre-debited at transfer.

**Spend is synthetic** (no ledger): `LIST_CENTS_PER_MINUTE = 300`
(`lib/billing/minuteBundles.ts:17`); usage route computes `minutes × 300`
(`app/api/department/usage/route.ts:18,82-84`); dept OverviewView mirrors
`RATE=300` (`app/(staff)/department/v2/_cc/OverviewView.tsx:20,52`).
→ **Runway projection** = `remaining_minutes ÷ (recent daily burn from
guest_calls)`; all derivable, no new money path.

**Refill path (reuse, don't re-implement):**
- Dept admin refills ONE employee: `transfer_to_employee(_profile_id,_amount)`
  RPC — `app/api/department/employees/[id]/refill/route.ts:44-49` (validates
  `0 < amount ≤ dept.remaining_minutes`).
- Enterprise admin tops up a department: `transfer_to_department(_dept_id,_amount)`
  — `app/api/enterprise/departments/[id]/refill/route.ts:41-46`.
- RPCs: `…20260521170000…:360-403`, SECURITY DEFINER, service_role only.
- **Note:** a dept admin cannot top up their own dept POOL (that's the enterprise
  admin's `transfer_to_department`); the dept admin only redistributes existing
  dept minutes to employees. The runway→refill CTA should reflect that (nudge the
  enterprise admin / per-employee transfer), not invent a dept-pool self-refill.

**Current usage endpoint shape** (`app/api/department/usage/route.ts`): returns
`{ byPeriod: [{ period, memberCount, suppressed, minutes, sessions, spendCents,
suppressedLabel }], perMinuteCents: 300 }` — month buckets, **k-anonymity
suppressed** below a member threshold (`lib/relay/kanonymity.ts`). This is the
two-row table the brief replaces.

---

## 4. Member / invite / verification / propagation (the data-consistency core)

**Add paths:**
- Dept admin: `POST /api/department/employees` (`route.ts:275-300,338-346`) —
  upserts `profiles` (`organization_id`, `department_id`, `client_type='employee'`,
  `is_onboarded=true`), `transfer_to_employee()` initial minutes,
  **`recordInvite(scope_type='department')`**, `sendInvitationEmail()`.
- Enterprise admin: `POST /api/enterprise/departments/[id]/employees`
  (`route.ts:344-378`) — same upsert + transfer + email **but NO `recordInvite()`**.
- Attach existing: `POST /api/enterprise/departments/[id]/employees/attach`
  (`route.ts:86-96`) — upsert only, **no email, no recordInvite**.

**Verification model:**
- `invites` table (`supabase/migrations/20260527240000_invites.sql:16-34`):
  `status` ∈ `sent|opened|accepted|expired|revoked` (default `sent`); `scope_type`
  ∈ `partner|company|department`; single-use `code`; `sent_at/opened_at/accepted_at/
  expires_at(+14d)`.
- **Auto-verify on first sign-in:** trigger
  `trg_mark_invites_accepted_on_signin` (`20260529000000_invites_accepted_on_signin.sql:20-36`)
  flips `sent|opened → accepted, accepted_at=now()` on `last_sign_in_at` update.
  So verification is **automatic**, not manual.
- `profiles.status` ∈ `active|suspended` (`…20260521170000…:109-110`);
  `client_type` ∈ `client|employee`. **No explicit "verified" column on profiles** —
  verification state = `invites.status` + `auth.users.last_sign_in_at`.

**Propagation — the member ROW is consistent (single source of truth):**
- All member surfaces read **`profiles`**: enterprise org-wide
  (`app/api/enterprise/members/route.ts:52-59`, `organization_id + client_type='employee'`),
  dept-via-enterprise (`app/api/enterprise/departments/[id]/employees/route.ts:73-79`,
  `department_id`), dept admin (`app/api/department/employees/route.ts:46-54`,
  `department_id + client_type='employee'`). Same table → a member added on either
  side **appears everywhere immediately**. No stale-row/dup risk on the row itself.

**THE REAL BUG — verification-tracking asymmetry:**
- Dept-add writes an `invites` row; enterprise-add and attach do **not**. So the
  shared invite/verification-status source is **missing all enterprise-sourced and
  attached members** → the "who's verified / invited / pending" view is incomplete
  and inconsistent depending on who added the member. Attach also sends no email →
  attached members never get a verify link.
- **Fix shape (Phase 4):** route every add path through one helper that always
  records an invite + (where appropriate) sends verification, and surface a single
  derived status (invited→verified→active; suspended reversible) computed the same
  way on both consoles.

**Scoping:** `lib/department-auth.ts` (own dept), `lib/enterprise-auth.ts` (own
org, verifies `dept.enterprise_id == caller org` before listing a dept). Cross-org
guard `findUserInAnotherOrg()` on both add paths.

---

## 5. Resources content model

- Department `ResourcesView` lives in `app/(staff)/department/v2/_cc/views.tsx`
  (⚠️ in-flight file — see §7). Renders the product video(s) from `/public`.
- Reusable pattern from the partner portal
  (`app/(staff)/partner/v2/_portal/ResourcesView.tsx:16-20,102-111,147-158`):
  `<video>` figures + a `<Download>` anchor (`href` to a `/public` file, `download`).
- **How-to-use guide** slots the same way: a real doc asset in `/public`
  (PDF/MD) + an inline getting-started section, viewable + downloadable (mark
  "draft" if copy isn't final). New asset = collision-free; the wiring touches
  `ResourcesView` (in-flight).

---

## 6. Department nav escape (Phase E) — ALREADY FIXED

- `app/(staff)/department/v2/_cc/DeptClient.tsx:21,30,84` (in-flight): nav tab is
  now in-console **`Supervise`** (Eye icon) rendering `<SuperviseView/>`;
  `LINKS=[]` (no `/supervise` link-out). The legacy escape is gone.
- Enterprise equivalent is being handled in the same session
  (`docs/audit/enterprise-nav-fix-findings.md`, `EnterpriseClient.tsx` modified).
- **Action: none.** Do not touch nav config — it's owned by the in-flight session.

---

## 7. Concurrency / overlap map (CRITICAL)

Another session ("fixing supervise") has **uncommitted** edits + new files:

| Path | State | Owned by in-flight session |
|---|---|---|
| `department/v2/_cc/views.tsx` | M (−80) | UsageView/ResourcesView live here |
| `department/v2/_cc/DeptClient.tsx` | M | nav + tab wiring |
| `department/v2/_cc/types.ts` | M | `DeptTab` etc. |
| `department/v2/_cc/SuperviseView.tsx` | NEW | the Sessions→Supervise rebuild |
| `enterprise/v2/_cc/SuperviseView.tsx` | NEW | enterprise supervise |
| `enterprise/v2/_cc/EnterpriseClient.tsx` | M | nav |
| `enterprise/v2/_cc/types.ts` | M | |
| `app/_components/portal/SuperviseBoard.tsx` | NEW | shared board |
| `docs/audit/enterprise-nav-fix-findings.md` | NEW | enterprise nav fix |

**Collision-free slices (server + new files only):**
- **B-server** — reframe `app/api/department/usage/route.ts` (by-employee,
  by-project, budget+runway, CSV) — NOT in the in-flight diff.
- **D** — member propagation/verification fix in API routes
  (`app/api/department/employees/*`, `app/api/enterprise/.../employees*`,
  `app/api/enterprise/members`) + the `recordInvite`/verify helper — NOT in the diff.
- **C-asset** — the How-to-use guide file(s) in `/public` (+ a small reusable
  doc-link component as a NEW file).
- **A sessions-endpoint metadata audit** — read-only confirm
  `app/api/department/sessions/route.ts` already gates content (it does).

**Must NOT touch (in-flight):** any `department|enterprise/v2/_cc/*.tsx`,
`views.tsx`, `DeptClient.tsx`, `SuperviseView.tsx`, `SuperviseBoard.tsx`, nav
config, `enterprise-nav-fix-findings.md`. Wiring new UI into `views.tsx`/
`ResourcesView`/`OverviewView` must wait until that session lands, or be done by it.

---

### Evidence appendix — files read
`app/(staff)/department/v2/_cc/{DeptClient,views,OverviewView}.tsx`,
`app/api/department/{sessions,usage,route,employees/route,employees/[id]/refill}/…`,
`app/api/enterprise/{members/route,departments/route,departments/[id]/employees(/attach)(/refill)}/…`,
`lib/{department-auth,enterprise-auth,billing/minuteBundles,billing/partnerMargin,relay/kanonymity}.ts`,
`supabase/migrations/{20260513160000_session_health,20260521170000_enterprise_refill_and_minutes,
20260521200000_end_session_employee_billing,20260527240000_invites,
20260529000000_invites_accepted_on_signin}.sql`,
`docs/{RelayGreen_Spec_Decisions_v1,RelayGreen_Build_Ready_PRD_v1,gdpr-data-access-matrix}.md`.
