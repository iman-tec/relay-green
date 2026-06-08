# Enterprise & Department fix-list — Phase 0 findings

Status: **study only, no code changed.** Written 2026-06-08 for the
"Enterprise & Department admin: fix list + finish stubs" brief. Root-caused
each item with file:line. **Where the brief disagrees with the code, the code
wins** — noted per item.

Surfaces (flag-on, `NEXT_PUBLIC_ENTERPRISE_V2`, on by default):
- Enterprise console: `app/(staff)/enterprise/v2/_cc/` — `EnterpriseClient`,
  `OverviewView`, `RechargeView`, `views.tsx` (Members/Usage/Settings/Resources).
- Department console: `app/(staff)/department/v2/_cc/` — `DeptClient`,
  `OverviewView`, `views.tsx`.
- Shared rail: `app/_components/portal/CommandRail.tsx` →
  `app/_components/admin-v2/NotificationBell.tsx`.

---

## S1 / D1 — Notifications alignment — **ONE-LINE FIX (shared)**

**Root cause:** `NotificationBell` anchors its dropdown to the bell's **right
edge by default** (`align="right"` → `right-0`,
`NotificationBell.tsx:248`). Its own docstring (`:53-59`) says: *"Pass `left`
when the bell sits in a left sidebar so the panel opens rightward into the
content area instead of clipping off-screen."* `CommandRail` mounts the bell in
a **left** 232px rail (`CommandRail.tsx:48,65`) and **does not pass `align`** →
defaults to `right` → the 360px panel opens leftward and clips off the screen
edge in **both** consoles.

**Fix:** pass `align="left"` to the `NotificationBell` in `CommandRail.tsx:65`.
Corrects enterprise + department at once (shared component). Verify across
light/dark/espresso (panel uses `var(--surface)` tokens, so theme is fine — the
bug is pure horizontal anchor). The bell-in-header layout itself
(`justify-between`, `:54`) is correct.

---

## E1 — Supervise link — **STATICALLY CORRECT (code wins; verify at runtime)**

`EnterpriseClient.tsx:41` → `Supervise → /supervise`. `/supervise`
(`app/(staff)/supervise/page.tsx:12-36`) **branches server-side on role** and
renders `EnterpriseSuperviseClient` for `enterprise_admin` (org-scoped). The old
`/enterprise/supervise` is a redirect → `/supervise`
(`app/(staff)/enterprise/supervise/page.tsx:7-9`). So `/supervise` is the
intended, working destination.

**Recommendation:** the brief says "wrong URL" but the code is correct. Likely
the brief is stale, OR there's a runtime issue (e.g. the bare console's link-out
lands in StaffShell and something bounces). **Verify in-browser as enterprise
admin** before touching it; if it genuinely works, E1 is a no-op (do NOT rewrite
a correct link). It renders in StaffShell chrome (a link-out) — that's by design
per the CommandRail "G2 guardrail" comment.

---

## E2 — Finance link — **NO v2 FINANCE EXISTS (decision needed)**

`EnterpriseClient.tsx:42` → `Finance → /finance`. `/finance`
(`app/(staff)/finance/page.tsx:11-34`) is the org-level money+feedback console,
**enterprise_admin-only** (guarded, redirects other roles), rendering
`FinanceClient` in **StaffShell** (legacy chrome). **There is no v2/_cc finance
surface anywhere** — no finance tab in the console, no `FinanceView`.

**Recommendation:** the brief wants Finance to open a "v2 surface" instead of the
"old panel," but that v2 surface **does not exist**. Options: (a) accept
`/finance` as the real destination (it IS the finance console, just StaffShell
chrome) — it's a deliberate link-out like Supervise; (b) build a v2 finance view
(net-new, out of "fix don't redesign" scope). **Recommend (a) + confirm** — this
is a link-out by design, not a misroute. Don't bounce; don't rebuild finance for
this punch list unless explicitly scoped.

