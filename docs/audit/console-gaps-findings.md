# Console gaps — Phase 0 findings (reseller / enterprise / department v2)

Status: **study only, no code changed.** Written 2026-06-08 for the "Restore
account menu + finish the partner/enterprise consoles" brief.

> **Headline:** the brief describes a pre-implementation state. Most of Phases
> 1–2 already shipped. The account menu is **present and working** in all three
> consoles; the onboard form **already** configures the discount (% + months)
> and persists it. The real, verifiable gaps are downstream: the discount is
> **stored but never applied to any price** (cosmetic today), and the company
> record lacks admin identity, real lifecycle, and last-activity. Per the prime
> directive ("where this brief disagrees with the code, the code wins") this doc
> records actual state with file:line and re-scopes the build accordingly.

Terminology note: the brief says **`passthrough_pct` / `default_passthrough_pct`**.
Those names **do not exist** in this codebase (only `app/room/RoomClient.tsx`
matches "passthrough", unrelated). The real columns are
`organizations.discount_pct` (numeric(5,2), default 0) and
`organizations.discount_until` (timestamptz) —
`supabase/migrations/20260527230000_org_discount.sql:12-14`. Everything below
uses the real names.

---

## 1. Account / settings menu — NOT a regression (premise outdated)

The brief's premise ("the account/settings menu is gone") is **false against
current code**. All three consoles have a working account menu with sign-out +
theme:

- **Reseller** (`/reseller/v2`, renders **bare** — no StaffShell): its own
  `ResellerSidebar.tsx` carries the chrome.
  - `ProfileButton` (`ResellerSidebar.tsx:333-462`): avatar + email + roleLabel,
    upward dropdown, **real Supabase sign-out** (`sb.auth.signOut()` at :371,
    flips engineer/supervisor presence off first, then `router.push("/staff")`).
  - `ThemeMenu` (`ResellerSidebar.tsx:264-320`): mounts the **full `ThemeTriplet`**
    (Sun/Moon/Coffee) in a hover/click popover, top of rail. Not just a bare icon.
- **Enterprise** (`/enterprise/v2`) and **Department** (`/department/v2`) render
  **inside StaffShell** (confirmed `StaffShell.tsx:485-487` — `isBare` is only
  `/admin/v2` and `/reseller/v2`; enterprise/department are explicitly *not*
  bare, see the comment at :481-484). They inherit StaffShell's account menu:
  - `ProfileButton` (`StaffShell.tsx:825-1094`): email + roles, **Sign out**
    (`handleSignOut` at :893-926, real `auth.signOut()`), Privacy/Terms panes,
    and an enterprise-only **Wallet** link (:1037-1047).
  - `ThemeTriplet` mounted in the sidebar header (`StaffShell.tsx:601`).

**What is actually missing vs the brief's §1 wish-list:**
1. **One shared `AccountMenu` primitive.** Today there are *three* hand-rolled
   profile/sign-out implementations: `ResellerSidebar.ProfileButton`,
   `StaffShell.ProfileButton`, and the inert `admin-v2/UserChip.tsx` +
   `admin-v2/SignOutButton.tsx` pair. They drift (e.g. reseller uses
   `engineer_set_online(false)`; StaffShell uses the newer
   `set_engineer_presence('offline')`). Promoting one `AccountMenu` (alongside
   the existing `KpiRibbon`/`StatusDot`/`DrillPanel` primitives) is a **refactor
   to prevent future drift**, not a restore.
2. **Profile name.** Menus show **email + role only**; no display name field.
   (`ResellerSidebar` has no name; StaffShell shows engineer alias only.)
3. **Org-MSA acceptance record (version + date).** Brief §1 wants enterprise/
   department to surface their MSA acceptance here. **This record does not
   exist** — see §5 below. Cannot surface what isn't stored; needs additive
   schema or must be dropped from scope.

**Recommendation:** treat §1 as (a) promote a shared `AccountMenu` and reuse it
in all three shells (behaviour-preserving), (b) add Profile name, (c) defer the
MSA line to §5's decision. Sign-out is already reachable — **not a blocker**, but
the shared primitive removes the drift risk the brief worries about.

---

## 2. Onboard discount config — ALREADY SHIPPED

The real onboard form is the **Modal inside `ClientsTab.tsx`** (Channel Partner →
Enterprises → "Onboard an enterprise"), *not* `_drawers/AddEnterpriseDrawer.tsx`.

- The Modal already has a **discount %** control (`ClientsTab.tsx:631-643`,
  default `10`, state at :111) and a **duration months** control (:658-670,
  default `12`, state at :112).
- It already POSTs `discountPct` + `discountMonths` to the API
  (`ClientsTab.tsx:149-156`).
- The success copy already reflects the chosen values:
  `"{discountPct}% discount for {discountMonths} months applied to {company}"`
  (`ClientsTab.tsx:592-595`). No hardcoded "0%".
