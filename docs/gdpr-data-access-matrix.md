# GDPR Data-Access Matrix

Role × Data field × Allowed (`yes` / `no` / `agg` = aggregate-only, k-anonymity
applied). Enforced **server-side** (API + RLS), not just hidden in UI. Keep in
sync with the implementation. `k = 5` default suppression threshold.

Legend: ✅ allowed · 🚫 forbidden (strip server-side) · 📊 aggregate-only
(suppressed below k) · ➖ not applicable.

## Org / hierarchy identity

| Data field | Enterprise admin | Department mgr | Channel Partner |
|---|---|---|---|
| Own org name / code / status / plan | ✅ (own org) | ✅ (read-only parent name+code) | ✅ (per managed enterprise: name, plan, status) |
| Department list + names | ✅ (own org) | ✅ (own dept only) | 🚫 (no department breakdown) |
| Department codes | ✅ | ✅ (own) | 🚫 |
| Seat count / limits | ✅ | ✅ (own dept allocation) | ✅ (per enterprise total) |
| Contract / renewal / commission | ✅ (own) | 🚫 | ✅ (own commission + contract terms) |

## Member PII

| Data field | Enterprise admin | Department mgr | Channel Partner |
|---|---|---|---|
| Member full name | ✅ (own org) | ✅ (own dept members) | 🚫 **(current leak — remove)** |
| Member email | ✅ (own org) | ✅ (own dept members) | 🚫 **(current leak — remove)** |
| Member last-sign-in | ✅ (own org) | ✅ (own dept) | 🚫 **(current leak — remove)** |
| Member role / department | ✅ | ✅ (own dept) | 🚫 |
| Individual member usage (minutes) | ✅ (own org) | ✅ (own dept) | 🚫 (no per-member figures) |

## Usage / sessions

| Data field | Enterprise admin | Department mgr | Channel Partner |
|---|---|---|---|
| Per-member usage breakdown | 📊 (suppress < k) | 📊 (own dept, suppress < k) | 🚫 |
| Per-department usage | ✅ (own org) | ➖ (only own dept) | 🚫 (no dept breakdown) |
| Org/enterprise aggregate usage | ✅ | ✅ (own dept agg) | 📊 (per enterprise, suppress < k) |
| Session content (AI summary title/body) | 🚫 (not in mgmt views) | 🚫 | 🚫 |
| Customer email / guest_email on sessions | 🚫 (strip from mgmt endpoints) | 🚫 | 🚫 |
| Live-now session count | ✅ | ✅ (own dept) | 📊 (portfolio agg) |

## Billing

| Data field | Enterprise admin | Department mgr | Channel Partner |
|---|---|---|---|
| Org plan / statements / invoices | ✅ (own org) | 🚫 | 🚫 (sees own commission/payouts only) |
| Payment method | ✅ (own org) | 🚫 | ✅ (own partner payouts) |
| `stripe_customer_id` / `stripe_subscription_id` | 🚫 (never to browser) | 🚫 | 🚫 |
| Partner commission / payout history | ➖ | ➖ | ✅ (own) |

## Data-subject rights (controller = Enterprise admin)

| Control | Enterprise admin | Department mgr | Channel Partner |
|---|---|---|---|
| Export org data (portability) | ✅ | 🚫 | 🚫 |
| Member erasure / retention window | ✅ | 🚫 | 🚫 |
| Escalate member issue (no data) | ➖ | ➖ | ✅ ("request enterprise admin" action) |

## Access auditing

Every Channel Partner and admin **read** of another account's data is logged
(actor, role, tenant scope, table, member-id set, timestamp). `TODO(api):`
access-audit table does not exist yet.

## Current violations (to fix)

- 🔴 Channel Partner reads member name / email / last-sign-in / individual
  usage via `GET /api/reseller/orgs/[id]/departments/[deptId]/employees`.
- 🔴 `guest_calls` RLS is `USING(true)` → all session PII world-readable.
- 🔴 `/api/enterprise/sessions` + `/billing` ship customer email / AI summary /
  guest_name + Stripe IDs the UI never shows.
- 🔴 No k-anonymity anywhere; a group of 1 is fully attributable.
- 🔴 No access-audit log for back-office reads.
