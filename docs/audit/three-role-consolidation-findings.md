# Three-role consolidation — Phase 0 findings

Status: **study only, no code changed.** 2026-06-08. Root-caused each item with
file:line. **Where the brief disagrees with the code, the code wins** — noted
per item. Several brief premises are already-correct or already-shipped.

---

## A. Move `/reseller/v2` → `/partner`

**Current:** authed portal at `/reseller/v2`
(`app/(staff)/reseller/v2/page.tsx` → `PanelClient` → `PortalClient` when
`partnerProgramEnabled()`). `/partner` is **login only**
(`app/partner/page.tsx`, public, not in `(staff)`). proxy
`PARTNER_PREFIXES = ["/reseller"]`, `PARTNER_LOGIN = "/partner"`
(`proxy.ts:58,66`). `landingForRoles` → `/reseller/v2`
(`lib/relay/role-labels.ts:70`).

**Target collision:** `/partner` can't be both the public login and the authed
portal. The other consoles follow `login → /X/v2`: `/business → /enterprise/v2`,
`/business → /department/v2`. So the consistent target is **`/partner/v2`**
(login stays at `/partner`, like `/business` stays login). The brief's "moves to
`/partner`" = "lives under `/partner`". **Recommend `/partner/v2`.**

**Files to change (the move):**
1. New dir `app/(staff)/partner/v2/` — move `page.tsx`, `PanelClient.tsx`,
   `_portal/*`, `ResellerSidebar.tsx` (legacy path) from `reseller/v2/`.
2. `app/(staff)/reseller/v2/page.tsx` → `redirect("/partner/v2")` (don't leave a
   dead route); keep `app/(staff)/reseller/page.tsx` redirect too.
3. `proxy.ts:58` — `PARTNER_PREFIXES = ["/partner", "/reseller"]` (keep
   `/reseller` so old links still bounce to login).
4. `lib/relay/role-labels.ts:70` — land resellers on `/partner/v2`.
5. `app/_components/StaffShell.tsx:173` (nav href) + `:556-557` (`isBare` check) —
   add/replace `/partner/v2`.
6. Tests/scripts: `tests/guards.spec.ts:34-36`,
   `scripts/e2e-invites-and-protection.mjs:182-183`,
   `scripts/e2e-auth-surfaces.mjs:65`.
7. `app/robots.ts:43`, `FloatingThemeToggle.tsx:31` — add `/partner`.
   API endpoints stay `/api/reseller/*` (role-gated, not route-bound) — **no API
   rename needed.**
**Open Q:** confirm `/partner/v2` (recommended) vs literally `/partner` (would
force moving the login).

---

## B. Enterprise "Supervise" / the "old view" — **DO NOT DELETE (code wins)**

`EnterpriseSuperviseClient`
(`app/(staff)/enterprise/supervise/EnterpriseSuperviseClient.tsx`) is the
org-scoped, read-only supervise grid and is **actively used**: `/supervise`
(`app/(staff)/supervise/page.tsx:6,26-28`) branches server-side and renders it
for `enterprise_admin`/`department_admin`. `/enterprise/supervise/page.tsx` is a
**redirect → /supervise** (back-compat). Only the docs reference it otherwise.

**So:** the enterprise Supervise link (`/supervise`) already routes to the
correct org-scoped v2 client — **it is not broken** (browser-verified earlier:
`/supervise` loads for the enterprise admin). The brief's "stop routing to the
old view / erase it" premise does not hold. **Recommend: leave it; do NOT delete
`EnterpriseSuperviseClient` (it's a live import).** If the team wants it inside
the command-center chrome instead of StaffShell, that's a net-new view (out of
"fix don't redesign") — flag, don't delete.

---

## C. Nav audit — every entry of all 3 consoles

| Console | Entry | Type | Resolves to | Status |
|---|---|---|---|---|
| Partner portal | overview/onboard/program/resources/help | in-console tab | v2 views | ✅ |
| Partner portal | **(no Settings tab)** | — | — | ⚠️ **MISSING (see F)** |
| Enterprise | overview/recharge/usage/members/settings/resources | in-console tab | v2 views | ✅ |
| Enterprise | Supervise → `/supervise` | link-out | EnterpriseSuperviseClient (org-scoped) | ✅ works |
| Enterprise | Finance → `/finance` | link-out | FinanceClient (StaffShell, enterprise_admin-only) | ✅ works (legacy chrome, by design) |
| Department | overview/sessions/usage/settings/resources | in-console tab | v2 views | ✅ |
| Department | Supervise → `/supervise` | link-out | EnterpriseSuperviseClient | ✅ works |

