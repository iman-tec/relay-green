# Follow-ups parked during the role + employee surface work

Things deliberately deferred during the chunk-1–10 sweep + the enterprise
hierarchy / employee billing follow-ons. Not blockers — pick up when time
permits.

## UX consistency

- **Platform-side `client → "Client"` label.** In the org-facing
  `/enterprise` we relabeled `client → "Employee"` since that matches the
  customer org's mental model (these are *their* employees). But on the
  platform-side surfaces (`/admin/users` Resellers / Enterprise tabs etc.)
  `formatRole` from `lib/relay/role-labels.ts` still returns `"Client"` for
  the role identifier. That's intentional from the platform's perspective
  (we're selling to enterprises whose end-users are clients to us). Decide
  whether to keep the asymmetry or unify the label. If unified, change
  `formatRole` AND audit every super_admin / supervisor surface for the
  knock-on effect.

## Backend

- **Mid-session enforcement for employee minute exhaustion.**
  `20260521200000_end_session_employee_billing.sql` debits at session-end
  and clamps `profiles.remaining_minutes` at 0. If an employee with 5 min
  in the pool runs a 30-min session, we currently bill the full 30, clamp
  remaining to 0, and the employee gets the 25 min overage for free. The
  legacy free/paid system has a watchdog that ends sessions when balance
  drains; we don't have an equivalent for employees. Wire one up if
  overage starts mattering.

- **`otp_codes` table is provisioned but unused.** Added in
  `20260521170000_enterprise_refill_and_minutes.sql` for a future hybrid
  first-login flow. Currently `/api/auth/first-login/send-otp` (also
  dormant) delegates to Supabase's `signInWithOtp` and doesn't touch
  `otp_codes`. Either wire it up or drop the table.

- **Dormant `/api/auth/first-login/send-otp` route.** Code path exists +
  the DB primitives exist (`login_required_code`, `verify_login_code`),
  but no client UI calls this endpoint. The actual code-matrix enforcement
  happens via `/api/auth/signin-password` after password validation, which
  was the path we chose. Decide whether to delete the unused route or
  rewire something to use it.

- **`requireEnterpriseAdmin` still accepts department_admin.** After
  `/finance` got tightened to enterprise_admin only, the underlying gate
  in `lib/enterprise-auth.ts` is still permissive. Means a dept_admin can
  curl `/api/enterprise/*` and `/api/internal/*` directly even though the
  UI no longer surfaces those. If you want airtight separation, either
  split the gate into `requireEnterpriseAdmin` (strict) +
  `requireEnterpriseOrDeptAdmin` (loose), or tighten the existing one and
  audit downstream callers.

## Email / deliverability

- **Send email through our own SMTP instead of Supabase's pipeline.**
  Doable in ~4-6 hours per the discussion in chat. Switch
  `sendInvitationEmail` + `/api/auth/send-otp` to `generateLink` + direct
  nodemailer/provider SDK send. Won't fix recipient-side greylisting on
  its own, but unlocks delivery webhooks + faster path through providers
  with REST APIs. See chat history for full plan.

- **`supabase/templates/invite.html` is the source of truth in the repo
  but isn't auto-deployed.** Supabase reads its template from the project
  dashboard. After editing the file, paste it into Auth → Email Templates
  → "Invite user" in Studio for changes to take effect.

## Inorganic-org creation needs a debit path

`/api/admin/orgs` POST currently accepts `allocatedMinutes` and calls
`transfer_to_organization`. `transfer_to_organization` knows to debit the
reseller when the org is inorganic — but `/api/admin/orgs` doesn't set
`organizations.reseller_id` at insert time. So a super_admin minting an
org via this endpoint can never produce an inorganic org. Inorganic orgs
are created by resellers via `/api/reseller/enterprises`, which does set
reseller_id correctly. If super_admin needs an "I'm minting on behalf of
reseller X" path, plumb a `resellerId` param through `/api/admin/orgs`.
