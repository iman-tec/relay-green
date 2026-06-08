# Department admin: Usage by-member + Settings-into-account-menu — Phase 0 study

> STUDY ONLY. No code written. Every claim carries file:line evidence.
> Two asks: (A) Usage must add per-member info + breakdowns; (B) fold the
> department **Settings** out of the left nav into the bottom-left **account
> menu** (where Theme + Sign out already live). Behind the enterprise/dept v2
> flag; metadata-only; department-scoped; money-path untouched.

> Scope note (from the brief): **Usage-by-member is the SAME surface as the
> department-console reimagining brief** (`docs/audit/dept-console-findings.md`
> §B). Build it once there. **This brief's unique, non-overlapping deliverable
> is the Settings-into-account-menu move (B)** — which is a near-trivial mirror
> of work already shipped for enterprise.

---

## 0. Headline findings

1. **Settings-move is already solved for enterprise** — commit `4fbf50e`
   ("move Settings to account menu"). `AccountMenu` already accepts an `items`
   prop; `CommandRail` forwards it as `accountItems`; `EnterpriseClient` passes
   a Settings item and dropped it from the nav. **Department = the same ~3 edits
   in `DeptClient.tsx`.** SettingsView already exists and is mostly functional.
2. **By-member usage is genuinely net-new** — the enterprise "Usage merged into
   Finance" is STILL month-totals (`byPeriod`), not by-member. No existing
   by-member component to reuse; the data exists though (per-member columns +
   session aggregation).
3. **Metadata-only caveat:** the enterprise `FinanceView` "Feedback" section
   renders **AI sentiment score + summary per session** — that is CONTENT and a
   metadata-only **violation** for an org admin (see §5). The department Usage
   must NOT copy it. Dept Usage = who/how-many-minutes/project label only.

---

## 1. Usage data source + per-member fields (metadata-safe)

**Current endpoint** `app/api/department/usage/route.ts`:
- Returns `{ byPeriod: [{ period, memberCount, suppressed, minutes, sessions,
  spendCents, suppressedLabel }], perMinuteCents: 300 }` — month buckets,
  **k-anonymity suppressed** below a member threshold (`lib/relay/kanonymity.ts`).
- Built from `guest_calls.duration_minutes` summed over the dept's members
  (`profiles.department_id`), `status='ended'`, grouped by month
  (`route.ts:44-68`). Spend synthetic = `minutes × 300` (`route.ts:18,82-84`).
- Current UI `app/(staff)/department/v2/_cc/views.tsx:33-120` `UsageView` — the
  two-row Month/Sessions/Minutes/Spend table the brief replaces.

**Per-member fields available, department-scoped:**
- `app/api/department/employees/route.ts:46-54` already returns per-member
  `id, full_name, client_type, status, allocated_minutes, used_minutes,
  remaining_minutes, created_at` (and the route resolves `last sign-in` /
  invite state — see propagation study). So **by-member usage needs no new
  table**: minutes from `profiles.used_minutes`; sessions + last-active by
  aggregating `guest_calls` over `customer_user_id ∈ dept members`
  (`department/sessions/route.ts:29-48` is the scoping ref). Spend = used×300.
- **Dormant signal:** member with `status` invited / `used_minutes = 0` / no
  recent `guest_calls` → "invited, never used" or "gone quiet". Derivable from
  the same data.
- **By-project:** `guest_calls.project_name` (metadata, PRD:492) aggregated per
  dept — sessions/minutes per project.
- **Budget & runway:** `departments.allocated_minutes / used_minutes /
  remaining_minutes` (`20260521170000_enterprise_refill_and_minutes.sql:91-97`).
  Runway = `remaining ÷ recent daily burn`. Spend is synthetic → **label the
  projection an estimate; don't tie to billing** (brief's instruction).

**Metadata classification (confirmed):** member-level usage (who used how many
minutes, last active, which project) is **metadata** — allowed
(`RelayGreen_Build_Ready_PRD_v1.md:484-509`, project_name explicit at `:492`;
`RelayGreen_Spec_Decisions_v1.md:563` "metadata only"). AI sentiment/summary is
**content** (`20260513160000_session_health.sql:1-6,24-26`,
`gdpr-data-access-matrix.md:37`) — **must stay out** of the dept Usage view.

---

## 2. Department Settings contents today

`app/(staff)/department/v2/_cc/views.tsx` `SettingsView` (`:123-290`):
- **Your profile** — name (editable; persists via `PATCH /api/profile`,
  `:154-159`), email (read-only, from `supabase.auth.getUser()`). **Functional.**
- **Department** — name / code / organization, all **read-only** (`:228-238`).
- **Appearance** — Theme via `<ThemeTriplet/>` (`:255`). (Also already in the
  account menu — would be redundant if duplicated.)
