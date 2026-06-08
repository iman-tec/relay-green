# Enterprise Members — Phase 0 findings

**TL;DR:** The backend already supports "invite a member into a department" end
to end; the bug is entirely the **frontend modal**, which hardcodes
`role:"enterprise_admin"` and has no department field. So it creates an *admin*
with no department — and the Members list only shows `client_type='employee'`,
so the invited user is invisible there and propagates nowhere. Fix is mostly
frontend (rename + department selector + correct POST body) plus a real,
consistently-rendered row-actions menu.

Code wins on any disagreement; everything below is quoted file:line.

---

## 1. Current Members button — what "Invite admin" does

- `app/(staff)/enterprise/v2/_cc/views.tsx:99` — button label literally
  `"Invite admin"`; `:536` — modal title `"Invite admin"`.
- `views.tsx:513-521` — POST `/api/enterprise/users` with
  `{ email, displayName, role: "enterprise_admin" }`. **No department, no
  client role.** It creates a peer **enterprise_admin**, not an employee.
- The Members list reads `GET /api/enterprise/members`
  (`app/api/enterprise/members/route.ts:52-59`):
  `profiles WHERE organization_id = orgId AND client_type = 'employee'`.
  → An `enterprise_admin` (no `client_type='employee'`) **never appears** in
  this list. The view's own copy ("Add employees from a department in
  Overview") admits the gap.
- Per-member actions already exist via the row → DrillPanel `MemberDetail`
  (`views.tsx:212-470`), each wired to a real endpoint:
  - Reassign dept → `POST /api/enterprise/members/[id]/reassign`
    (`reassign/route.ts:75-78` `profiles.update({ department_id })`).
  - Suspend/Reactivate → `PATCH /api/enterprise/members/[id]`
    (`[id]/route.ts:81-82` `banUser`/`unbanUser`).
  - Refill → `POST /api/enterprise/members/[id]/refill`
    (`refill/route.ts:48-52` RPC `transfer_org_to_employee`, org wallet).
  - Resend invite → `POST /api/enterprise/members/[id]/resend-invite`
    (shown only when `pending = !m.lastSignIn`, `views.tsx:227,436`).

## 2. Member ↔ department model

- Association is a single FK column **`profiles.department_id`**
  (`supabase/migrations/20260521130000_enterprise_hierarchy.sql:198-199`),
  no join table. Coherence constraint: `department_id` requires
  `organization_id` (`:261-263`).
- "Is an employee" predicate = **`client_type='employee'`** (+ dept set)
  (`20260521170000_enterprise_refill_and_minutes.sql:101-102`). There's also a
  literal `profiles.status` column (`:109`).
- **Invite CAN set the department at creation** — already supported:
  `app/api/enterprise/users/route.ts` accepts `{role, departmentId}`
  (`:151-156`), and when `role === client` AND `departmentId` is set
  (`:195-229`) it validates the dept (in-org + active) and the profile upsert
  flips `department_id` + `client_type:"employee"` (`:346-356`). The UI just
  never sends that shape.
- Other writers that already do it right (for parity):
  `departments/[id]/employees/route.ts:344-355` (invite-new into a dept) and
  `.../employees/attach/route.ts:86-96` (add-existing into a dept).

## 3. Propagation — they read the SAME table (so it's automatic)

| Surface | Query | file:line |
|---|---|---|
| Enterprise Members | `profiles WHERE organization_id=org AND client_type='employee'` | `enterprise/members/route.ts:52-59` |
| Enterprise dept drill-in | `profiles WHERE department_id=dept` | `enterprise/departments/[id]/employees/route.ts:73-79` |
| Department console | `profiles WHERE department_id=dept AND client_type='employee'` | `department/employees/route.ts:46-54` (via `_cc/useDepartment.ts:21`) |

One `profiles` row, read through three filters. A member with
`department_id` set + `client_type='employee'` shows in all three **with no
sync job**. The current bug isn't a propagation pipeline — it's that the
modal never creates such a row.

## 4. Channel-partner linkage + scope

- Enterprise→CP link: `organizations.reseller_id`
  (`enterprise_hierarchy.sql:114-115`); CP user scoped via `profiles.reseller_id`
  + `lib/reseller-auth.ts:36-51`.
- The live CP console (`partner/v2/_portal/OverviewView.tsx`, flag on by
  default) shows a **Companies** table — rollups only: name, partner status,
  minutes/spend this month, commission, admin name. Drill-in has **no employee
  roster, no departments**.
- CP is **PII-blocked by design**:
  `app/api/reseller/orgs/[id]/departments/[deptId]/employees/route.ts:5-10,
  65-69, 93` — returns a member **count** (k-anonymity suppressed), explicitly
  "NO member roster, NO names, NO emails." → The new member correctly affects
  the CP's **counts/rollups** but never exposes the individual. **No CP change
  needed.**

## 5. Row-actions `…` menu

- `views.tsx:169-175` — the `⋯` cell is **decorative**: `aria-hidden`, no
  `onClick`, no dropdown. `opacity-0 ... group-hover/row:opacity-100` reveals it
  only on the hovered row — which is why "it only shows on one row." The whole
  `<tr>` is the click target → opens the DrillPanel (`views.tsx:142`).
