# Back-office Revamp — Audit & Plan

Scope: rebuild **Enterprise**, **Department Manager**, and **Channel Partner**
(formerly "Reseller") flows to (a) match the redesigned customer/engineer
surfaces and (b) be GDPR-compliant by design. One flow at a time.

Status: **Section 0 audit complete. No flow code written yet.**

---

## 1. Stack / routing / styling / data / auth

- **Framework**: Next.js 16 (App Router) + React 19 + Tailwind v4. `proxy.ts`
  (not `middleware.ts`) is the edge layer.
- **Persistence**: Supabase (Postgres + auth + realtime). Prisma is a
  data-model document only, not wired at runtime.
- **Styling / design system**: token-driven primitives in
  [`app/_components/ui`](../app/_components/ui) — **no raw hex**. Token values
  live in [`app/globals.css`](../app/globals.css) (authoritative);
  [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md) is authoritative for *rules &
  patterns* but its color table is **stale** (still lists the retired coral
  palette). Real brand green is `--primary` `#16a34a` (light) / `#22c55e`
  (dark, espresso).
- **Themes (3, all required)**: `light`, `dark` (DEFAULT), `espresso` (the
  "Coffee" theme). Implemented by
  [`ThemeProvider`](../app/_components/ThemeProvider.tsx) (DOM contract: light
  = no class, dark = `.dark`, espresso = `.espresso` on `<html>`; persisted in
  `localStorage["relay-theme"]`; pre-hydration script avoids flash). Switcher
  = [`ThemeTriplet`](../app/_components/ThemeTriplet.tsx) (Sun / Moon / Coffee).
  `FloatingThemeToggle` is **hidden on all staff routes**, so each back-office
  panel must mount its own `ThemeTriplet`.
- **Auth/roles**: roles in `public.roles` + `user_roles`; names read via the
  `user_role_names` view. TS mirror in [`lib/relay/roles.ts`](../lib/relay/roles.ts).
  Role checks are **duplicated per page** (the `(staff)` layout only checks
  auth, not role) + per API route via gate helpers.

### Role hierarchy (`lib/relay/roles.ts`, labels `lib/relay/role-labels.ts`)

| Identifier | rank | Label | Scope |
|---|---|---|---|
| `super_admin` | 100 | Super Admin | platform |
| `reseller` | 90 | **Channel Partner** | commercial broker |
| `enterprise_admin` | 80 | Enterprise Admin | one org |
| `department_admin` | 70 | Department Admin | one department |
| `supervisor` | 50 | Supervisor | platform ops |
| `engineer` | 30 | Engineer | platform ops |
| `client` | 10 | Client | end-user/employee |

Legacy aliases still resolve via the `has_role()` shim
(`20260521140000_has_role_legacy_shim.sql`): `admin`→`enterprise_admin`,
`ops_manager`→`department_admin`, `pod_lead`→`supervisor`, `builder`→`client`.
**Hazard**: existing RLS that reads `has_role(…,'admin')` now grants *every*
enterprise_admin; `'ops_manager'` grants *every* department_admin —
platform-wide, not org-scoped.

---

## 2. Design-system source of truth (for matching the rebuild)

**Two visual layers exist in tension.** The canonical one is the token-driven
`app/_components/ui` layer + `globals.css` tokens. The redesigned *staff*
surfaces (StaffShell, DashboardClient, InboxClient, EngineerSessionClient,
EngineerPresenceBadge) still carry a **deprecated olive raw-hex**
`BRAND_GREEN = "#3f5c2e"` (+ `URGENT_AMBER`, `CRIT_RED`). **The rebuild must
use the token layer, never the olive constants.** (`DESIGN_SYSTEM.md` forbids
new uses of `BRAND_GREEN`.)

### Tokens (subset; `globals.css` authoritative)
`--background`, `--surface`, `--surface-raised`, `--border`, `--border-strong`,
`--text`, `--text-muted`, `--text-faint`, `--primary` / `--primary-hover` /
`--primary-soft` / `--primary-tint`, `--green-dot`, status: `--ok`/`--warn`/
`--risk` (+ `-soft`), `--scrim`, motion `--motion-fast/med/slow`. Fonts:
`--font-serif` (Source Serif 4, titles), `--font-sans` (Inter, UI),
`--font-mono` (JetBrains Mono, code/IDs).