- The API already accepts and **persists** them: `app/api/reseller/enterprises/
  route.ts:39-48` (reads), `:117-126` (clamps `0–100`, computes `discount_until`
  from months, writes `discount_pct` + `discount_until` to the org insert).

**Stale artifacts to clean (do not change behaviour):**
- `ClientsTab.tsx:147-148` carries a **stale TODO** — *"persist on the org (no
  column yet)"*. The column exists and the API persists; the comment is wrong.
- **`app/(staff)/reseller/v2/_drawers/AddEnterpriseDrawer.tsx` is dead code** —
  not imported by `PanelClient.tsx` or `ClientsTab.tsx` (grep: referenced only by
  itself + bug-logs; the admin-v2 `AddEnterpriseDrawer` is a *different* file).
  It still sends the old body shape (name/email/alloc, no discount). Leave it or
  delete it, but the live path doesn't touch it.

**Divergence from brief:** brief wants a server guard **`passthrough ≤ 20%`**.
The API currently clamps **`0–100`** (`route.ts:117`). The "20%" ceiling is the
partner-commission concept and is **not enforced** on discount. If we want that
rule it's a one-line `Math.min(20, …)` + UI `max={20}` — but confirm the product
intent first (discount % and the partner's 20% commission are different numbers;
clamping discount at 20 may be wrong).

**Recommendation:** §2 is essentially done. Scope it to: drop the stale TODO,
decide the ≤20% question, optionally delete the dead drawer.

---

## 3. Discount legibility & verifiability — PARTIAL; the real hole is application

### What exists (legibility)
`ClientsTab.tsx` drill-in already shows, per company:
- **Discount %** metric (`:461-468`), and a **"until {date}" line** when
  `discount_until` is set (`:474-486`).
- Spend-to-date, Your-commission, Client-since (`:453-472`).
The dashboard API returns `discountPct` + `discountUntil` per enterprise
(`app/api/reseller/dashboard/route.ts:103-104`).

### What is missing (legibility)
- **Months remaining** on `discount_until` (only the raw date is shown).
- **Earned-on-this-company to date** (commission is shown as a derived number,
  not an accumulated ledger figure — see note below).
- **Effective per-bundle price** the client pays (`list × (1 − discount)` vs
  list) — brief §3's "is it applied" affordance. Not rendered anywhere.

### THE BIG ONE — the discount is **never applied to a price** ⚠️
`discount_pct` / `discount_until` are **written at onboard and read only for
display.** No checkout / wallet / bundle path reads them:
- `app/api/enterprise/wallet/checkout/route.ts:59` uses `bundle.amountCents`
  directly — no discount multiplier.
- `supabase/functions/create-enterprise-checkout/index.ts:118` uses
  `p.priceCents` directly.
- `supabase/functions/create-credits-checkout/index.ts:90-91` uses the Stripe
  price lookup — no org-discount logic.
- Bundle catalog / list price: `lib/billing/minuteBundles.ts:17`
  (`LIST_CENTS_PER_MINUTE = 300`) and `:19-33` (starter/team/scale bundles);
  plan tiers `lib/billing/plans.ts:24-81`. None consult `discount_pct`.

**Consequence:** brief §3's regression check — *"a €50 bundle for a 10%-discount
company bills €45 and the portal reflects it"* — **currently FAILS.** The
discount is cosmetic. Making it *verifiable* first requires making it *real*.

