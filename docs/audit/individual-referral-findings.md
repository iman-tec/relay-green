# Individual-referral commission model — Phase 0 study

> STUDY ONLY. No code written. Every claim carries file:line evidence.
> Question this answers: can we apply the **individual 10/10** model (10% discount
> to the individual, 10% commission to the partner) on signup via a partner's
> Resources referral link — reusing existing commission/discount/ledger mechanics,
> additively, behind the partner flag, without touching the enterprise 20%
> wholesale-passthrough path? **Yes, but the referral link is a dead promise
> today and there is no dated per-accrual ledger — both are net-new.**

Companion to the Part 1 finding: the partner companies table alignment is
**already correct** (DOM-measured: every column's header + cells share one
alignment, numeric right / text-date left, em-dash follows its column). No change
needed there; this doc is entirely about Part 2.

---

## 0. Headline findings (read first)

1. **The referral link is generated but never consumed.** `ResourcesView.tsx:24`
   builds `https://<domain>/?ref=<reseller_code>` and the UI promises (`:87-88`)
   "Individual signups via this link are attributed to you." **Nothing reads
   `?ref=`** — not the homepage, not `proxy.ts`, not the login/OTP flow, not the
   `handle_new_user()` trigger. Individual referral attribution **does not happen
   today**. The 10/10 model is therefore net-new attribution, not a tweak.

2. **Individuals are already a distinct entity** — `profiles` with
   `organization_id IS NULL` (generated `account_type = 'organic'`). They never
   appear in the enterprise/companies tree, so a referral ledger over individuals
   cannot pollute the companies table (which is scoped to
   `organizations.reseller_id`).

3. **`profiles.reseller_id` already exists** (FK → `resellers.id`) but is only
   populated for staff/enterprise-admin hierarchy — **never for organic
   customers**. It is the natural, already-present attribution column to reuse.

4. **The enterprise 20% is super-admin-editable via a clean, mirrorable control**
   (`PATCH /api/admin/resellers/[id]`, `commission` 0–100, super_admin-gated).
   The individual 10/10 defaults should ride the same surface.

5. **There is no dated, per-event commission ledger today.** Enterprise margin is
   **computed read-time** from `used_minutes` rollups; the only persisted ledger
   is `partner_payouts`, a **monthly snapshot** (one row per reseller per
   `'YYYY-MM'`). The brief's "every accrual dated and traceable" requirement is
   **not met by the current read-time margin** at row granularity — the individual
   ledger needs its own dated rows (new table) or a per-referral accrual record.

---

## 1. Referral link mechanics today

**The link + its promise**
- `app/(staff)/partner/v2/_portal/ResourcesView.tsx:24` — `refLink = https://${BRAND_DOMAIN}/?ref=${reseller.code}`; QR at `:25`.
- `:87-88` — copy: "Individual signups via this link are attributed to you — separate from companies you onboard." (Promise made to the partner.)
- `reseller.code` resolves to `resellers.reseller_code` (format `RLC-XXYYZZ`):
  `supabase/migrations/20260521130000_enterprise_hierarchy.sql:47` (table),
  `supabase/migrations/20260521170000_enterprise_refill_and_minutes.sql:149` (RLC- format).

**Is `?ref=` consumed? — NO (verified across app/, lib/, proxy, migrations)**
- No `searchParams.get('ref')`, no `?ref=` read, no `ref`/`reseller` cookie or
  localStorage write anywhere in the signup/login path or `proxy.ts`.
- Individual signup flow: `app/login/SignInForm.tsx` → `app/api/auth/prepare/route.ts`
  → `app/api/auth/verify-otp/route.ts:87` (→ `/set-password`) →
  `app/api/auth/set-password/route.ts:45`. None carry a referrer.
- Profile creation is a DB trigger: `handle_new_user()` at
  `supabase/migrations/20260504092826_6cba82e1-7b0e-47cd-b105-a0555c7e76f6.sql:148`
  inserts **only `(id, full_name)`** — no referral/reseller capture.

**Verdict:** the referral link is **dead for attribution**. Building the 10/10
model means *implementing* attribution, not redirecting an existing one.

---

## 2. Enterprise vs individual entities