### Reusable primitives — `@/app/_components/ui` (use these, don't reinvent)
`Button` (primary/secondary/ghost/danger/launcher; sm/md/lg/xl),
`IconButton` (aria-label required), `Input`, `Textarea`, `OtpDigitInput`,
`Chip`/`ChipGroup`, `StatusBadge` (tone ok/warn/risk/info/neutral, each with a
glyph — never color-only), `HealthBar`, `Card`/`CardHeader`/`CardBody`/
`CardFooter` (surface/raised/hollow, `interactive`), `EmptyState`,
`SectionHeader`, `Avatar` (xs/sm/md/lg; neutral/ok/brand), `Modal` (full a11y:
focus-trap, ESC, scrim, scroll-lock), `Toolbar`, `Toast`.

### Layout patterns to reuse
- **Stat cards** (icon-in-rounded-square + big tabular number + muted label) —
  `DashboardClient.tsx` `STATS`, grid `grid-cols-2 md:grid-cols-4`.
- **Section wrapper** (bordered rounded-xl card, header + stacked rows) —
  `DashboardClient.tsx` `Section`.
- **List rows** (avatar/dot + name + meta + right-aligned status pill +
  action) with `border-t` separators; truncate + `min-w-0 flex-1`.
- **Three-panel** — **prefer `react-resizable-panels`** (as RoomClient /
  EngineerSessionClient) over `InboxClient`'s fixed `280px 1fr 320px` grid,
  which is the known **overflow bug** (no breakpoint, no mobile fallback).
- **Scroll idiom**: outer `h-screen overflow-hidden`; each pane
  `flex min-h-0 flex-col overflow-hidden`; scroll region `flex-1 overflow-y-auto`
  (`.hide-scrollbar` optional). `min-h-0` is load-bearing.
- **Presence "Online ▾"** dropdown — `EngineerPresenceBadge.tsx` (currently
  raw-hex; reuse pattern with tokens).
- **v2 panels render in StaffShell "bare mode"** (`/enterprise/v2`,
  `/department/v2`, `/reseller/v2`, `/admin/v2`) — no shell sidebar; each panel
  owns its header (`admin-v2/TabsHeader`) + `ThemeTriplet`.

**Responsiveness rule (global fix)**: every new screen fits the viewport, uses
the scroll idiom, works at 360 / 768 / 1024 / 1440; sidebars collapse; tables
become stacked cards or horizontally-scrollable with a sticky first column. Do
**not** copy Inbox's fixed grid or its sub-12px text / `h-9` buttons (they
violate the 44px touch-target rule).

---

## 3. Current state of the three flows

### Enterprise admin
- **Routes**: legacy `/enterprise`, `/enterprise/departments`,
  `/enterprise/wallet` (old-design, inline-styled, olive hex);
  `/enterprise/v2` (new `admin-v2/*`, bare mode) — **only Departments tab
  live; Dashboard + Wallet are stubs**. `/enterprise/supervise` redirects away
  (orphaned client).
- **API** `/api/enterprise/*` via `requireEnterpriseAdmin()` — **service-role
  client (bypasses RLS)**, manual `orgId` scoping; gate also accepts
  `department_admin`.
- **Exists**: KPI strip, 30-day SVG sparkline, recent-sessions table + 5-row
  CSV, revenue card, departments table + create/refill/deactivate, wallet
  (Stripe Elements). **Missing**: real usage/reporting (charts, date ranges,
  per-dept/per-engineer), an org **Settings** page, a **Privacy & Data** panel.
  Revenue is **synthetic** (`duration_minutes × 300¢`), plan activation is
  browser-trusted.
- **PII over-exposure** (fix server-side): `/api/enterprise/sessions` returns
  `customerEmail` + `ai_summary_title` the dashboard never renders;
  `/api/enterprise/billing` embeds `guest_name` into transaction labels + leaks
  `stripe_customer_id`/`stripe_subscription_id`; `/api/enterprise/departments/
  :id/employees` returns per-employee `email` + `lastSignIn` + individual
  minutes. Four routes call `auth.admin.listUsers({perPage:1000})` (enumerate
  all auth users to map emails).