**⚠️ Prime-directive tension:** the brief says "no money-path mutation; discount
config writes to the existing passthrough / `discount_until` fields, never
re-implementing checkout." But applying the discount **is** a money-path change
by definition. **This needs an explicit product decision before building:**
  - (a) Apply `discount_pct` at the wallet/bundle checkout (real €45 bill) —
    touches the money path; needs careful guardrails + tests, contradicts the
    "no money-path mutation" line.
  - (b) Keep the discount informational and only **show** the effective price in
    the UI (honours "break nothing" but the €45 regression check can't pass).
  - (c) Apply only within the existing reseller passthrough/credit ledger if one
    exists (needs confirmation it does).
**This is the single most important open question in the brief.** Flagging for
review, not guessing.

---

## 4. Company record enrichment — REAL GAPS, sources exist

The reseller dashboard (`app/api/reseller/dashboard/route.ts:94-106`) returns per
enterprise: id, name, code, **status (active/suspended only)**, minutes,
discount, **createdAt**. Missing, with available sources:

- **Admin name + email** — collected at onboard (`reseller/enterprises/route.ts`
  stores `full_name` on `profiles` at :217-226, and email+name in `invites` via
  `recordInvite` at :261-269) but **not returned** by the dashboard. Sourceable
  via `profiles.organization_id = org.id` + `user_roles.role = enterprise_admin`,
  or from `invites` (email/name where `scope_id = reseller`, `company_name`
  matches). **Additive read; no schema change.**
- **Real lifecycle (Invited → Accepted/Active → Paused).** Today only
  `organizations.status` (active/suspended) is surfaced. The **invite lifecycle
  already exists and is tracked**: `invites.status` ∈
  `sent|opened|accepted|expired|revoked` with `accepted_at`
  (`supabase/migrations/20260527240000_invites.sql:16-34`); the
  `mark_invites_accepted_on_signin` trigger flips `sent→accepted` on first
  sign-in (`20260529000000_invites_accepted_on_signin.sql:30-34`).
  `InvitationsView.tsx` already fetches `/api/invite` and shows accepted-vs-pending
  + resend/revoke (`app/api/invite/[id]/route.ts:54-85`). **The data is there;
  it's just not joined into the company row.** Map: invite `accepted` →
  Active/Accepted; invite `sent|opened` (no signed-in admin yet) → Invited;
  `org.status='suspended'` → Paused. Use the existing `StatusDot` states.
- **Onboarded date** — already present (`createdAt`, just unlabeled in some
  views).
- **Last activity (most recent session)** — **not exposed.** `guest_calls` has
  `organization_id` + `created_at`/`ended_at` (org-scoped RLS confirms the
  column: `20260601144813_guest_calls_rls_scope.sql:61-62`). No query returns
  `MAX(created_at)` per org today. Add a grouped read (or per-org subquery) to
  the dashboard. em-dash only when genuinely null.

**Recommendation:** §4 is the meatiest *safe, additive* work — extend
`/api/reseller/dashboard` to join admin identity + invite-derived lifecycle +
last-activity, and render them in the row/drill-in. No schema change needed.

---

## 5. MSA / org terms acceptance — DOES NOT EXIST

Brief §1 wants enterprise/department to surface "their org-MSA acceptance record
(version + date), per the terms model." **There is no org-level terms/MSA
acceptance record.** Searched: no `terms_version`, `accepted_at`, `msa`,
`clickwrap` columns on `organizations`; `app/api/enterprise/me/route.ts` returns
no terms fields (it returns id/name/domain/status/code/created_at/reseller_id/
discount_pct/discount_until/retention_days — `:28-34`). The only terms artifact
is **per-project-quote** `terms_url`
(`20260527340000_contract_management.sql`), unrelated to org onboarding.

**Decision needed:** either (a) add an additive `org_terms_acceptances` record
(version + accepted_at, stamped when the enterprise admin first accepts) and
surface it — net-new feature, or (b) drop the MSA line from §1 scope. The brief's
"additive schema only" allows (a); recommend confirming before building.

---

## 6. Lateral-thinking items (§ "make the overview earn its space")

All three are **net-new and buildable on existing data**, no schema change:
- **Attention grouping** (invited-not-accepted / discount-expiring / zero-activity
  vs healthy): needs §4's lifecycle + last-activity + §3's months-remaining first,
  then a client-side grouping in `ClientsTab` / `PartnerOverviewTab`.
- **Onboarding pipeline view**: `InvitationsView` already has the data
  (sent/opened/accepted + time-since + resend). Mostly a presentation pass +
  surfacing resend for stale invites (endpoint exists).
- **Discount-lapse flags**: derive from `discount_until` within the current
  month — pure client logic once months-remaining lands.

---

## Corrected build plan (supersedes the brief's phasing where code disagrees)

| Brief phase | Actual state | Re-scoped work |
|---|---|---|
| 1 Account menu | **Present + working** in all 3 | Promote one shared `AccountMenu`; add Profile name; MSA line gated on §5 |
| 2 Onboard discount | **Shipped** (ClientsTab Modal) | Drop stale TODO; decide ≤20% guard; dead-drawer cleanup |
| 3 Discount legible/verifiable | Display partial; **never applied** | **OPEN DECISION** (money-path) + add months-remaining / earned / effective-price |
| 4 Company enrichment | Real gaps, **sources exist** | Additive dashboard join: admin identity + invite-lifecycle + last-activity |
| 5 Overview attention/pipeline/lapse | Net-new | Build on §3/§4 outputs |

## Resolved decisions (operator review, 2026-06-08)
1. **§3 money-path → APPLY AT CHECKOUT (real bill).** Read `discount_pct` in the
   wallet/bundle checkout so a 10%-discount company truly bills 90%. Money-path
   change is **authorized** (overrides the brief's "no money-path mutation" line
   for this specific discount-application). Needs guardrails + tests; respect
   `discount_until` (expired → no discount).
2. **§2 guard → CLAMP ≤20%.** Enforce `discount_pct ≤ 20` server-side
   (`route.ts`) + UI `max={20}`.
3. **§5 MSA → ADD ADDITIVE RECORD.** New `org_terms_acceptances` (version +
   accepted_at), stamped on first enterprise-admin acceptance, surfaced in the
   account menu for enterprise/department.

**Phase 0 complete. Proceeding phase-by-phase (stop for review between each).**