**Enterprise attaches under a partner via the org row:**
- `organizations.reseller_id` FK → `resellers(id)` —
  `20260521130000_enterprise_hierarchy.sql:115` (set on inorganic enterprise creation).
- `organizations.enterprise_type` `'organic' | 'inorganic'` — `…:3-24`.
- `organizations.partner_status` `'invited' | 'active' | 'paused'` —
  `20260607120000_partner_program.sql:45-47` (partner onboarding lifecycle).
- Provisioning: `lib/reseller-provision.ts:77-246` (`provisionReseller()`).

**Individual = organic profile, no organization:**
- `profiles` one row per `auth.users` —
  `20260504080450_…495ca832.sql:2-11`.
- Generated `profiles.account_type` = `'enterprise'` iff `organization_id IS NOT NULL`,
  else `'organic'` — `20260521130000_enterprise_hierarchy.sql:246-249`.
- Individual balance: `credit_wallets` (user_id PK, balance, lifetime_*) —
  `20260504110528_…184a9e78.sql:6-12`.
- Durable customer profile: `customer_profiles` —
  `20260522130000_customer_profiles.sql:25-39`.
- Sessions link to the individual via `guest_calls.customer_user_id` —
  `20260510130000_…session_state_machine.sql:25`.

**Already-present attribution column:**
- `profiles.reseller_id` FK → resellers —
  `20260521130000_enterprise_hierarchy.sql:93` (index `:268`). Populated today only
  for staff/enterprise-admin rows; **never for organic customers**. Reusing it for
  organics gives durable per-individual attribution with zero new columns (a
  dated attribution event still wants its own row — see §4).

**Conclusion:** individuals are cleanly separable from the enterprise tree; the
referral ledger keys on organic `profiles` (or a new attribution table), and can
never leak into the companies table (§5).

---

## 3. Existing commission / discount fields (reuse these, don't fork)

- `resellers.commission` numeric(6,2), **default 20** — Relay→partner wholesale %:
  `20260521170000_enterprise_refill_and_minutes.sql:42`; default enforced
  `20260608140000_reseller_commission_default_20.sql:13`.
- `resellers.default_passthrough_pct` numeric(5,2) —
  `20260607130000_partner_program_phase2.sql:17`.
- `organizations.discount_pct` (partner→enterprise passthrough, must be ≤ commission)
  + `discount_until` — `20260607120000_partner_program.sql:8`.

**Super-admin edit surface to MIRROR for the 10/10 defaults:**
- `PATCH /api/admin/resellers/[id]` — `app/api/admin/resellers/[id]/route.ts:23-27`
  (`requireSuperAdmin`), `:91-100` (validates `commission` 0–100, writes
  `resellers.commission`). Same shape extends to
  `individual_referral_discount_pct` / `individual_referral_commission_pct`.
- The 20% is surfaced in the admin v2 Resellers UI (`app/(staff)/admin/v2/ResellersTab.tsx`)
  — the per-partner edit control to clone.

**Discount-application path is flag-gated and enterprise-only today:**
- `partnerProgramEnabled()` — `lib/billing/partnerProgram.ts:19-22`
  (`NEXT_PUBLIC_PARTNER_PROGRAM`, **ON by default**, kill-switch `=0`/`false`).
- OFF: `discount_pct` is display-only; checkout charges full bundle.
  ON: an active partner discount **reduces the enterprise Stripe bundle price**.
- **There is no individual-discount application path.** Individuals pay full bundle
  into `credit_wallets`. Applying the individual 10% discount means adding a
  discount hook to the *individual* checkout/credit path (Phase 1 design item),
  reusing the same "active discount reduces price" mechanic, gated by the same flag.

---

## 4. Where commission is accrued/recorded today

**Persisted ledger — monthly snapshot only:**
- `partner_payouts` — `20260607120000_partner_program.sql:100-116`:
  `reseller_id`, `period` ('YYYY-MM'), `earned_cents`, `paid_cents`,
  `status` ('pending'|'paid'|'void'), `created_at`, `updated_at`,
  `UNIQUE (reseller_id, period)`. **One row per reseller per month** — not per event.

