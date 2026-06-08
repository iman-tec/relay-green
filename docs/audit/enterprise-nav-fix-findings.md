# Enterprise nav fix — Phase 0 findings

**Bug:** In the flag-on enterprise console (`/enterprise/v2`), the left-rail
**Supervise ↗** and **Finance ↗** entries are real outbound `<a href>` links to
the legacy standalone routes `/supervise` and `/finance`. Clicking them
full-page-navigates the admin **out of the bare v2 console** (own `CommandRail`)
and into the StaffShell-rendered legacy surfaces — a different shell, nav, and
chrome. Same escape exists in the **department** console (Supervise only).

The code comments call this the "G2 guardrail" and frame the link-outs as
*intentional* (preserve every nav StaffShell gave these admins). The brief
overrides that: an in-console nav item must keep the admin inside the console.

---

## 1. Where the enterprise nav defines Supervise & Finance

| What | File:line |
|------|-----------|
| Enterprise v2 in-console tabs (`NAV`) | `app/(staff)/enterprise/v2/_cc/EnterpriseClient.tsx:31-38` — Overview, Recharge, Usage, Members, Settings, Resources |
| Enterprise v2 **external link-outs** (`LINKS`) | `app/(staff)/enterprise/v2/_cc/EnterpriseClient.tsx:40-43` — `Supervise → /supervise`, `Finance → /finance` |
| Rail component that renders both | `app/_components/portal/CommandRail.tsx:25-143` |
| `NAV` rendered as `<button onClick={onSelect}>` (stay in-console, `?tab=`) | `CommandRail.tsx:77-104` |
| `LINKS` rendered as `<a href>` with `↗` suffix (escape) | `CommandRail.tsx:106-132` |

**Why they carry the `↗` and the others don't:** the rail splits its two inputs
by construction. `nav[]` items are buttons wired to `onSelect` → caller flips
`?tab=` and stays on `/enterprise/v2`. `links[]` items are plain anchors to
foreign routes, rendered in a separate bordered block (`CommandRail.tsx:106-131`)
with a hardcoded `↗` glyph (`:126-128`). So the `↗` is the rail's marker for
"this is an outbound link, not a tab." No `target="_blank"` — it's a same-tab
full navigation, which is why the admin lands fully inside the legacy shell.

## 2. What they currently point to

- **Supervise** → `/supervise` (`EnterpriseClient.tsx:41`). For an enterprise
  admin, `app/(staff)/supervise/page.tsx` branches to
  `app/(staff)/enterprise/supervise/EnterpriseSuperviseClient.tsx` — an
  **org-scoped, read-only** live-session grid (Live / Waiting / Past tabs,
  metrics strip, no Join CTA), polling `/api/enterprise/sessions?limit=200`.
- **Finance** → `/finance` (`EnterpriseClient.tsx:42`).
  `app/(staff)/finance/page.tsx` is enterprise-admin-only and renders
  `FinanceClient` — org-level **revenue strip** (this month / 30d / lifetime
  from call minutes) + **AI sentiment feedback feed** (latest ~40 sessions).
  Both render inside StaffShell — hence the shell swap.

## 3. Do in-console equivalents exist?

**No — neither console has a Supervise or Finance *tab*.**

- Enterprise v2 tabs cover staffing + wallet: Overview (dept roster + KPI),
  Recharge (wallet top-up + ledger), Usage (month-by-month spend), Members,
  Settings, Resources.
- **Recharge ≠ Finance.** Recharge is wallet balance + recharge/debit ledger.
  `/finance` is org *revenue* metrics + per-session *sentiment* feedback —
  different data, not surfaced anywhere in v2.
- **No supervise-equivalent tab.** Overview shows a *department roster*, not a
  live-session grid. No health pills, no live monitoring in v2.

However — the underlying org-scoped surfaces are **already fully-built
components**, just mounted only at the standalone routes:
- `EnterpriseSuperviseClient` (org-scoped, read-only) — could be mounted as an
  in-console tab.
- `FinanceClient` (enterprise-admin, org-level) — could be mounted as a tab.

These are *not* half-built; they are existing clients rendered at the wrong
shell. So the choice is **repoint by embedding the existing component as a tab**
vs. **remove the entry and report the gap**. (See decision below.)

## 4. Scope check

The standalone `/supervise` an enterprise admin lands on is **already the
org-scoped read-only variant** (`EnterpriseSuperviseClient`), not the
platform-wide `SuperviseClient`. So the intended in-console "Supervise" is *the
same org-scoped data surfaced inside the v2 shell*. The escape isn't a
data-scope problem — it's a shell/chrome problem: the right data renders in the
wrong (legacy StaffShell) chrome instead of the bare CommandRail console.

## 5. Full enterprise (and department) nav audit for escapes

| Console | Tabs (in-console buttons) | Link-outs (`↗` escapes) |
|---------|---------------------------|-------------------------|
| Enterprise v2 (`EnterpriseClient.tsx:40-43`) | overview, recharge, usage, members, settings, resources | **Supervise → /supervise**, **Finance → /finance** |
| Department v2 (`DeptClient.tsx:33`) | overview, sessions, usage, settings, resources | **Supervise → /supervise** |

Only `CommandRail` `links[]` produce `↗` escapes. Enterprise has **two**
(Supervise + Finance); department has **one** (Supervise). No other v2 nav item
escapes. The brief's "make sure the department console doesn't have the same
escape" is confirmed positive — department **does** have the Supervise escape
and must be fixed the same way.