### Department Manager
- **Routes**: `/department` (legacy), `/department/v2` (EmployeesTab + drawers).
- **API** `/api/department/*` via `requireDepartmentAdmin()` — **correctly
  scoped to the caller's single `department_id`** (resolved from own profile,
  never client input); per-row ownership re-checked on mutate. No cross-dept or
  org-wide leak. Sees own department members' names+emails — **intended** (they
  are the manager's direct reports). No billing, no other departments.
- Verdict: scoping is sound; needs the redesign + k-anonymity on usage +
  explicit "not authorized" state on foreign-department routes.

### Channel Partner (formerly Reseller) — COMPLIANCE-CRITICAL
- **Routes**: `/reseller` (legacy, dashboard-only, no PII), `/reseller/v2`
  (`EnterpriseTab` = the leak surface), drawers.
- **The violation**: `GET /api/reseller/orgs/[id]/departments/[deptId]/
  employees` returns, **per member**, `displayName` (full_name), `email`,
  `lastSignIn`, and individual minutes — rendered in `EnterpriseTab.tsx` as
  Name/Email columns + a dept-admin card with name+email. A Channel Partner is
  a third party with **no lawful basis** for end-user PII.
- Cross-*tenant* isolation **is** enforced (reseller sees only their own
  enterprises). The violation is **vertical** over-fetch within their tenancy.
- **Exact fix points**:
  - `app/api/reseller/orgs/[id]/departments/[deptId]/employees/route.ts:54`
    (drop `full_name` from select), `:80-90` (remove `listUsers` email/
    lastSignIn enrichment), `:92-107` `toRow()` (stop returning `displayName`/
    `email`/`lastSignIn`).
  - `app/(staff)/reseller/v2/EnterpriseTab.tsx:629,633` (dept-admin name/email)
    and `:717-719,731,734` (employee Name/Email columns) — remove.
  - Better: rebuild partner endpoints so they **physically cannot** return
    member rows — aggregate-only (counts + minute totals), k-anonymity applied.

### "Reseller" → "Channel Partner" rename
- **870 occurrences across 67 files.** `lib/relay/role-labels.ts` already maps
  `ROLE.reseller → "Channel Partner"` for display, and v2 panel titles already
  say "Channel Partner". The **role identifier and DB tokens remain
  `reseller`** (`resellers` table, `reseller_id`, `reseller_code`,
  `ROLE.reseller`). Renaming the DB token is a large blast radius (43–47
  matches per hierarchy migration + RPCs); UI-string + route-segment +
  component-name rename is the immediate, lower-risk pass. Decision needed:
  rename DB tokens too, or keep `reseller` as the internal identifier and only
  change every user-facing string/route/component (recommended for safety).

---

## 4. GDPR gaps (must fix at the data layer, not just UI)

1. **`guest_calls` is world-readable** — RLS `"Public read guest_calls"
   USING(true)` exposes every session row (incl. `guest_name`, `guest_email`,
   `customer_user_id`, durations, AI summary titles) to any authenticated user
   *and anon*. Acknowledged-but-unfixed in
   `20260519100000_guest_calls_pod_scope.sql`. **Single largest hole.**
2. **`profiles` has no org/department/reseller RLS scoping** — org isolation
   exists *only* in app-code `.eq()` filters because every `/api/enterprise|
   department|reseller/*` route uses the **service-role client**. A single
   missed filter = cross-tenant leak. (Org-scoped profile policies were dropped
   for recursion; reintroduce via a `SECURITY DEFINER current_user_org_id()`
   helper.)
3. **No k-anonymity anywhere** — manager/partner dashboards expose individual
   member rows directly. A group of 1 yields fully-attributable "aggregate"
   stats. Add minimum-group-size (default **k = 5**) suppression →
   "insufficient data to display".
4. **No access-audit log** — `session_audit_log` records session *state
   transitions*, not who-read-which-member's-data. Add an access log written
   in the gate helpers for partner + admin reads (GDPR Art. 30).