- The partner Companies table has a **real** version of the same hover pattern:
  `partner/v2/_portal/OverviewView.tsx:230-318` `RowActions` — `⋯` is a real
  `<button>` toggling a dropdown (Resend invite / Nudge admin),
  `stopPropagation` so it doesn't open the drill, outside-click close. **This is
  the template to copy** for a wired enterprise member menu.

## 6. Dedup + lifecycle

- Cross-org dedup: `findUserInAnotherOrg` + explicit re-check
  (`users/route.ts:243-270`) → 409 if the email belongs to another org. Re-invite
  into the *same* org is idempotent (upsert `onConflict:id`). "One department per
  employee" guard in the dept writers (`employees/route.ts:337-342`).
- Status: Members list derives **active/suspended** from auth ban
  (`members/route.ts:79-103`); **invited/active** from `last_sign_in_at`
  (`users/route.ts:130-140`). Invite confirms email immediately, so
  `last_sign_in_at` (null=invited) is the lifecycle signal; the `invites` table
  flips sent→accepted on first sign-in (DB trigger).

---

## The fix (proposed — stop for review)

Almost entirely frontend; **no API change for the happy path** (the backend
already does the right thing for `{role:"client", departmentId}`).

**A. Rename + correct the invite (the core bug):**
- `views.tsx:99` button `"Invite admin"` → `"Invite a member"`; `:536` modal
  title likewise.
- `InviteMemberModal` (`views.tsx:491-577`): add a **required department
  `<select>`** populated from the `departments` already loaded in `MembersView`
  (`views.tsx:63-76`) — pass them in as a prop. Change the POST body
  (`:516-520`) to `{ email, displayName, role: "client", departmentId }`.
- Result: creates `client_type='employee'` + `department_id` → shows
  immediately (via the existing poll) in enterprise Members, the dept drill-in,
  and the department console; CP counts roll up. Verification (magic-link) +
  dedup are already handled server-side.

**Admin invite:** if a separate "Invite admin" capability is still wanted, keep
it as its own clearly-labeled action (role `enterprise_admin`, no dept) — do not
conflate. (Recommend: drop it from this employees view; admins are invited
elsewhere. Confirm in review.)

**Add-existing:** `/api/enterprise/users` already attaches an existing user when
the email exists (invite → OTP fallback, idempotent upsert). A separate
"add existing" UI is optional — the same modal covers both. (Confirm whether a
distinct add-existing affordance is wanted here.)

**B. Row actions — make `…` a real, consistent, wired menu:**
- Replace the decorative `⋯` with a `RowActions`-style dropdown button (copy the
  partner `RowActions` pattern: real `<button>`, `stopPropagation`, outside-click
  close, hover-revealed but present on every row).
- Wired items (all hit existing endpoints, no no-ops):
  Resend invite (if pending) · Suspend/Reactivate · Open details (DrillPanel for
  Refill + Change department). No item is a no-op; nothing is missing per row.

### Decisions needed at review
1. Keep a separate "Invite admin" action on this view, or drop it (recommend
   drop — invite members here only)?
2. Row `…` menu: quick one-click items (Resend, Suspend) + "Open details", vs.
   full inline controls in the dropdown? (Recommend the former — refill/reassign
   need inputs, which the DrillPanel already provides cleanly.)

---

## Implemented (user decisions: keep both invites; full inline row menu)

All in `app/(staff)/enterprise/v2/_cc/views.tsx` unless noted.

- **Two invite actions:** primary "Invite a member" (`role:"client"` + required
  department `<select>`) and a secondary "Invite admin" (`role:"enterprise_admin"`,
  no dept). One `InviteMemberModal` with a `mode` prop; department list passed
  from `MembersView`. Member invites now create `client_type='employee'` +
  `department_id` → appear immediately (via the existing poll) in enterprise
  Members, the enterprise dept drill-in, and the department console; CP counts
  roll up. Backend unchanged (`/api/enterprise/users` already supported this).
- **Real row `…` menu (`MemberRowMenu`)** on every row: Refill (amount), Change
  department (select+Move), Suspend/Reactivate, Resend invite (if pending).
  Outside-click + Escape close, `stopPropagation` so it doesn't open the drill.
  Replaces the old decorative `aria-hidden` glyph.

### Suspend/reactivate money behavior (user-requested)
- **Suspend** (`PATCH /api/enterprise/members/[id]` → DEACTIVATED) now also calls
  the existing money-safe RPC **`deactivate_employee`**
  (`supabase/migrations/20260604120000_current_grant_ledger.sql:49`): refunds the
  member's remaining minutes to their **department pool**, sets
  `profiles.status='suspended'`, collapses allocated. (No new migration — RPC
  already deployed.) NB: refund target is the member's **department pool** (their
  funding source), not the org wallet directly; an org-wallet refund would need a
  new RPC + migration.
- **Reactivate** (→ ACTIVE) lifts the auth ban **and** sets
  `profiles.status='active'` so the department console agrees. Minutes are NOT
  auto-restored (they were returned on suspend); the admin refills again.
- **Refill while suspended is blocked:** the refill route returns 409
  (`refill/route.ts`, checks `profiles.status`), and the row menu replaces the
  refill input with a "Reactivate access before refilling" prompt + Reactivate
  button. So the admin is asked to reactivate first.

Typecheck clean (0 errors). Verified visually (mock preview): two buttons, member
modal department select, row menu on every row, suspended-member reactivate-first
prompt.