## 6. Flag-off / other-console impact (do-not-break)

- Flag gate: `lib/flags.ts` `enterpriseV2Enabled()` (`NEXT_PUBLIC_ENTERPRISE_V2`,
  default on). Checked in `app/(staff)/enterprise/v2/PanelClient.tsx`.
- Flag-OFF path renders `LegacyPanel` inside StaffShell; StaffShell's own nav
  (`StaffShell.tsx:99-213`) carries Supervise (`:124-134`) and Finance
  (`:208-213`) as **top-level sidebar items**, not console tabs. That is the
  legacy behavior and is **out of scope** — leave it byte-identical.
- `/supervise` and `/finance` standalone routes have many other legitimate
  callers (StaffShell nav for supervisor/super_admin, redirect fallbacks in
  `admin/operations/bids/schedule/finance/enterprise/supervise` pages, session
  back-buttons). **Do not delete or alter the routes** — only stop the v2
  consoles from linking out to them.

---

## Decision needed (stop for review)

Per the brief, each affected item is either **repointed to an in-console tab**
(if a destination exists) or **removed + reported as a gap** (if not). The
nuance here: no in-console *tab* exists, but the org-scoped *components* do.

**Affected items:** Enterprise Supervise, Enterprise Finance, Department
Supervise.

**Option A — Embed existing components as in-console tabs (repoint).** Add
`supervise` (and `finance`, enterprise only) tabs to the v2 consoles, rendering
`EnterpriseSuperviseClient` / `FinanceClient` (or org-scoped wrappers) inside
the CommandRail content region. Move the entries from `links[]` to `nav[]`,
dropping the `↗`. Keeps capability; admin never leaves the console. Higher risk
(those clients are full-page surfaces with their own headers/polling — need to
fit them into the content pane cleanly).

**Option B — Remove the link-outs + report as gaps.** Delete the `links[]`
arrays from both consoles. Strictly matches "remove rather than escape," lowest
risk, byte-identical everything else. Cost: enterprise/department admins lose
Supervise (and Finance) access *from the v2 console* until proper tabs are built
— recorded as a gap.

Recommendation: **Option A** for Supervise (the org-scoped read-only grid is
exactly "the same data inside the shell" the brief describes, and the component
already exists), and a per-item call on Finance.

---

## Decision taken (user) + outcome

**Scope (clarified by user):** ONLY the **enterprise + department** in-console
supervise — the nav surface for an org/dept admin to watch their members' live /
waiting / past sessions. The platform **`/supervise` (supervisor / super_admin)
flow is a different feature and is explicitly OUT OF SCOPE — untouched.** (An
earlier mis-scope toward rebuilding the supervisor live-ops tool was abandoned.)

**Done — both flag-on consoles now have a native, read-only Supervise tab and
neither escapes:**
- New shared `app/_components/portal/SuperviseBoard.tsx` — console-native
  (portal layout + `KpiRibbon` + sessions table + `DrillPanel`), Live / Waiting
  / Past tabs, deterministic `deriveHealth`. Props: `endpoint`, `personLabel`,
  `showEngineer`, `showRecalls`. GDPR-minimized (no email / AI summary — the
  feeds omit them).
- Enterprise: `app/(staff)/enterprise/v2/_cc/SuperviseView.tsx` → board over
  `/api/enterprise/sessions` (Customer + Engineer + Recalls cols). Added as a
  `supervise` tab in `EnterpriseClient`; **removed the `Supervise → /supervise`
  link-out**. `EntTab` extended.
- Department: `app/(staff)/department/v2/_cc/SuperviseView.tsx` → board over
  `/api/department/sessions` (Member col; no engineer/recalls — the feed omits
  them). The old minimal "Sessions" tab was **replaced** by this richer
  "Supervise" tab (`DeptClient` NAV + `DeptTab` renamed `sessions`→`supervise`,
  `SessionsView` removed from `views.tsx`); **the `Supervise → /supervise`
  link-out was removed**.
- Both feeds (8s poll + 1s tick) and `CommandRail` hides the now-empty links
  block on department.

**Finance escape — also fixed (same pattern):**
- New `app/(staff)/enterprise/v2/_cc/FinanceView.tsx` — console-native (serif
  Shell + `KpiRibbon` revenue + token-styled feedback list). Reuses the legacy
  endpoints `/api/enterprise/billing` (revenue: this month / 30d / lifetime +
  €/min) and `/api/internal/feedback?limit=40` (AI sentiment per session).
- Added as a `finance` tab in `EnterpriseClient`; **removed the
  `Finance → /finance` link-out**. `LINKS` is now empty (CommandRail hides the
  block), so the enterprise console has **zero** outbound escapes. `EntTab`
  extended. Department has no Finance entry (unchanged).

**Deliberately NOT changed (do-not-break):**
- Legacy `EnterpriseSuperviseClient` + `FinanceClient` + the `/supervise` and
  `/finance` routes are **left intact** — in **flag-off** mode, org admins still
  reach supervise + finance through StaffShell, so deleting them would break the
  "flag-off stays byte-identical" guarantee. The flag-on consoles simply no
  longer link there.
- `SuperviseClient` (supervisor/super_admin platform tool) — untouched.

**Verification:** mocked dev-preview render of both boards (demo Supabase
accounts aren't seeded, so authed e2e is blocked) — Live/Waiting/Past + drill
panel render in console chrome, admin stays in the command center. Typecheck
clean (only pre-existing missing-dep errors remain).