**Margin is otherwise computed read-time (not stored per transaction):**
- `lib/billing/partnerMargin.ts:54-71` `partnerEarnedCents()` =
  (wholesale − passthrough) × net_cents; `:40-52` `effectiveBundleCents()`.
- Portal derives `earnedLifetimeCents` from `organizations.used_minutes × LIST`:
  `app/api/reseller/portal/route.ts:233-237`. `used_minutes` rollup columns on
  resellers/organizations/departments/profiles:
  `20260521170000_enterprise_refill_and_minutes.sql:46,60,94,105`.

**Implication for the individual ledger:** the brief requires *every accrual
dated and traceable*. The enterprise model does NOT give that at row granularity
(it's read-time math + a monthly snapshot). So the individual-referral ledger
should be its own **dated, append-only accrual table** (e.g. one row per
discount-applied / commission-earned event, with `created_at`, `reseller_id`,
`customer_user_id`, `discount_cents`, `commission_cents`), optionally rolling up
into a `partner_payouts`-style monthly snapshot for payout. This is the cleanest
way to satisfy "no undocumented commission" without retrofitting the enterprise
read-time path.

---

## 5. Companies table data source (keep individuals OUT)

- `GET /api/reseller/portal` — `app/api/reseller/portal/route.ts:45-291` builds
  `PortalPayload.companies`.
- Company rows come from `organizations WHERE reseller_id = :resellerId`
  (`:68-74`), enriched with `guest_calls` month/last-activity (`:185-213`) and
  `invites` admin identity (`:130-152`).
- Typed `PortalCompany` — `app/(staff)/partner/v2/_portal/types.ts:6-22`; rendered
  `app/(staff)/partner/v2/_portal/OverviewView.tsx:120`.

**Why individuals can't leak in:** the query is scoped to
`organizations.reseller_id`, and individuals are `profiles` (not organizations).
They are structurally excluded. The "Individual referrals" view must be a
**separate endpoint + payload** (e.g. `GET /api/reseller/individual-referrals`)
reading the new attribution/ledger rows — never folded into `companies`.

---

## What this means for the build (feeds Phase 1 model & plan)

1. **Attribution is net-new.** Capture `?ref=<reseller_code>` → cookie at first
   touch (homepage/proxy) → resolve to `resellers.id` on signup → write
   `profiles.reseller_id` for the organic customer + a dated attribution/ledger
   row. Idempotent (one attribution per individual); guard self-referral
   (signup email == reseller owner) and re-attribution.
2. **Defaults config mirrors the 20%.** Add `individual_referral_discount_pct`
   (default 10) and `individual_referral_commission_pct` (default 10) on
   `resellers`, editable through the existing `PATCH /api/admin/resellers/[id]`
   super-admin control; record who/when on change (audit).
3. **Discount application reuses the flag + "active discount reduces price"
   mechanic**, but on the *individual* checkout/credit path (none exists yet).
4. **Dated ledger is required** — the enterprise read-time margin does not satisfy
   "every accrual dated and traceable." New append-only table, separate read view.
5. **No double-count:** an organic profile is never an organization, so an
   individual referral can never also be an enterprise passthrough. Enforce that
   attribution writes only when `organization_id IS NULL`.
6. **Flag:** gate all of it behind `partnerProgramEnabled()` (or a sub-flag);
   flag-off must be byte-identical — today that means the dead `?ref=` link stays
   dead, exactly as now.

---

### Evidence appendix — files read
`app/(staff)/partner/v2/_portal/{ResourcesView,OverviewView,types}.tsx`,
`app/api/reseller/portal/route.ts`, `app/api/admin/resellers/[id]/route.ts`,
`app/login/SignInForm.tsx`, `app/api/auth/{prepare,verify-otp,set-password}/route.ts`,
`lib/billing/{partnerProgram,partnerMargin}.ts`, `lib/reseller-provision.ts`,
`supabase/migrations/{20260504080450,20260504092826,20260504110528,20260510130000,
20260521130000_enterprise_hierarchy,20260521170000_enterprise_refill_and_minutes,
20260522130000_customer_profiles,20260607120000_partner_program,
20260607130000_partner_program_phase2,20260608140000_reseller_commission_default_20}.sql`.
