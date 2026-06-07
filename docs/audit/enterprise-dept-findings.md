# Enterprise & Department admin — Phase 0 findings

> **Study before design.** This maps the *current* enterprise-admin (`/enterprise`,
> login `/business`) and department-admin (`/department`) surfaces against live code,
> and the shipped Channel-Partner (CP) system to reuse. It proposes nothing — Phase 1
> (plan) and Phase 2 (mocks) come after review. Where this brief and the code disagree,
> the **code wins**; those points are flagged ⚑.
>
> Branch: `feature/cp-enterprise-onboarding`. Citations are file:line (line numbers
> approximate; the file is authoritative).

---

## 0. TL;DR — the five things that shape the plan

1. **⚑ `/enterprise/v2` and `/department/v2` ALREADY EXIST** — they are the *current*
   consoles (tabs inside StaffShell). The brief says "create flag-gated `/enterprise/v2`."
   The CP-consistent move is **not a new route** but the same pattern CP used: a flag
   branch inside the existing `PanelClient` (`if (flag) <CommandCenter/> else <LegacyPanel/>`).
   This needs an explicit decision in Phase 1.
2. **⚑ Enterprise/dept v2 are deliberately NOT bare-mode.** They render inside StaffShell's
   sidebar (`StaffShell.tsx:514` "intentionally NOT bare anymore"); their tabs are
   StaffShell NAV `?tab=` items. `/reseller/v2` IS bare (own `ResellerSidebar`). Mirroring
   the CP "bare-mode full-bleed" means *reversing* that decision for the flag-on console —
   a real choice, not a freebie.
3. **No transactions/usage ledger exists.** Enterprise spend is **synthetic**
   (`guest_calls.duration_minutes × 300¢`), minutes live in denormalized counters on
   `organizations`/`departments`. The brief's "transactions ledger" is a **gap** (see §3).
4. **"Spend updates automatically" is not how it works today.** Usage/billing tabs use a
   one-shot `useApiData()` fetch + manual reload — **no polling, no realtime**. Only the
   NotificationBell + MembersTab use `.channel()`. Auto-updating spend is **new wiring**.
5. **No org-level MSA terms gate exists**, and `terms_acceptances` has **no `terms_type`/scope**
   column. The CP clickwrap is the only acceptance flow and is partner-only. The brief's
   enterprise-wide MSA needs an additive `terms_type` + a new gate (see §5).

---

## 1. The CP system to REUSE (shipped, this branch)

| Asset | Path | Reuse for enterprise/dept? |
|---|---|---|
| `KpiRibbon` | `app/(staff)/reseller/v2/_portal/KpiRibbon.tsx` | ✅ generic (label/value/sub/anchor). Replaces enterprise's `StatCard` grid. |
| `StatusDot` | `…/_portal/StatusDot.tsx` | ✅ generic dot+label (status type is partner-flavored; widen the union). |
| `DrillPanel` | `…/_portal/DrillPanel.tsx` | ✅ ready as-is (right peek + scrim + Esc). |
| `format.ts` | `…/_portal/format.ts` | ✅ `eur`/`eurCompact`/`int`/`dateShort`/`relativeTime` — domain-neutral. |
| `ThemeTriplet` | `app/_components/ThemeTriplet.tsx` | ✅ already shared (Sun/Moon/Coffee). |
| `NotificationBell` | `app/_components/admin-v2/NotificationBell.tsx` | ✅ already used by both enterprise + dept (endpoint prop). |
| `lib/billing/*` | `partnerMargin`, `partnerTiers`, `partnerProgram` (flag), `partnerTerms` | discount math + flag reused; tiers are CP-only. |

**⚑ Reuse caveat:** `KpiRibbon`/`StatusDot`/`DrillPanel` live under `reseller/v2/_portal/`
(a reseller-scoped folder). To reuse cleanly without a reseller→enterprise import smell,
Phase 1 should decide whether to **promote them to a shared dir** (e.g.
`app/_components/portal/`) or import across. Recommend promotion. Design direction =
**Editorial Restraint** (ribbon not cards, one primary object, detail on demand,
sectioning by silence). `/reseller/v2` is the reference implementation.

