# End-to-end gaps — CP / Enterprise / Department (Phase 0 findings)

Code wins on any disagreement. Live consoles confirmed: enterprise/department
`/{enterprise,department}/v2/_cc/*` (flag `NEXT_PUBLIC_ENTERPRISE_V2`, on), CP
`partner/v2/_portal/*` (flag `NEXT_PUBLIC_PARTNER_PROGRAM`, on).

Headline: most "non-functional" items are **wiring/copy/poll** gaps, not data-model
bugs. Two are bigger than expected (dept-suspend UI-orphaned; escalation deny-list
leak). One brief item is already done (individual referrals).

---

## Channel Partner

### CP1 — Last activity is the wrong signal
`/api/reseller/portal/route.ts:185-205,252` computes `lastActivityAt` as the max
`guest_calls.created_at` attributed to the org (via `customer_user_id →
profiles.organization_id`, since `guest_calls.organization_id` is unpopulated —
see [[project_guest_calls_org_scoping]]). Rendered `OverviewView.tsx:219,365`
`relativeTime(c.lastActivityAt)`. It **never reads `auth.users.last_sign_in_at`**,
so an invited/idle org with no sessions shows "—". 
**Fix:** feed the column from real last-login (`auth.admin.listUsers` →
`last_sign_in_at`, max across the org's profiles) — or rename to "Last session"
and additionally surface last-login. Already auto-refreshes (portal polls 20s,
`usePortal.ts:19`). Confirm desired semantic (last-login vs last-session) in review.

### CP2 — Individual referrals: ALREADY wired end-to-end (verify + 1 gap)
Full chain works: link `ResourcesView.tsx:24` → first-touch cookie
`proxy.ts:138-146` → signup attribution `verify-otp/route.ts:193-200` →
`attributeIndividualReferral` (`lib/billing/individualReferral.ts:35-98`, sets
`profiles.reseller_id` + inserts `individual_referrals` 10/10) → checkout discount
`create-relay-checkout/index.ts:105-121` → commission accrual
`relay-stripe-webhook/index.ts:200-205` → RPC `accrue_referral_commission`
(`20260609130000_referral_accrual.sql:27-80`, dated `referral_commission_entries`
+ `partner_payouts`). `IndividualReferralsView.tsx:48-57` renders **real** data
from `/api/reseller/individual-referrals` (opaque `Individual XXXX`, no PII).
**Not a placeholder.** Gaps: (a) discount/accrual only on the Stripe-checkout path
— confirm that's the only individual top-up route; (b) **no writer flips
`active→converted`** when an attributed individual later joins an org → latent
double-count (keeps accruing CP commission as an employee). 
**Fix:** add the `converted` transition (on org-attach / employee creation); else
CP2 is mostly "verify + label."

### CP3 — live vs active conflated
`StatusDot.tsx:42` `MAP[status ?? "live"]` — a `null`/missing `partner_status`
silently renders **"Live"**, and `live` + `active` are the **same green**
(`StatusDot.tsx:27,31`). CP Overview status column uses `partnerStatus`
(`OverviewView.tsx:203`); there is **no real in-session data** feeding "Live"
(grep: no live logic in `PortalClient`). 
**Fix:** account-state column = Active / Invited / Paused / Suspended only; drop
the `?? "live"` fallback; reserve a distinct "Live" (in-session) badge for a real
signal or remove it. Disambiguate colors.

### CP4 — Remove CP + SA minutes pool
CP (live): `OnboardView.tsx:8,167` "Starting minutes from your pool" field
(`allocatedMinutes`). KPI "Minutes · this month/lifetime" (`OverviewView.tsx:53-56`)
and "Min · mo" column (`:205`) are **usage reporting** — legit, keep. 
SA: `app/(staff)/admin/v2/ResellersTab.tsx` — extensive pool UI:
`:621-624,648-680,708-721,916-934` ("in pool", "allocated · remaining · used"),
table header `:1291` "Minutes (used / allocated)", cells `:1318,:1390`, backing
type fields `:45-89`. 
**Fix:** remove the pool/allocation UI from CP OnboardView + the SA ResellersTab
pool renders (CP/SA don't consume minutes). Keep enterprise/dept usage reporting.

### CP5 — Double terms acceptance
Both gates mount in `EnterpriseClient.tsx:83-84`:
- **EnterpriseMsaGate** (`_cc/EnterpriseMsaGate.tsx`) — `GET/POST
  /api/enterprise/accept-msa`; writes `terms_acceptances(terms_type='enterprise_msa')`
  (`accept-msa/route.ts:77-85`). Fires for **every** enterprise admin.
- **PartnerTermsGate** (`enterprise/v2/PartnerTermsGate.tsx`) — gated on
  `partnerProgramEnabled()` + `partner_status==='invited'`; writes a
  `terms_acceptances` row (default type) AND flips `partner_status: invited→active`
  (`accept-terms/route.ts:90-111`).
A partner-onboarded enterprise on first login satisfies both → two sequential "I
Agree" modals (each `reload()`s). 
**Fix:** show at most one gate per login. The two are different content (MSA vs
channel-partner commercial terms) — collapsing must NOT silently drop a needed
legal acceptance, and the surviving gate MUST keep the `partner_status→active`
flip (today only `accept-terms` does it). **Decision needed:** combine into one
modal that records both acceptances, or sequence-suppress so only one shows.

---

## Enterprise Admin

### E1 — "Spend (synthetic)" → "Spend"
`_cc/OverviewView.tsx:365` `<Field k="Spend (synthetic)" …>`. Drop "(synthetic)".
`RATE=300` (`:26`) + table "Spend" cell (`:179`) stay. (Also a code comment
`BillingTab.tsx:8` "synthetic" — legacy/flag-off, leave.)

### E2 — Remove AI-derived sentiment (metadata-only)
`_cc/FinanceView.tsx` Feedback section: subtitle "AI-derived sentiment per session"
(`:204-215`), fetch `/api/internal/feedback` (`:85-98`), render block (`:217-280`),
+ `Feedback` type / `tone()` / state. Page subtitle "…how customers felt"
(`:122-125`). 
**Fix:** remove the entire Feedback section + the "how customers felt" copy. Keep
Revenue ribbon + Usage table. (This trims what I added earlier — per new direction.)

### E3 — Resend invite
`resend-invite/route.ts:44` → `resendInvitationEmail` → `sendInvitationEmail`.
**Silent no-op for `password_set` users** (`admin-invite.ts:100-108` returns
`{ok:true, mode:"already_active"}` without emailing). UI shows "Invite re-sent."
unconditionally on 2xx (`views.tsx` MemberDetail `:293-311`, MemberRowMenu
`:758-761`), button only when `pending = !lastSignIn`. For genuinely pending users
it DOES resend. 
**Fix:** surface the real outcome — return `mode` and show "re-sent" only when an
email actually went out (else "already active / nothing to resend"); don't claim a
send that didn't happen.

### E4 — Auto-refresh (poll) for minute values
`useEnterprise.ts:12,49-59` polls 20s + focus → **Overview + Recharge balance are
live**. **MembersView** (`views.tsx:71-84`) and **FinanceView** (one-shot effects)
+ Recharge **transactions ledger** (`RechargeView.tsx:46-87`) are **one-shot →
stale** until a mutation/remount. 
**Fix:** add a 20s poll (+focus) to MembersView (min used/left/spend/status) and
FinanceView usage; optionally the ledger. Mirror the `useEnterprise` pattern.

### E5 — Distributed-minutes propagation
Balances are atomic + correct: enterprise→dept `transfer_to_department`
(`departments/[id]/refill/route.ts:41`), dept→member `transfer_to_employee`,
org→member `transfer_org_to_employee`. The **issuing** console refetches instantly
(`onChanged→refetch`); the **receiving** dept console (`useDepartment.ts` polls
20s) lags ≤20s; no realtime (dead). So it IS auto-updating, just poll-latent.
**Fix:** acceptable via poll; ensure every minute-bearing view polls (ties to E4).
Optionally tighten interval. Not a correctness bug.

### E6 — Department suspension: real server-side, UI-orphaned
`deactivate_department` RPC (`20260604120000…sql:83-121`) cascades:
deactivate each employee (refund→dept, status suspended), refund dept→org wallet,
set `departments.status='suspended'`. Enterprise PATCH
`departments/[id]/route.ts:45-61` calls it **and** `banUsers` (real sign-in gate).
**BUT** the live `_cc/OverviewView` `DeptDetail` has **no suspend/reactivate
button** — the only UI lives in the **flag-dead** legacy `DepartmentsTab.tsx:162-170`.
Reactivate (`route.ts:63-81`) is a plain `status='active'` flip that unbans **only
the dept admin**, not members (lossy). Defense-in-depth gap:
`requireDepartmentAdmin` (`lib/department-auth.ts`) and the session-entitlement RPC
don't check `status` — suspension relies entirely on the (error-swallowing) auth
ban. 
**Fix:** add suspend/reactivate to the live `_cc` DeptDetail; make reactivate
re-enable members too (or document the manual step); add a `status` guard in
`requireDepartmentAdmin` as defense-in-depth.

### E7 — Remove recharge helper text
`_cc/RechargeView.tsx:342-345` "Derived from recharges + session usage — a durable
transactions ledger is the planned follow-up." Delete it.

### E8 — Invite admin
Already correct: `views.tsx` InviteMemberModal posts `role:"enterprise_admin"`
(admin) vs `role:"client"+departmentId` (member); list `/api/enterprise/members`
filters `client_type='employee'` only (admins excluded). Gap: invited admins
**appear nowhere** in the `_cc` console afterward (no admin roster). 
**Fix:** verify invite→verify→role; **decision:** add a distinct "Admins" section
to the Members surface so invited admins are visible (brief wants admins as a
separate, visible category), or leave admins invisible. Recommend a small Admins
section.

### E9 — Enterprise Supervise: remove; Department Supervise: keep (already correct)
Enterprise: remove tab — `EnterpriseClient.tsx:39` (nav), `:120` (render), `:54`
(VALID), `types.ts` `EntTab` `| "supervise"`, delete `_cc/SuperviseView.tsx`, drop
`Eye`/`SuperviseView` imports. **Keep shared `SuperviseBoard`** (dept uses it).
Department: `DeptClient.tsx:92` `<SuperviseView/>` → `SuperviseBoard` over
`/api/department/sessions` — **already in-console, dept-scoped, read-only,
metadata-only, NOT a `/supervise` link-out** (`DeptClient.tsx:31` LINKS empty).
**Decision:** keep dept Supervise as-is (already meets the brief). Confirm.

### E10 — Escalation audience leak (security)
`StaffShell` mounts `SupervisorAlerts` with a **deny-list**: `{!engineer &&
<SupervisorAlerts/>}` (`StaffShell.tsx:575,883`) and inside, `const isSupervisor =
!isEngineer(roles)` (`:1325`) gates the `session_escalations` realtime subscription
+ ringtone (`:1438-1494`). So `enterprise_admin`, `department_admin`, `reseller`,
`super_admin` ALL open the escalation channel. RLS itself is **tight** — SELECT only
for `supervisor`/`admin`/`super_admin` (`20260527260000_session_escalations.sql:53-58`)
— so no row data leaks to enterprise/dept admins today, but the subscription,
name-lookups, and ringtone still fire for the wrong audience (and it's a latent
leak if RLS ever loosens). Legit consumers (keep): `SuperviseClient.tsx:533-540`
(pod-scoped), `EngineerSessionClient.tsx:1370-1377` (own session). Notification
path is correctly scoped (`act-now` 403s non-supervisors; bells are per-user).
**Fix:** replace the deny-list with an **allow-list** —
`roles.includes(supervisor) || roles.includes(super_admin)` (super_admin keeps
toasts per `:570-573`) — at `StaffShell.tsx:1325` and the two mounts `:575,:883`.
Do not touch the supervisor console.

---

## Department Admin
- **Allocated minutes update** — same as E5: `useDepartment.ts` polls 20s
  (`:9,36`), reads `departments.{allocated,used,remaining}_minutes`
  (`api/department/employees/route.ts:34-40`). Live within 20s; no correctness bug.
  Ensure all dept views consume the polled data (they do).
- **Supervise** — already in-console dept-scoped (E9). Keep.
- Settings-in-dropdown / Sessions reframe — already shipped earlier; don't regress.

---

## Cross-cutting
- **Admins vs members:** invite actions already distinct (E8). Gap = no admin
  roster (decision in E8).
- **Copy sweep:** E1 "(synthetic)", E2 "AI-derived sentiment"/"how customers felt",
  E7 recharge helper, CP "pool" strings, CP3 "Live" mislabel. Final clean labels.
- **One source of truth:** confirmed — org/dept/member all read the same
  `*_minutes` columns; transfers atomic; suspension/refill consistent. Freshness =
  poll (20s), the only "stale" surfaces are the one-shot enterprise views (E4).

---

## Decisions needed at review
1. **CP1 last-activity:** real last-login (`last_sign_in_at`), or keep
   last-session + add a separate last-login column?
2. **CP2 referrals:** add the `active→converted` writer (close double-count), or
   defer (chain otherwise works)?
3. **CP5 double-terms:** combine MSA + partner terms into one modal recording both,
   or suppress one — and which keeps the `partner_status→active` flip? (Don't drop
   a legally-distinct acceptance.)
4. **E6 dept suspend:** add suspend/reactivate to live `_cc` DeptDetail (recommended)
   — and should reactivate re-enable members automatically?
5. **E8 admins:** add an "Admins" section to the enterprise Members surface, or
   leave invited admins invisible?
6. **E9 dept Supervise:** keep as-is (recommended — already compliant)?