**No 404s and no truly-legacy-broken nav found.** Supervise + Finance are
intentional link-outs (CommandRail "G2 guardrail", `CommandRail.tsx:9`) that
render in StaffShell chrome but ARE the correct destinations. The brief's "find
the rest" (beyond Supervise/Finance) → **there are no others.**

---

## D. Member management — endpoints mostly EXIST; v2 UI doesn't wire them

This is the biggest real gap: the capabilities exist server-side; the v2 consoles
don't surface them.

| Capability | Endpoint (exists?) | v2 UI today |
|---|---|---|
| Add member — invite NEW (enterprise→dept) | ✅ `POST /api/enterprise/departments/[id]/employees` `{name,email,allocatedMinutes?}` | ✅ wired (I added E7 to the dept drill) |
| Add member — invite NEW (enterprise, org client/admin) | ✅ `POST /api/enterprise/users` `{email,displayName,role,departmentId?}` | partial (MembersView invites admins only) |
| Add member — invite NEW (department) | ✅ `POST /api/department/employees` `{name,email,allocatedMinutes?}` | ❌ no add button in dept console |
| Add EXISTING user (no re-invite) | ❌ **none** (always emails) | — |
| Suspend / reactivate (enterprise, per member) | ✅ `PATCH /api/enterprise/members/[id]` `{status:'ACTIVE'|'DEACTIVATED'}` → `banUser`/`unbanUser` (`lib/auth-ban.ts`), **server-enforced** (banned_until) | ❌ not wired |
| Suspend / reactivate (department, per employee) | ✅ `PATCH /api/department/employees/[id]` `{status:'suspended'|'active'}` → `deactivate_employee` RPC + `banUser` (returns minutes to dept pool) | ❌ not wired |
| Refill per member (dept) | ✅ `POST /api/department/employees/[id]/refill` (`transfer_to_employee`, from dept pool) | ✅ wired (D2) |
| Refill per member (enterprise) | ✅ `POST /api/enterprise/departments/[id]/employees/[empId]/refill` (dept pool) | partial (dept-drill add only) |
| Refill from ORG WALLET directly | ❌ none (all refills go org→dept→employee) | — |
| Resend invite | ✅ `POST /api/enterprise/members/[id]/resend-invite` (`resendInvitationEmail`) | ❌ not wired |
| Reassign member between depts | ❌ **none** (dept PATCH explicitly 403s `department_id`) | — |
| Per-member visibility | enterprise dept-employees returns minutes+status+**lastSignIn** ✅; dept employees returns minutes+status, **no lastSignIn** ⚠️; `enterprise/users` returns status+lastSignIn but **no minutes** | members table shows name/email/role/status only |

**Build = mostly UI wiring** of existing endpoints into the v2 member views,
scoped by role (enterprise org-wide via a real members surface; department within
scope). **Net-new (additive, confirm):** add-existing-user, reassign-between-depts,
org-wallet direct refill. Recommend ship the wired-existing first; flag the 3
net-new.

**Suspend IS server-enforced** (banned_until via `banUser`) — not just a label.
Brief's "don't ship a label-only toggle" is already satisfied by the endpoints.

---

## E. Channel Partner — row actions + commission

**Row ellipsis is dead:** `OverviewView.tsx:221-227` renders `⋯` as
`aria-hidden` decoration on hover — **no menu, no handler.** Wire it:
- **Resend invite** (invited-not-accepted orgs): the org's `enterprise_admin`
  invite lives in `invites` (recorded at onboard via `recordInvite`). Resend via
  `PATCH /api/invite/[id]` (bumps `sent_at`, re-emails) — but the portal payload
  doesn't carry the invite id; need to surface it (extend `/api/reseller/portal`
  or a small resend-by-org endpoint). Additive.
- **Nudge** (reminder to an onboarded org): **no endpoint exists** — would need a
  small additive notify endpoint (notification to the org admin). Flag.
- Other safe row actions: View details (open drill), Adjust passthrough (within
  the `≤ commission` guard) — both buildable on existing endpoints.