How `/reseller/v2` is bare: `StaffShell.tsx:518` `isBare = pathname === "/reseller/v2" || startsWith("/reseller/v2/")`.

---

## 2. Current ENTERPRISE surface (`/enterprise/v2`, login `/business`)

**Shell:** `app/(staff)/enterprise/v2/page.tsx` (gate: `enterprise_admin` OR `super_admin`)
→ `PanelClient.tsx`. Renders **inside StaffShell** (not bare). Tabs are StaffShell NAV
`?tab=` items: **Overview · Usage · Billing · Settings** (legacy `dashboard|departments|members|wallet`
deep-links remap). Mounts `PartnerTermsGate` (CP clickwrap, partner-only).

**Auth:** `lib/enterprise-auth.ts` → `requireEnterpriseAdmin()` returns `{ ok, user, orgId, supabase, admin }`
(service-role). Admits `enterprise_admin` (and is reused by some routes for dept_admin); org resolved
from `profiles.organization_id`.

**Tabs (client components):**
- **Overview** (`OverviewTab.tsx` → `DashboardTab` / `DepartmentsTab` / `MembersTab`):
  KPIs + recent sessions (`/api/enterprise/me`, `/sessions`), department list + create, staff members + invite/erase.
- **Usage** (`UsageTab.tsx`): `/api/enterprise/usage` → `byDepartment[]` + `byPeriod[]` (6 mo),
  **k-anonymity** suppression server-side, CSV export. `perMinuteCents: 300`.
- **Billing** (`BillingWalletTab.tsx` = `WalletTab` + `BillingTab`): wallet snapshot + bundle buy
  (Stripe), `/api/enterprise/billing` revenue + "recentTransactions" (= last 10 ended sessions, synthetic).
- **Settings** (`SettingsTab.tsx`): org identity (name/domain/retention via `PATCH /api/enterprise/org`),
  enterprise code (read-only), **partner discount block** (if `channelPartner` non-null),
  notification prefs, export, internal-team invite.

**Enterprise API (`app/api/enterprise/**`, ~28 handlers):** `me`, `org` (PATCH),
`wallet` (GET), `wallet/checkout` (POST), `wallet/topup` (POST), `wallet/activate-plan`,
`billing`, `usage`, `sessions`, `notification-prefs`, `notifications[/[id]]`,
`members[/[id]]`, `members/[id]/{resend-invite,erase}`, `departments[/[id]]`,
`departments/[id]/{admin,refill,employees[/[empId]][/refill]}`, `regenerate-code`,
`accept-terms` (CP clickwrap), `export`, `users[/[id]]`.

**Primary object today:** diffuse (KPIs + departments + members + wallet across 4 tabs).
For a command center the natural **one primary object = Departments** (usage/minutes
rolling up), with Members + Wallet as ribbon/secondary — to confirm in Phase 1.

---

## 3. Current DEPARTMENT surface (`/department/v2`)

**Shell:** `app/(staff)/department/v2/page.tsx` (gate: `department_admin`; preview for
enterprise_admin/super_admin) → `PanelClient.tsx`, inside StaffShell. Tabs:
**Overview · Sessions · Usage · Settings**. **No clickwrap** (partner terms are enterprise-only).

**Auth:** `lib/department-auth.ts` → `requireDepartmentAdmin()` returns
`{ ok, user, departmentId, orgId, supabase, admin }`; requires **both** `department_id`
and `organization_id` on the profile; queries scoped by `departmentId`.

**Tabs:** Overview (`DeptDashboardTab` + `EmployeesTab` — dept KPIs, employees, refill),
Sessions (`/api/department/sessions`), Usage (`/api/department/usage`, byPeriod + k-anon),
Settings (dept name, notification prefs).

**Department API (`app/api/department/**`, 9 handlers):** `/` (PATCH rename),
`employees[/[id]][/refill]`, `usage`, `notification-prefs`, `notifications[/[id]]`, `sessions`.