5. **No data-subject-rights controls** — no export / erasure / retention UI;
   belongs to the Enterprise admin (controller), never the Channel Partner.

---

## 5. Proposed file-by-file plan — FLOW 1 (Enterprise) first

> Build against the token `ui/` layer in StaffShell bare mode; 3 themes;
> responsive; reuse `admin-v2/*` where it already fits (DepartmentsTab is the
> reference). Where backend is absent, build against typed stubs + `TODO(api):`.

**Data layer / GDPR (do first — minimization is server-side):**
- `lib/relay/kanonymity.ts` — NEW. `suppressBelowK(rows, k=5)` helper +
  `K_ANON_THRESHOLD` constant. Used by all aggregate endpoints.
- `app/api/enterprise/sessions/route.ts` — stop returning `customerEmail` +
  `ai_summary_title` unless explicitly needed; add aggregate mode.
- `app/api/enterprise/billing/route.ts` — drop `guest_name` from transaction
  labels; stop returning `stripe_customer_id`/`stripe_subscription_id` to the
  browser.
- `app/api/enterprise/usage/route.ts` — NEW. Aggregated per-department /
  per-period usage with k-anonymity. `TODO(api)` for real billing source.
- `lib/enterprise-auth.ts` — add access-audit write; tighten to
  `enterprise_admin` only where dept-admin shouldn't reach.

**UI (7 screens, new-design, themed, responsive):**
- `app/(staff)/enterprise/v2/PanelClient.tsx` — wire all tabs.
- `app/(staff)/enterprise/v2/DashboardTab.tsx` — replace stub: stat cards,
  live-now, recent sessions (no raw email), top departments.
- `app/(staff)/enterprise/v2/DepartmentsTab.tsx` — keep (reference), polish to
  tokens + responsive; department detail + assign manager.
- `app/(staff)/enterprise/v2/MembersTab.tsx` — NEW: invite, role/department
  assign, deactivate, seat usage.
- `app/(staff)/enterprise/v2/UsageTab.tsx` — NEW: charts by dept/period/
  expertise + CSV export, k-anonymity suppression.
- `app/(staff)/enterprise/v2/BillingTab.tsx` — replace stub: pay-per-minute
  model, payment method, statements/invoices.
- `app/(staff)/enterprise/v2/SettingsTab.tsx` — NEW: org profile + SSO + a
  **Privacy & Data** panel (retention window, export, member erasure) wired or
  clearly `TODO(api)`-stubbed.
- Shared: reuse `app/_components/ui` (`Card`, `StatusBadge`, `Button`,
  `EmptyState`, `Avatar`, `Modal`, `SectionHeader`) + `ThemeTriplet`; any new
  shared component flagged in the changelog.

**Docs**: update this file + `gdpr-data-access-matrix.md` after the flow;
add a changelog of files added/changed/removed.

Flows 2 (Department Manager) and 3 (Channel Partner) follow the same shape;
Flow 3 additionally does the PII-stripping at the data layer + the rename pass.

---

## 7. FLOW 1 — Enterprise — CHANGELOG (built)

**Data layer (GDPR minimization):**
- `lib/relay/kanonymity.ts` — NEW. Per-context threshold map
  (`partnerEnterprise`/`department`/`periodSlice`, k=5), distinct-member
  suppression. Never suppresses seat/plan/status/renewal/commission.
- `app/api/enterprise/sessions/route.ts` — removed `customerEmail` +
  `summaryTitle` from output + select.
- `app/api/enterprise/billing/route.ts` — generic transaction labels (no
  `guest_name`/AI title); removed `stripeCustomerId`/`stripeSubscriptionId`
  from the response.
- `app/api/enterprise/usage/route.ts` — NEW. Aggregated per-department +
  per-period usage with k-anon suppression.
- `lib/relay/accessAudit.ts` + `supabase/migrations/20260527210000_access_audit_log.sql`
  — NEW access-audit table + writer; wired into
  `app/api/enterprise/departments/[id]/employees/route.ts` (member-PII read).
- `supabase/migrations/20260527220000_guest_calls_rls_scope.sql` — NEW,
  **written but HELD (not applied)** per decision. Replaces world-readable
  `guest_calls` SELECT with a scoped policy + `current_user_org_id()` helper.
  Needs per-role staging test before apply.