**Commission:** `resellers.commission` is `numeric(6,2) NOT NULL DEFAULT 0`
(`20260521170000_…:40-43`) — **default 0, NOT 20%.** Set only at creation
(`POST /api/admin/resellers` + `AddResellerDrawer` commission input, blank→0).
**No post-creation edit endpoint** (`/api/admin/resellers/[id]` allows
name/email/status only). To satisfy the brief:
1. **Default 20%:** set the drawer default + creation handler to 20 when unset
   (and optionally `ALTER COLUMN commission SET DEFAULT 20` — additive).
2. **Super-admin edit:** add `PATCH /api/admin/resellers/[id] {commission}`
   (guard 0–100) + an edit control in `admin/v2/ResellersTab.tsx`. Partner sees
   it read-only (already does, ProgramView).
3. Keep `passthrough ≤ commission` guard (`reseller/enterprises/route.ts:130-140`)
   — already enforced.

---

## F. Settings per role

- **Partner portal: NO Settings tab at all** (NAV = overview/onboard/program/
  resources/help). The legacy `PartnerSettingsTab` exists but isn't in the portal.
  → **Add a Settings tab** to the portal: Profile (name via the new
  `PATCH /api/enterprise/me`? no — partner isn't enterprise; needs a profile
  write path — `/api/profile` or reuse), Theme (in AccountMenu now), Terms
  (partner_commercial acceptance from `terms_acceptances`), Data retention
  (policy), **reseller code** + **payout details** (`/api/reseller/payout`
  exists). Several pieces exist in `PartnerSettingsTab` (branding/payout/team) —
  port the relevant ones.
- **Enterprise: Settings functional** (I shipped E4/E5: profile + org + theme +
  contract). ✅ Add nothing major; data-retention already editable.
- **Department: Settings read-only.** → make Profile editable (needs a profile
  write path), add Terms **notice** (org accepted version+date, read-only — not a
  re-sign), Data retention **view**. Theme via AccountMenu (done).

**Profile write path gap:** `PATCH /api/enterprise/me` (I added) only serves
enterprise admins. Partner + department admins need a profile-name write too —
add a **shared additive** `PATCH /api/profile {displayName}` (updates
`profiles.full_name` for `auth.uid()`), and point all three Settings at it.

---

## G. Lateral / cross-cutting
- **Invite lifecycle:** partner Overview already shows Invited/Active
  (`partner_status`) + last-activity (fixed earlier). Employee invite
  lifecycle (invited-vs-accepted, resend) needs surfacing in enterprise/dept
  member lists (status + resend button).
- **Money dated/traceable:** recharge dates fixed (`bbfcf4a`); refills write dated
  transactions via the existing path. Commission accrual is computed read-time
  (`partnerMargin`), not a ledger row — no undated rows, but no accrual ledger
  either (display-only). OK per "no money-path mutation".
- **Empty states:** dept Overview has one; partner zero-companies + member
  no-activity need checking per view.

---

## Corrected plan (supersedes brief where code disagrees)

| Brief item | Real state | Work |
|---|---|---|
| Move to `/partner` | login at /partner; authed at /reseller/v2 | move authed → **/partner/v2**, redirect old, proxy+landing+nav+tests |
| Erase old supervise view | **actively used, not broken** | **no delete**; Supervise already correct |
| Nav audit "find the rest" | only Supervise+Finance link-out, both work | nothing to fix |
| Member mgmt (add/suspend/refill/visibility) | **endpoints exist, UI unwired** | wire suspend+resend+visibility into enterprise (org-wide) + dept member views |
| add-existing / reassign / org-wallet refill | **no API** | additive or defer (confirm) |
| Row ellipsis | dead decoration | wire Resend (additive id surfacing) + Nudge (additive endpoint) |
| Commission 20% default + edit | **default 0, no edit** | default→20, add PATCH + admin edit UI |
| Settings per role | partner **none**, dept read-only, enterprise done | add partner Settings, dept profile/terms/retention; shared `PATCH /api/profile` |

## Open decisions (blockers)
1. Route target: **`/partner/v2`** (recommended) or literally `/partner` (moves login)?
2. Member net-new: build **add-existing-user** + **reassign-between-depts** +
   **org-wallet direct refill**, or ship wired-existing endpoints first and defer?
3. **Nudge**: OK to add a small additive `POST /api/reseller/enterprises/[id]/nudge`
   (notification to the org admin)?
4. Commission default: change the **column default to 20** (migration) or just the
   creation-handler default? (recommend handler + column for safety)
5. Supervise: confirm **leave as-is** (don't delete EnterpriseSuperviseClient)?

**Stopping for review per the brief's Phase 0 mandate.**