**What a dept admin CAN'T do** (vs enterprise): create departments, manage other admins,
**buy minutes / see the wallet**, see billing, see org-wide usage, edit org identity.
Dept has `allocated_minutes` but **no self-refill** — only the enterprise tops it up
(`/api/enterprise/departments/[id]/refill` → `transfer_to_department`). The brief's
"department budgets" (dept self-recharge) would be **new** + flagged.

---

## 4. Wallet / recharge / minutes (DO NOT change the mechanism)

**Recharge path:** `WalletTab` → `POST /api/enterprise/wallet/checkout` (creates Stripe
PaymentIntent; **applies the CP discount here** — `effectiveBundleCents` when
`partnerProgramEnabled() && reseller_id && isDiscountActive`) → client confirms with Stripe
Elements → `POST /api/enterprise/wallet/topup` (re-verifies the PI, credits minutes via
`UPDATE organizations` / the `transfer_to_organization` RPC, idempotency via PI metadata
`relay_credited=1`).

**Minutes model:** denormalized counters `allocated_minutes` / `used_minutes` /
`remaining_minutes` on `organizations` (and `departments`, `profiles`). Cascade RPCs:
`transfer_to_organization` → `transfer_to_department` → `transfer_to_employee`. Minutes burn
at `end_session` (debits the leaf + rolls usage up). **Minutes always credit 1:1** regardless
of discount — the discount only changes the Stripe charge amount.

**⚑ No transactions ledger.** Searched migrations: the only ledger is
`credit_transactions`/`credit_wallets` (`20260504110528_…sql`) — those back **individual
customer** credit wallets, **not** enterprise/org wallets, and are untouched by
`/api/enterprise/**`. `partner_payouts` is a payout summary, not a per-event ledger. Spend
is synthetic (`× 300¢`) with explicit `TODO(api): swap to a real usage/billing ledger when
one exists` in `usage/route.ts`, `billing/route.ts`, `department/usage/route.ts`. **A
"transactions ledger" view must either (a) compose a synthetic ledger from Stripe recharges
(PI metadata) + ended sessions, or (b) add a new append-only table.** Phase 1 decision; (a)
is the break-nothing default.

**⚑ Spend does NOT auto-update.** Usage/billing tabs use `useApiData()` (`_shared.tsx`):
one fetch on mount + a manual reload button. **No `setInterval`, no `.channel()`.** Realtime
exists only in `NotificationBell` and `MembersTab`. Per the repo audit, realtime is
effectively non-functional in this app (REST-poll is the live transport). So "balance +
spend update live as sessions burn minutes" is **new work** — the safe option is a **poll**
(reuse the `useApiData` reload on an interval / focus), not a new realtime channel.

---

## 5. Terms / clickwrap — and the enterprise-wide MSA gap

**`terms_acceptances`** (`20260607120000_partner_program.sql`): `id, enterprise_id,
admin_user_id, terms_version, terms_sha256, accepted_at, ip, user_agent, created_at`.
RLS: org members read their org's rows; super_admin all; writes via service role.
**⚑ No `terms_type`/scope column.**

**CP clickwrap (the only acceptance flow today):** `PartnerTermsGate.tsx` (mounted in
enterprise PanelClient) → fires **only** when `partnerProgramEnabled()` AND
`GET /api/enterprise/accept-terms` returns `needsAcceptance` (i.e. `organizations.partner_status === 'invited'`).
`POST` writes a `terms_acceptances` row with `PARTNER_TERMS_VERSION` (`lib/billing/partnerTerms.ts`,
currently `"2026-06-07"`, links `/legal/contracting-terms`) + sha256 + IP/UA, then flips
`partner_status → 'active'`.

**Gaps for the enterprise MSA the brief wants:**
- **No org-level MSA gate exists.** `enterprise/v2/page.tsx` does not block on terms; only
  the partner gate does, and only for partner-onboarded orgs.