**UI (StaffShell bare mode, token layer, 3 themes, responsive):**
- `app/(staff)/enterprise/v2/_shared.tsx` — NEW. `useApiData` hook,
  `eur`/`num` formatters, `TabBody` scroll container, `StatCard`,
  loading/error states.
- `app/(staff)/enterprise/v2/PanelClient.tsx` — rewritten: 6 tabs
  (Dashboard, Departments, Members, Usage, Billing, Settings), `?tab=` URL
  state, `ThemeTriplet` mounted (bare mode).
- `DashboardTab.tsx` — replaced stub: stat cards, recent sessions (no PII
  email/summary), top departments.
- `MembersTab.tsx` — NEW: roster table + invite modal (POST
  /api/enterprise/users).
- `UsageTab.tsx` — NEW: per-month bars + per-department list with k-anon
  suppression ("Insufficient data to display"), CSV export skipping
  suppressed rows.
- `BillingTab.tsx` — replaced stub: pay-per-minute model, revenue cards,
  transactions, statement CSV.
- `SettingsTab.tsx` — NEW: org profile + Privacy & Data panel (retention,
  export, erasure — `TODO(api)` stubs).
- `DepartmentsTab.tsx` — kept (existing v2 reference; department detail
  drill-in lives here).

### Self-review vs acceptance criteria
- ✅ 6 tabs covering the 7 screens (department detail = drill-in inside
  Departments). Token layer + `ThemeTriplet` → all 3 themes resolve via
  tokens (no raw hex in new files).
- ✅ Responsive: `TabBody` scroll container + `max-w-screen-xl`; stat grids
  `grid-cols-2 lg:grid-cols-4`; tables `overflow-x-auto min-w-[…]`; no fixed
  Inbox-style grid.
- ✅ Empty / loading / error states on every data view (`LoadingState`,
  `ErrorState`, `EmptyState`).
- ✅ Org-scoped data only (existing `requireEnterpriseAdmin` orgId scoping) +
  PII minimization applied; k-anon on usage.
- ✅ Privacy & Data panel present (retention/export/erasure), backend stubbed
  with `TODO(api)`.
- ⚠️ **Not visually verified** in-browser across the 3 themes / 4 widths —
  needs an `enterprise_admin` login (none seeded handy). Routes compile +
  serve + gate correctly (`/enterprise/v2` 307 unauthed; `/api/enterprise/
  usage` 401 unauthed); typecheck + lint clean.
- ⏸️ `guest_calls` RLS migration HELD (not applied) per decision.

**How to view locally**: sign in as an `enterprise_admin`, visit
`/enterprise/v2` (or `?tab=usage` etc.). Toggle Sun/Moon/Coffee in the header;
check 360 / 768 / 1024 / 1440 widths.

---

## 6. Decisions (CONFIRMED)

1. **Rename = UI/routes/components only.** Rename every user-facing string,
   route segment, component name, and comment to "Channel Partner". **Keep the
   internal role token + DB tables as `reseller`** (`ROLE.reseller`,
   `resellers`, `reseller_id`, `reseller_code`). Lower risk; display already
   says "Channel Partner".
2. **`guest_calls` RLS fix is IN SCOPE here.** Tighten the `USING(true)` SELECT
   to participants / claimed engineer / supervisor / org-admin scope. Test the
   existing customer + engineer flows for regressions (they read guest_calls
   heavily).
3. **Billing = synthetic + `TODO(api)`.** Wire the Enterprise Billing screen to
   the existing `duration_minutes × 300¢` numbers; mark `TODO(api):` for a real
   billing/credit ledger.
4. **k-anonymity = k = 5, per-context map.** A configurable map keyed by
   context (`partnerEnterprise`, `department`, `periodSlice`) so partner-facing
   thresholds can be tightened later independently. Suppression applies **only
   to member-derived usage aggregates** (minutes/sessions rolled up from people)
   — **never** to seat count, plan, status, renewal date, or commission, which
   always render regardless of group size. Count **distinct contributing
   members**, not sessions.