---

## E3 — Recharge missing dates — **ALREADY FIXED (this session)**

Root cause was a field-name mismatch: `RechargeView` read
`t.date`/`t.createdAt`/`t.description`/`t.minutes`, but `/api/enterprise/billing`
returns `occurredAt`/`label`/`durationMin` → every row showed "—" / "Session" /
0. **Fixed in commit `bbfcf4a`** (branch `channelpartner/console-fixes`):
`RechargeView` now reads `occurredAt`/`label`/`durationMin`, and the
`minute_purchases` top-up ledger feeds dated recharge rows. Browser-verified
(dates render: `6 Jun`, `30 May`…). **No further work** unless that branch isn't
merged — then carry the same `RechargeView.tsx` change.

---

## E4 — Settings static — **read-only; PATCH endpoint exists, unwired**

`views.tsx:314-357` (`SettingsView`) is **entirely read-only** `<Row>`s (org
name, code, retention, partner, terms). No inputs, no submit, no theme control —
the trailing copy (`:351-354`) even *claims* controls exist ("Editing name,
domain, retention … uses the existing controls") but there are none.

**Backing endpoint EXISTS:** `PATCH /api/enterprise/org`
(`app/api/enterprise/org/route.ts:27-97`) accepts
`{ name?, primaryDomain?, retentionDays? }` with validation (retention against an
allow-list). **Fix:** make Name / Primary domain / Retention editable fields with
a real submit → `PATCH /api/enterprise/org`, then `refetch`. Theme: mount
`ThemeTriplet` in Settings too (it's currently only in the rail — acceptable, but
brief wants it reachable here).

---

## E5 — Profile not functional — **no admin-name write path exists**

There is **no Profile view** in the `_cc` console (NAV has none;
`EnterpriseClient.tsx:31-38`). The only identity surface is the rail's
read-only identity foot (`CommandRail.tsx:129-148`). And there is **no endpoint
to persist the admin's own name** — `/api/enterprise/me` is GET-only
(returns the org snapshot); no `profiles` update route for the enterprise admin
was found.

**Fix:** add a Profile section (in Settings, or a new tab) that loads the real
user (`auth.getUser()` + `profiles.full_name`) and saves name. **This needs an
additive write path** — either a small `PATCH /api/enterprise/me` (or
`/api/profile`) that updates `profiles.full_name` for `auth.uid()`, or a direct
`supabase.from("profiles").update({full_name}).eq("id", uid)` guarded by RLS.
Confirm RLS allows self-update before wiring. (Additive, no money path.)

---

## E6 — Resource docs are namesake — **files missing**

`views.tsx:376-397` (`ResourcesView`) links `↓ Admin guide (PDF)` →
`/enterprise-guide.pdf` and `↓ Onboarding employees (PDF)` →
`/onboarding-employees.pdf`. **Neither file exists in `public/`** → 404 on
download (same class as the partner-deck bug already fixed).

**Fix:** add real first-pass PDFs at `public/enterprise-guide.pdf` and
`public/onboarding-employees.pdf` (real content, flagged draft for content
review — not lorem, not empty). Leave the hrefs as-is once the files exist.

---

## E7 / E8 — Add user/member to a department — **endpoint exists, UI missing**

The enterprise `OverviewView` department drill-in (`DeptDetail`,
`OverviewView.tsx:238-330`) has **only a "Refill from org pool" action** — **no
"add member/employee" button**. The enterprise `MembersView` "Invite admin"
(`views.tsx:75`) invites **enterprise_admins**, NOT department employees —
different thing.

**Backing endpoint EXISTS:** `POST /api/enterprise/departments/[id]/employees`
(`app/api/enterprise/departments/[id]/employees/route.ts:194-384`) accepts
`{ name, email, allocatedMinutes? }` — **invite-NEW only** (sends invite, links
to dept, transfers initial minutes from the dept pool; guards
`allocatedMinutes ≤ dept.remaining_minutes`).

**E7 (invite new):** wire an "Add employee" button into `DeptDetail` → modal
(name/email/minutes) → that POST → refetch. Reuse the `Modal` primitive +
`InviteMemberModal` pattern from `views.tsx:141-227`.

**E8 (attach existing):** the API has **no "attach existing user" path** — only
invite-new. So E7 and E8 are **not** the same flow, and "add existing" would need
an **additive** endpoint/branch (look up an existing profile by email, link
`organization_id`/dept + role without re-inviting). **Recommend: ship E7
(invite-new) now; flag E8 as needing additive API support** (confirm product
wants "attach existing" before building). Don't fake it through the invite path
(double-invites an existing user).

---

## D2 — Department-admin refill for employee — **endpoint exists, UI missing**

Department `OverviewView` employee drill-in (`EmpDetail`,
`department/v2/_cc/OverviewView.tsx:195-211`) shows allocated/used/remaining
**read-only — no refill input/button**.

**Backing endpoint EXISTS:** `POST /api/department/employees/[id]/refill`
(`app/api/department/employees/[id]/refill/route.ts:17-82`) accepts
`{ amount }` (`>0`, `≤ department.remaining_minutes`) and calls the
`transfer_to_employee(_profile_id, _amount)` RPC. **Minutes come from the
DEPARTMENT pool** (not the enterprise wallet directly) — the dept admin tops the
dept up first if dry (route comment `:5-6`).

**Fix:** add a refill input + submit to `EmpDetail`, mirroring the enterprise
`DeptDetail` refill UI (`enterprise/.../OverviewView.tsx:247-327`). Surface the
new employee + dept remaining immediately (the route returns both); the
transaction is dated via the same path that feeds E3's ledger.

---

## D-Settings (parallel to E4) — read-only; `PATCH /api/department` exists

Department `SettingsView` (`department/v2/_cc/views.tsx:196-231`) is read-only.
`PATCH /api/department` (`app/api/department/route.ts:4-45`) accepts `{ name }`.
**Fix (if in scope):** make the department name editable → that PATCH. Brief
doesn't list this explicitly but it's the dept twin of E4 — flag, do if desired.

---

## Build plan (corrected; supersedes brief phasing where code disagrees)

| Item | Real state | Work |
|---|---|---|
| S1/D1 notifications | `align` not passed | **1-line:** `align="left"` in CommandRail |
| E1 supervise | **correct** | verify in browser; likely no-op |
| E2 finance | no v2 finance exists | decision: keep `/finance` link-out (recommend) |
| E3 recharge dates | **already fixed** (`bbfcf4a`) | none (carry if branch unmerged) |
| E4 settings | read-only; PATCH exists | editable form → `PATCH /api/enterprise/org` |
| E5 profile | no view, no write path | add Profile + **additive** profiles-update path |
| E6 docs | files missing | add real PDFs to `public/` |
| E7 add member | endpoint exists, no UI | wire "Add employee" modal → existing POST |
| E8 attach existing | **no API** | additive endpoint OR defer (confirm) |
| D2 dept refill | endpoint exists, no UI | wire refill input → existing POST |
| D-settings | read-only; PATCH exists | optional twin of E4 |

## Open questions for review (blockers)
1. **E1/E2:** code says both links are correct. Confirm whether to (a) leave
   them (recommend — verify E1 in browser), or (b) you have a specific v2
   destination in mind that doesn't exist yet.
2. **E5:** OK to add an additive `PATCH /api/enterprise/me` (or `/api/profile`)
   to persist `profiles.full_name`? (No such write path exists today.)
3. **E8:** "attach existing user to department" has no API. Build the additive
   endpoint, or ship only E7 (invite-new) for now?
4. **Branch:** do this work on a new branch off `main`, or stack on
   `channelpartner/console-fixes` (which already carries E3)?

**Stopping here for review per the brief's Phase 0 mandate.**