- **Conflation risk:** an enterprise MSA written to `terms_acceptances` today would be
  indistinguishable from partner terms (same table, no type). **Additive migration: add
  `terms_type` (e.g. `partner_commercial` | `enterprise_msa`) + a "current accepted vs
  latest version" concept.** This is the brief's "keep distinct from CP partner terms."
- **Downstream notice** ("your org accepted on [date]") has **no surface today** — new.
- The brief's model (one org-level acceptance by an authorized signer; departments/employees
  get notice, never re-sign; material change ⇒ admin re-accepts) is **all new** and aligns
  with the diagram supplied. The table is *shaped right* (org id, signer, version, hash, IP,
  time) once `terms_type` is added.

---

## 6. CP discount surfacing to the enterprise (verify, don't rebuild)

Already wired: `organizations.reseller_id` + `discount_pct` + `discount_until` +
`partner_status`; `resellers.commission` + `tier` + `default_passthrough_pct`.
`GET /api/enterprise/me` returns `org.discountPct/discountUntil/partnerStatus` and a
`channelPartner: { name, discountPct } | null`. `SettingsTab` renders a partner-discount
block when `channelPartner` is non-null. The discount **is applied at checkout**
(`wallet/checkout`, §4) and is covered by the CP regression suite.

**Gap:** there is **no prominent "your rate includes an X% partner discount via [Partner]"
callout in the recharge/billing flow** — only the Settings block. The brief wants this
surfaced honestly at recharge; it's a **display** addition (data already flows), not a rebuild.
Dept admins don't need CP economics.

---

## 7. Consolidated GAPS (what the redesign needs that doesn't exist)

| # | Gap | Today | Implication |
|---|---|---|---|
| G1 | New consoles vs existing `/enterprise/v2`,`/department/v2` | routes already exist | Mirror CP: flag branch in existing `PanelClient`, not new routes. ⚑ confirm in Phase 1 |
| G2 | Bare-mode full-bleed | deliberately NOT bare (StaffShell) | Flag-on console needs own rail (like reseller) — reverses a deliberate choice. ⚑ |
| G3 | Transactions/minutes ledger | synthetic spend, no ledger table | Compose synthetic ledger (Stripe PI + sessions) OR add append-only table (additive) |
| G4 | Live-updating balance/spend | one-shot fetch + manual reload | Add a **poll** (reuse useApiData on interval/focus); realtime is non-functional here |
| G5 | Enterprise-wide MSA gate | none (only partner clickwrap) | New blocking org clickwrap + endpoint + gate component |
| G6 | `terms_type`/scope on `terms_acceptances` | absent | Additive migration to separate `enterprise_msa` from `partner_commercial` + version tracking |
| G7 | Downstream "org accepted" notice | none | New lightweight notice for dept admins/employees |
| G8 | Discount callout in recharge flow | Settings only | Display addition (data already in `/me`) |
| G9 | Dept self-recharge / budgets | enterprise refills depts only | New, flag-gated, only if "department budgets" enabled |
| G10 | Promote CP primitives to shared dir | live under `reseller/v2/_portal/` | Move to `app/_components/portal/` for clean cross-role reuse |

## 8. Break-nothing constraints carried from CP

- New behavior behind a `NEXT_PUBLIC_*` flag, **off by default** → flag off = existing
  `/enterprise/v2` + `/department/v2` identical, any new endpoint 404s. Verify live (curl)
  exactly as CP did.
- **No money-path mutation.** Recharge + minute crediting untouched; discount surfaced, not
  rebuilt. `organizations.status` + existing columns untouched; **additive schema only**
  (`terms_type`, any ledger table).
- **No downstream MSA re-signing** — org acceptance binds the org; downstream gets notice.
- **dev ≡ prod shared Supabase backend** — avoid running onboarding/acceptance **write**
  flows against shared data; gate any mutation e2e behind throwaway test data + cleanup
  (the call CP made).

---
_Phase 0 deliverable. Next: Phase 1 plan — only after review. Last updated against
`feature/cp-enterprise-onboarding` HEAD._
