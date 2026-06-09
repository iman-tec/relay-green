# Referral attribution + member status lifecycle — Phase 0 findings

Code wins on disagreement. Two items: (1) referral-link → CP attribution on
signup; (2) added members must be **Invited** until first login. Overlaps the
e2e-gaps doc (CP2) and the member-model work — same single source of truth.

---

## 1. Referral link → signup attribution — ALREADY WIRED

The brief's premise ("individual referrals are non-functional") is **outdated** —
the attribution precondition already exists end to end:

- **Link** — `partner/v2/_portal/ResourcesView.tsx:24`:
  `https://${BRAND_DOMAIN}/?ref=${reseller_code}`.
- **First-touch cookie** — `proxy.ts:138-146`: on any page with `?ref=`, stamps
  `relay_ref` (httpOnly, 30-day, first-touch wins) if not already set.
- **Signup reads it** — `app/api/auth/verify-otp/route.ts:193-200`: on account
  creation reads `relay_ref` → `attributeIndividualReferral(admin, userId, refCode)`.
- **Attribution writer** — `lib/billing/individualReferral.ts:35-98`: resolves an
  **active** reseller by `reseller_code`, then sets **`profiles.reseller_id`**
  (the durable customer↔CP link, `:79-82`) and inserts an `individual_referrals`
  row snapshotting the 10/10 rates (`:84-90`). Idempotent.

**Attribution field:** `profiles.reseller_id` (there is **no `referred_by`
column** — grep is empty; the brief's "referred_by" maps to `reseller_id` in
code). Durable + automatic. This is the precondition the 10/10 economics ride on
(discount `create-relay-checkout/index.ts:105-121`, commission accrual
`relay-stripe-webhook/index.ts:200-205` → `accrue_referral_commission`).

### 1b. "Already belongs elsewhere" guard (defined in code)
`attributeIndividualReferral` blocks (idempotent, one-per-customer):
- **Enterprise member** — if `profiles.organization_id` is set → skip (org users
  aren't individual referrals).
- **Already attributed** — if `profiles.reseller_id` already set → skip (no
  silent re-point; first attribution wins).
- **Self-referral** — referred user == the reseller's own user → skip.

**Gap (the only real remaining piece, = e2e CP2):** no writer flips an
individual `active → converted` when they later join an org as an employee, so an
attributed individual who becomes an employee keeps accruing CP commission
(latent double-count). Decision already taken (add the `converted` writer).

**Net for item 1:** attribution is functional today. Work = (a) verify/lock with
a test; (b) add the `active→converted` transition on org-attach. No new signup
wiring needed.

---

## 2. Member status: added members must be Invited until first login

### The bug
`profiles.status` column defaults **`'active'`**
(`20260521170000_enterprise_refill_and_minutes.sql:109`,
`CHECK (status IN ('active','suspended'))` — note: **no `'invited'` value
allowed**). The invite/add paths never set status:
- `/api/enterprise/users` `provisionMember` upsert sets `organization_id`,
  `department_id`, `client_type`, `is_onboarded` — **not `status`** → defaults
  `'active'` (`users/route.ts:346-356`).
- `/api/enterprise/departments/[id]/employees` + `/attach` + `/api/department/
  employees` create paths — same, no `status` set → `'active'`.

So a freshly-added member is `'active'` immediately. **Never Invited.**

### How each surface currently derives status (inconsistent)
| Read | Status source | Shows "invited"? |
|---|---|---|
| `/api/enterprise/members` (employee roster) | **auth ban only** — `banned ? suspended : active` (`members/route.ts:79-103`) | **No** → always Active |
| `/api/department/employees` (dept console) | **`profiles.status`** column (`employees/route.ts:49,118`) | **No** (column is active/suspended only) |
| `/api/enterprise/users` GET (org users, not roster) | **`last_sign_in_at`** — `hasSignedIn ? active : invited` (`users/route.ts:130-140`) | **Yes** (correct, but different surface) |

### First-login detection
- The signal is **`auth.users.last_sign_in_at`** (null = invited-not-accepted).
- Trigger `20260529000000_invites_accepted_on_signin.sql` flips the **`invites`**
  table `sent→accepted` on first sign-in — it does **NOT** touch
  `profiles.status`. **No mechanism flips `profiles.status` invited→active.**

### Recommended fix — derive status at read (no migration)
Unify all member reads on auth signals, matching the already-correct
`/api/enterprise/users` logic:
```
status = banned        ? "suspended"
       : last_sign_in_at ? "active"
       : "invited"
```
Apply in **`/api/enterprise/members`** (already fetches auth via `listUsers` —
add the `last_sign_in` branch; today it only checks ban) and
**`/api/department/employees`** (currently reads `profiles.status` — switch to
auth-derived: it must fetch `last_sign_in_at` + ban, like the members route).
This makes Invited→Active **automatic** (first login sets `last_sign_in_at` →
next 20s poll shows Active), consistent across enterprise + department, with
**Suspended** still separate/reversible (ban). No `profiles.status` migration, no
new trigger, no `'invited'` enum value needed (it's derived, not stored).

`StatusDot` already supports `"invited"` (amber) + `"suspended"`
(`StatusDot.tsx:27-31`), so the UI renders it correctly once the API returns it.

**Alternative (heavier):** add `'invited'` to the `profiles.status` CHECK, set it
on create, add a signin trigger to flip → active. More moving parts; conflicts
with the deactivate RPCs that own the column. **Not recommended.**

### Read/consumer sites (propagation)
- Enterprise: `views.tsx` MembersView (`StatusDot status={m.status}`), the
  MemberRowMenu/MemberDetail `pending = !lastSignIn` (already aligns).
- Department: `_cc/OverviewView.tsx` employee rows (status from
  `DeptData.employees`).
- CP: **rollup-only, no member roster** (`reseller/.../employees` returns a count,
  PII-blocked) → member status is N/A for CP. ("CP view if applicable" = not
  applicable for individual member status.)
All three auto-refresh via existing 20s polls (`useEnterprise`/`useDepartment`).

---

## Decisions needed at review
1. **Status:** derive-at-read (Invited = no `last_sign_in_at`) across
   `/api/enterprise/members` + `/api/department/employees` — recommended (no
   migration, auto via poll). Confirm vs the stored-column+trigger approach.
2. **Referral:** attribution already works; the only build is the
   `active→converted` writer (already decided in e2e CP2). Confirm no additional
   signup wiring is expected.