- **Terms** — static notice ("you act under your org's agreement … nothing to
  sign here") (`:260-272`). **Static text**, not a viewer.
- **Data retention** — static notice ("set at org level … view sessions under
  Supervise") (`:274-287`). **Static text**, view-only.

So today's dept Settings is: one functional control (profile name) + read-only
department facts + two static notices. The brief wants Profile / Theme / Terms
(view accepted version + date + download) / Data retention (view; controls only
if the role may change them — dept admin is view-only) — all functional. Terms
"download/accepted version+date" would be a small enhancement over the current
static notice (the `terms_acceptances` table exists —
`20260607120000_partner_program.sql:55-65` — but that's the partner clickwrap;
dept admins act under the org MSA, so likely just a view of the org's accepted
terms, not their own acceptance).

---

## 3. The account/profile menu (host for Settings)

`app/_components/portal/AccountMenu.tsx`:
- Already supports `items?: AccountMenuItem[]` — "Extra in-console actions (e.g.
  Settings) shown above Sign out" (`:25-41,164-179`). Renders identity header +
  `ThemeTriplet` (`:161`) + the items + Sign out (`:181-191`).
- `CommandRail` forwards a console's items as `accountItems` (touched +6 in
  `4fbf50e`; the enterprise rail passes them — verify the exact prop name
  `accountItems` in `CommandRail.tsx` before wiring).

**Enterprise reference (the template to mirror)** —
`app/(staff)/enterprise/v2/_cc/EnterpriseClient.tsx`:
- `:96-102` passes `accountItems={[{ label: "Settings", Icon: Settings,
  onClick: () => setTab("settings") }]}`.
- `:34-41` NAV has **no** Settings entry; `:48-56` VALID still includes
  `"settings"`; `:121` still renders `{tab === "settings" && <SettingsView/>}`.
- So Settings is reachable from the account menu, renders in the content region,
  and is gone from the nav.

**Department move (this brief's unique build, ~3 edits in `DeptClient.tsx`):**
1. Remove `{ key: "supervise"… }` — no: remove the **Settings** entry from
   `NAV` (`DeptClient.tsx:19-25`); keep `"settings"` in `VALID` (`:32-38`) and
   the `{tab === "settings" && <SettingsView/>}` render (`:86`).
2. Add `accountItems={[{ label: "Settings", Icon: Settings, onClick: () =>
   setTab("settings") }]}` to the `<CommandRail>` (`:62-74`).
3. Drop the now-redundant **Appearance/Theme** block from `SettingsView` (Theme
   already lives in the account menu) — optional polish.
Everything else (profile save, etc.) already works.

---

## 4. Other consoles' Settings (note; don't change unless in scope)

- **Enterprise:** already moved (`4fbf50e`). ✅
- **Partner/CP portal:** Settings is **still a left-nav item** —
  `app/(staff)/partner/v2/_portal/PortalSidebar.tsx` NAV includes `settings`,
  rendered in `PortalClient.tsx`. Consistent fold would move it to the partner
  `AccountMenu` too — **out of scope here; note only.**
- No dead Settings links found beyond the nav entries themselves.

---

## 5. ⚠️ Related finding — metadata-only violation in enterprise FinanceView

`app/(staff)/enterprise/v2/_cc/FinanceView.tsx:85-98,237-280` renders
`/api/internal/feedback` — **AI sentiment `score` + `summary` per session** with
customer/engineer names. AI sentiment/summary is **content**
(`20260513160000_session_health.sql`, `gdpr-data-access-matrix.md:37`), and the
spec bars org admins from content (`Spec_Decisions:563`). This is in committed
enterprise code (`1713b9f`), not in scope here, but it's the same metadata-only
boundary the department work must hold — **flag for the enterprise owner.** The
department Usage must not introduce any equivalent feedback/sentiment section.

---

## Build plan implication (for review)

- **B (Settings → account menu)** is this brief's piece: mirror enterprise in
  `DeptClient.tsx` (+ optional drop of the duplicate Theme block in SettingsView,
  + optionally enrich Terms to show accepted-version/date). Small, additive,
  flag-safe.
- **A (Usage by-member)** is the shared surface owned by the department-console
  reimagining work — build there once (by-member incl. dormant, by-project,
  budget+runway estimate, monthly trend, CSV), department-scoped, metadata-only.
- **C (suggestions)** — adoption nudge (resend invite), per-member refill from
  Usage (reuse `transfer_to_employee`), low-minutes alert (notifications bell),
  live-now, member detail (metadata) — all reuse existing endpoints; confirm
  which to build.

---

### Evidence appendix — files read
`app/(staff)/department/v2/_cc/{DeptClient,views}.tsx`,
`app/(staff)/enterprise/v2/_cc/{EnterpriseClient,FinanceView}.tsx`,
`app/_components/portal/AccountMenu.tsx`,
`app/api/department/{usage,employees,sessions}/route.ts`,
`supabase/migrations/{20260521170000_enterprise_refill_and_minutes,
20260513160000_session_health,20260607120000_partner_program}.sql`,
`docs/{RelayGreen_Spec_Decisions_v1,RelayGreen_Build_Ready_PRD_v1,
gdpr-data-access-matrix}.md`, `git show 4fbf50e --stat`.
