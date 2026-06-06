# API Routes — Org-Management Half of `app/api/`

> Phase 3, non-destructive audit. Source is read-only. Covers `api/admin/**`
> (28 handlers), `api/enterprise/**` (27) + `api/enterprise-request` (1),
> `api/department/**` (9), `api/reseller/**` (15). Inventory per
> `docs/audit/00-ground-truth.md` §5.
>
> Literal secrets/ids are redacted. All citations are `file:line`. Findings
> (NEW candidates only, `P3-Oxx`) are at the end. Known issues are
> cross-referenced, not re-filed.

---

## Auth guards (documented once)

All four helpers follow the same shape: resolve the cookie-bound user via
`createServerClient().auth.getUser()`, read role names from the
`user_role_names` view, read the relevant scope id from `profiles`, and — on
success — return BOTH a cookie-scoped `supabase` client AND an elevated
service-role `admin` client (`createAdminClient(URL, SERVICE_ROLE_KEY)`,
RLS-bypassing). On failure they return `{ ok:false, status, error }`; callers
uniformly do `NextResponse.json({ error: gate.error }, { status: gate.status })`.

| Helper | File:line | Requires (role) | Scope id resolved | Fail returns |
| --- | --- | --- | --- | --- |
| `requireSuperAdmin` | `lib/admin-auth.ts:27` | `super_admin` | — (none; full service-role) | `401 not_signed_in` · `403 forbidden` · `401 service_role_not_configured` |
| `requireEnterpriseAdmin` | `lib/enterprise-auth.ts:30` | `enterprise_admin` **OR** `department_admin` (super_admin explicitly NOT accepted, comment :38) | `orgId` ← `profiles.organization_id` | `401 not_signed_in` · `403 forbidden` · `403 no_organization` · `401 service_role_not_configured` |
| `requireDepartmentAdmin` | `lib/department-auth.ts:31` | `department_admin` | `departmentId` + `orgId` ← `profiles.department_id`/`organization_id` | `401 not_signed_in` · `403 forbidden` · `403 no_department` · `403 no_organization` · `401 service_role_not_configured` |
| `requireReseller` | `lib/reseller-auth.ts:29` | `reseller` | `resellerId` ← `profiles.reseller_id` | `401 not_signed_in` · `403 forbidden` · `403 no_reseller` · `401 service_role_not_configured` |

**Cross-ref P1-2 (verified):** `requireEnterpriseAdmin` accepts
`department_admin` (`lib/enterprise-auth.ts:48-51`). A department admin's
`organization_id` resolves to their parent org, so they obtain **org-wide**
scope on every `/api/enterprise/*` endpoint — including org settings PATCH,
department create/delete, org-wide user invite/delete, wallet top-up, plan
activation, and the **full-org GDPR `/api/enterprise/export`**. Flagged per-row
as `[P1-2]`.

**Inline-gate variant (not the helper).** Five super-admin GET endpoints
re-implement the gate inline instead of calling `requireSuperAdmin`:
`admin/engineers`, `admin/engineers/[id]`, `admin/matching`,
`admin/leave-requests`, `admin/availability-requests`, `admin/ops-escalations`.
They return `401 not_signed_in` / `403 forbidden` / **`500`**
`service_role_not_configured` (note the 500 vs the helper's 401), e.g.
`app/api/admin/engineers/route.ts:30-54`. Behaviourally equivalent gate, minor
status drift.

**Service-role + raw-error conventions (apply to nearly every row below):**
- **Service-role client** is used by all `admin`-returning handlers (the
  `supabase` cookie client is used only by the per-user notification routes).
  Every such handler bypasses RLS, so tenant scoping is enforced *in code*
  (ownership re-checks), not by the database.
- **Raw DB error text** (`error.message` from PostgREST/Supabase) is returned
  verbatim to the client in the overwhelming majority of handlers
  (`SEC-API-PROXY-SCHEMA-1` family). Treated as the default; the per-row
  "Error codes" column lists the *shaped* errors, and notable raw leaks are
  flagged. See **P3-O02**.
- **`auth.admin.listUsers({ page:1, perPage:1000 })`** is the email-resolution
  pattern in most list endpoints — a hard 1000-user cap (silent truncation
  past that). See **P3-O03**. The one endpoint that avoids it is
  `admin/users` GET (uses `user_meta_for_admin` RPC on the page slice,
  `app/api/admin/users/route.ts:142`).
- **No mass-assignment found:** every PATCH/PUT builds an explicit allow-listed
  `patch`/`update` object; raw request bodies are never spread into a DB
  update.

---

## Domain: `api/admin/**` (super_admin) — 28 handlers

Guard: `requireSuperAdmin` unless noted "inline gate".

| Route | Method | Auth guard | Input shape | Output shape | Error codes (shaped) | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/admin/orgs` | GET | `requireSuperAdmin` (`:28`) | — | `{ orgs:[{id,name,primaryDomain,status,enterpriseType,resellerId,resellerName,allocated/used/remainingMinutes,members[],departments[]}] }` | `500` raw `orgErr.message` | `/admin` orgs/users console | svc-role; raw err; listUsers-1000 (`:99`) |
| `/api/admin/orgs` | POST | `requireSuperAdmin` (`:197`) | `{name,primaryDomain?,adminEmail,adminDisplayName,allocatedMinutes?,resellerId?}` | `{org,admin,invited,attachedExisting}` + one-time enterprise_code | `400` missing/alloc/reseller · `404` reseller · `409` `crossOrgError` · `500` | `/admin` create-org | svc-role; cross-org guard `orgGuard.ts`; mints/debits via `transfer_to_organization` RPC; rolls back org on invite/role failure |
| `/api/admin/orgs/[id]` | PATCH | `requireSuperAdmin` (`:20`) | `{name?,status?}` (status∈active/suspended) | `{org}` | `400` nothing/raw · `404` not found | `/admin` org edit | allow-listed patch |
| `/api/admin/orgs/[id]` | DELETE | `requireSuperAdmin` (`:53`) | — | `{ok:true}` | `500` raw (member/detach/org) | `/admin` org delete | **non-atomic** multi-step (detach profiles → drop roles → delete org); partial failure leaves inconsistent state — see P3-O05 |
| `/api/admin/orgs/[id]/refill` | POST | `requireSuperAdmin` (`:26`) | `{amount>0}` | `{ok,organization:{...minutes}}` | `400` amount/insufficient/raw · `404` | `/admin` org refill | `transfer_to_organization` RPC; friendly remap of "insufficient" |
| `/api/admin/orgs/[id]/members` | POST | `requireSuperAdmin` (`:30`) | `{email,displayName,role?∈{enterprise_admin,client}}` | `{member,invited,attachedExisting}` | `400` · `404` org · `500` | `/admin` add member | svc-role; listUsers-1000 |
| `/api/admin/orgs/[id]/admins` | POST | `requireSuperAdmin` (`:30`) | `{promoteUserId}` OR `{email,displayName}` | `{ok,admin}` | `400` invalid/need · `404` org/not_in_org · `409` crossOrg · `500` | `/admin` org admins | cross-org guard; listUsers-1000 |
| `/api/admin/orgs/[id]/admins/[userId]` | DELETE | `requireSuperAdmin` (`:21`) | — | `{ok:true}` | `400` raw · `404` user · `409` not bound | `/admin` remove admin | clears org binding + drops grant; ownership re-check (`:42`) |
| `/api/admin/orgs/[id]/departments` | POST | `requireSuperAdmin` (`:25`) | `{name,adminEmail,adminDisplayName,allocatedMinutes?}` | `{department,adminUserId}` | `400` · `404` org · `409` dup name/crossOrg · `500` | `/admin` dept create | `transfer_to_department` RPC; cross-org guard |
| `/api/admin/orgs/[id]/departments/[deptId]` | PATCH | `requireSuperAdmin` (`:32`) | `{name?,status?}` | `{department}` | `400` · `404` `loadDept` org-match · `409` dup | `/admin` dept edit | ownership: `enterprise_id===orgId` (`:28`) |
| `/api/admin/orgs/[id]/departments/[deptId]` | DELETE | `requireSuperAdmin` (`:75`) | — | `{ok:true}` | `400` raw · `404` | `/admin` dept delete | `release_department_minutes` RPC (PGRST202 soft-fallback `:97`); detaches employees; **non-atomic** |
| `/api/admin/orgs/[id]/departments/[deptId]/admin` | POST | `requireSuperAdmin` (`:26`) | `{promoteUserId}` OR `{email,displayName}` | `{ok,admin}` | `400` · `403` dept_not_active · `404` not_owned/not_in_department · `409` already_has_admin/crossOrg/other_dept · `500` | `/admin` assign dept admin | fills empty slot only |
| `/api/admin/orgs/[id]/departments/[deptId]/employees` | GET | `requireSuperAdmin` (`:24`) | — | `{department,admin,employees[]}` | `404` org-match · `500` raw | `/admin` dept drilldown | listUsers-1000; status from `last_sign_in_at` |
| `/api/admin/orgs/[id]/departments/[deptId]/employees` | POST | `requireSuperAdmin` (`:208`) | `{name,email,allocatedMinutes?}` | `{employee}` | `400` · `403` dept inactive · `404` · `409` crossOrg/other_dept · `500` | `/admin` add employee | `transfer_to_employee` RPC; post-write verify (`:384`) |
| `/api/admin/orgs/[id]/departments/[deptId]/employees/[empId]` | DELETE | `requireSuperAdmin` (`:28`) | — | `{ok,wasAdmin}` | `400` raw · `404` · `409` other org | `/admin` remove employee | `release_employee_minutes` RPC (soft-fallback); full `:id/:deptId/:empId` chain verified |
| `/api/admin/users` | GET | `requireSuperAdmin` (`:51`) | query `?scope=staff|customer&role&page&pageSize&q&sort` | `listResponse(rows,count,page,pageSize)` rows:`{id,email,displayName,roles[],primaryRole,status,awaitingFirstSignIn,createdAt}` | `500` raw (role/profile) | `/admin` users list | **paginated** via `lib/api/list-query`; avoids listUsers-1000 (RPC `user_meta_for_admin`) |
| `/api/admin/users` | POST | `requireSuperAdmin` (`:193`) | `{email,displayName,role∈{engineer,supervisor,super_admin},podName?,podRole?}` | `{user,invited,attachedExisting}` | `400` bad role · `500` | `/admin` create staff | invite-only mode; deletes auth user on role failure if just-created |
| `/api/admin/users/[id]` | PATCH | `requireSuperAdmin` (`:39`) | `{displayName?,role?,status?∈{ACTIVE,DEACTIVATED}}` | `{ok:true}` | `400` self-edit/bad role/bad status · `500` | `/admin` user edit | DEACTIVATED = 100yr ban; clears engineer/supervisor before re-insert |
| `/api/admin/users/[id]` | DELETE | `requireSuperAdmin` (`:140`) | — | `{ok:true}` | `400` self · `403` super_admin protected · `500` | `/admin` user delete | hard-delete auth user (cascade) |
| `/api/admin/users/[id]/resend-invite` | POST | `requireSuperAdmin` (`:21`) | — | `{resent:true}` | `500` raw | `/admin` resend invite | `resendInvitationEmail` |
| `/api/admin/resellers` | GET | `requireSuperAdmin` (`:41`) | — | `{resellers:[{...,commission,minutes,enterprises[],counts}]}` | `500` raw | `/admin` partners | svc-role |
| `/api/admin/resellers` | POST | `requireSuperAdmin` (`:147`) | `{name,email,commission?0-100,allocatedMinutes?}` | `{reseller,contact,invited,attachedExisting}` | `400` · `409` dup email · `500` | `/admin` create partner | `transfer_to_reseller` RPC; rolls back reseller on failure; listUsers-1000 |
| `/api/admin/resellers/[id]` | PATCH | `requireSuperAdmin` (`:23`) | `{name?,email?,commission?,status?}` | `{ok,status?}` | `400` invalid · `409` email dup · raw | `/admin` partner edit | suspend → `deactivate_reseller` RPC + `banUser`; no DELETE (spec: no data loss) |
| `/api/admin/resellers/[id]/refill` | POST | `requireSuperAdmin` (`:18`) | `{amount>0}` | `{ok,reseller:{...minutes}}` | `400` amount/raw | `/admin` partner refill | `transfer_to_reseller` RPC |
| `/api/admin/pods` | GET | `requireSuperAdmin` (`:22`) | — | `{pods:[{...,supervisors[],engineers[]}]}` | `500` raw | `/admin` pods | listUsers-1000 (`:54`); cross-ref **P1-3** (consumer reads `body.users` from a different paginated endpoint) |
| `/api/admin/pods` | POST | `requireSuperAdmin` (`:107`) | `{name,description?}` | `{pod}` | `400` name/raw · `500` slug | `/admin` create pod | auto-slug retry |
| `/api/admin/pods/[id]` | PATCH | `requireSuperAdmin` (`:21`) | `{name?,archived?}` | `{pod}` | `400` empty/no-change · `404` | `/admin` rename/archive pod | |
| `/api/admin/pods/[id]/members` | POST | `requireSuperAdmin` (`:27`) | `{userId,podRole∈{supervisor,engineer}}` | `{member}` | `400` bad role/check · `409` already in pod · `500` | `/admin` add pod member | UNIQUE(user_id) → names existing pod |
| `/api/admin/pods/[id]/members/[userId]` | DELETE | `requireSuperAdmin` (`:15`) | — | `{ok:true}` | `404` not in pod · `500` | `/admin` remove pod member | |
| `/api/admin/pods/eligible-users` | GET | `requireSuperAdmin` (`:28`) | query `?role=supervisor|engineer` | `{users:[{id,email,displayName}]}` | `400` bad role · `500` | `/admin` pod picker | listUsers-1000 |
| `/api/admin/engineers` | GET | inline gate (`:30-54`) | — | `{engineers[],pods[]}` | `401`·`403`·`500` svc-role | `/admin` expertise matrix | listUsers-1000 (`:83`) |
| `/api/admin/engineers/[id]` | PATCH | inline gate (`:34-57`) | `{project_types?,ai_tools?,backend_stacks?,frontend_stacks?,experienceLevel?,isAvailable?}` | `{ok:true}` | `401`·`403`·`500` raw | `/admin` engineer edit | allow-listed; **docstring stale** (says expertise/technologies/issues/environments) |
| `/api/admin/matching` | GET | inline gate (`:47-62`) | — | `{rows:AdminMatchingRow[]}` | `401`·`403`·`500` raw/svc-role | `/admin` live matching board | platform-wide offers; listUsers-1000 (`:198`) |
| `/api/admin/leave-requests` | GET | inline gate (`:19-33`) | — | `{requests[]}` | `401`·`403`·`500` svc-role | `/admin` leave inbox | decisions via RPC client-side |
| `/api/admin/availability-requests` | GET | inline gate (`:18-32`) | — | `{requests[]}` | `401`·`403`·`500` svc-role | `/admin` availability inbox | |
| `/api/admin/ops-escalations` | GET | inline gate (`:19-33`) | — | `{escalations[]}` | `401`·`403`·`500` svc-role | `/admin` ops escalations | |

---

## Domain: `api/enterprise/**` (enterprise_admin OR department_admin) — 27 handlers + enterprise-request

Guard: `requireEnterpriseAdmin`. **Every row below is reachable by a
`department_admin` (P1-2)** — flagged where the blast radius is org-wide.
Tenant scoping is enforced in code via `orgId` from the gate + per-row
ownership re-checks; client-supplied ids are never trusted for scope.

| Route | Method | Auth guard | Input shape | Output shape | Error codes (shaped) | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/enterprise/me` | GET | `requireEnterpriseAdmin` (`:23`) | — | `{org,channelPartner,kpis}` | `404` org · raw | `/enterprise` dashboard | synthetic spend ×300¢ (`:127`) — cross-ref P1-15; listUsers? no |
| `/api/enterprise/org` | PATCH | `requireEnterpriseAdmin` (`:28`) | `{name?,primaryDomain?,retentionDays?∈{0,90,180,365}}` | `{org}` | `400` name/domain/retention/nothing · `409` domain_taken · `500` | `/enterprise` settings | `[P1-2]` org-wide write by dept_admin; allow-listed |
| `/api/enterprise/regenerate-code` | POST | `requireEnterpriseAdmin` (`:26`) | — | `{enterpriseCode}` | `500` raw/exhausted | **ORPHAN (P1-13)** — no UI caller | `[P1-2]`; rotates org code |
| `/api/enterprise/billing` | GET | `requireEnterpriseAdmin` (`:32`) | — | `{currency,revenue,plan,recentTransactions}` | `404` org · raw | `/enterprise` billing | synthetic ×300¢; stripe ids deliberately withheld (`:150`) |
| `/api/enterprise/usage` | GET | `requireEnterpriseAdmin` (`:35`) | — | `{byDepartment[],byPeriod[],perMinuteCents}` | raw | `/enterprise` usage | k-anonymity suppression (`lib/relay/kanonymity`); synthetic spend |
| `/api/enterprise/users` | GET | `requireEnterpriseAdmin` (`:41`) | query `?scope=staff|users` | `{members[]}` | `400` scope · raw | `/enterprise` members | **unbounded** (all org profiles, no pagination); listUsers-1000; erased PII suppressed |
| `/api/enterprise/users` | POST | `requireEnterpriseAdmin` (`:387`) | single `{email,displayName,role∈{enterprise_admin,client},departmentId?}` OR `{recipients:[...≤500]}` | single `{user,invited,attachedExisting}` / bulk `{sent,total,results[]}` | `400` · `409` crossOrg/other-org · `500` | `/enterprise` invite flow | `[P1-2]`; cross-org guards; `transfer_to_employee` when dept-bound; listUsers-1000 ×2 |
| `/api/enterprise/users/[id]` | DELETE | `requireEnterpriseAdmin` (`:21`) | — | `{ok:true}` | `400` self · `403` ent_admin protected · `404` not in org · `500` | `/enterprise` remove member | hard-delete auth user |
| `/api/enterprise/members/[id]` | PATCH | `requireEnterpriseAdmin` (`:31`) | `{status∈{ACTIVE,DEACTIVATED}}` | `{ok,status}` | `400` self/bad · `403` ent_admin · `404` not_in_org | `/enterprise` member toggle | `banUser`/`unbanUser` |
| `/api/enterprise/members/[id]/erase` | POST | `requireEnterpriseAdmin` (`:30`) | — | `{ok,member,alreadyErased}` | `400` self · `404` · `500` raw | `/enterprise` GDPR erase | strips full_name/avatar, stamps erased_at |
| `/api/enterprise/members/[id]/resend-invite` | POST | `requireEnterpriseAdmin` (`:22`) | — | `{resent:true}` | `404` not_in_org · `500` raw | `/enterprise` resend | scoped to caller org |
| `/api/enterprise/departments` | GET | `requireEnterpriseAdmin` (`:25`) | — | `{enterprise,departments[]}` | `500` raw | `/enterprise` departments | `[P1-2]` |
| `/api/enterprise/departments` | POST | `requireEnterpriseAdmin` (`:121`) | `{name,adminEmail,adminDisplayName,allocatedMinutes?}` | `{department,admin,invited,...}` | `400` · `403` inactive · `409` dup/crossOrg · `500` | `/enterprise` create dept | `[P1-2]`; `transfer_to_department` RPC |
| `/api/enterprise/departments/[id]` | PATCH | `requireEnterpriseAdmin` (`:21`) | `{name?,status?}` | `{ok,status?}` | `400` · `404` not_owned · `409` dup | `/enterprise` dept edit | suspend → `deactivate_department` RPC + `banUsers` |
| `/api/enterprise/departments/[id]/refill` | POST | `requireEnterpriseAdmin` (`:17`) | `{amount>0}` | `{ok,department,enterpriseRemaining}` | `400` · `404` not_owned | `/enterprise` dept refill | `transfer_to_department` RPC |
| `/api/enterprise/departments/[id]/admin` | POST | `requireEnterpriseAdmin` (`:33`) | `{promoteUserId}` OR `{email,displayName}` | `{ok,admin}` | `400` · `403` inactive · `404` not_owned/not_in_dept · `409` has_admin/crossOrg/other_dept · `500` | `/enterprise` assign dept admin | empty-slot only |
| `/api/enterprise/departments/[id]/employees` | GET | `requireEnterpriseAdmin` (`:39`) | — | `{department,admin,employees[]}` | `404` not in org · `500` raw | `/enterprise` dept drilldown | listUsers-1000; **writes GDPR access audit** (`accessAudit.ts:171`) |
| `/api/enterprise/departments/[id]/employees` | POST | `requireEnterpriseAdmin` (`:194`) | `{name,email,allocatedMinutes?}` | `{employee}` | `400` · `403` inactive · `404` · `409` crossOrg/other_dept · `500` | `/enterprise` add employee | `transfer_to_employee` RPC |
| `/api/enterprise/departments/[id]/employees/[empId]` | DELETE | `requireEnterpriseAdmin` (`:21`) | — | `{ok,wasAdmin}` | `400` raw · `404` · `409` other org | `/enterprise` remove employee | `release_employee_minutes` soft-fallback |
| `/api/enterprise/departments/[id]/employees/[empId]/refill` | POST | `requireEnterpriseAdmin` (`:22`) | `{amount>0}` | `{ok,employee,departmentRemaining}` | `400` · `403` dept inactive · `404` | `/enterprise` employee refill | `transfer_to_employee` RPC |
| `/api/enterprise/sessions` | GET | `requireEnterpriseAdmin` (`:14`) | query `?limit≤200&since` | `{sessions[]}` | `500` raw | `/enterprise` recent sessions | PII-minimized (no email/summary); listUsers? no |
| `/api/enterprise/export` | POST | `requireEnterpriseAdmin` (`:32`) | — | `application/zip` (org/dept/members/sessions/usage/billing CSVs) | `404` org | `/enterprise` GDPR export | **`[P1-2]` dept_admin can export ENTIRE org's data** — escalation; listUsers-1000 |
| `/api/enterprise/notifications` | GET/POST | `requireEnterpriseAdmin` (`:18`/`:45`) | POST: — | GET `{items,unread}` / POST `{ok}` | `500` raw | `/enterprise` bell | **cookie `supabase` client** (per-user, RLS) |
| `/api/enterprise/notifications/[id]` | PATCH | `requireEnterpriseAdmin` (`:15`) | — | `{ok}` | `400` missing_id · `500` | `/enterprise` mark read | cookie client |
| `/api/enterprise/notification-prefs` | GET/PUT | `requireEnterpriseAdmin` (`:37`/`:62`) | PUT `{sessionAlerts?,lowMinutes?,weeklyDigest?}` | `{prefs}` | `500` raw | `/enterprise` settings | merge-on-upsert; svc-role |
| `/api/enterprise/wallet` | GET | `requireEnterpriseAdmin` (`:21`) | — | `{currency,...minutes,distributedMinutes,bundles}` | `404` org · raw | `/enterprise` wallet | |
| `/api/enterprise/wallet/checkout` | POST | `requireEnterpriseAdmin` (`:25`) | `{bundleCode∈starter/team/scale}` | `{clientSecret,paymentIntentId,amountCents,minutes,bundleLabel}` | `400` bundle · `500` stripe key | `/enterprise` wallet buy | Stripe PaymentIntent; metadata-tagged |
| `/api/enterprise/wallet/topup` | POST | `requireEnterpriseAdmin` (`:32`) | `{paymentIntentId}` | `{ok,minutesAdded,remainingMinutes}` | `400` · `402` not paid · `403` other org · `404` · `500` | `/enterprise` wallet credit | re-verifies PI w/ Stripe; **idempotency via PI metadata only (race window)** — see P3-O06 |
| `/api/enterprise/wallet/activate-plan` | POST | `requireEnterpriseAdmin` (`:31`) | `{tier∈starter/pro/business/enterprise,paymentIntentId?}` | `{ok,plan}` | `400` tier/contact-sales · `500` raw | **ORPHAN (P1-13)** | **trusts client `tier`; never verifies payment** — see P3-O07; `[P1-2]` |
| `/api/enterprise-request` | POST | **none (public)** + honeypot + per-IP rate limit | `{name,email,company?,message≥10,channelPartnerId?,channelPartnerName?,website(honeypot)}` | `{ok:true}` | `400` invalid_json/invalid/honeypot-as-ok · `429` rate_limited · `500` not_configured/persist_failed | landing `EnterpriseCta` | **direct service-role** (`createClient`, `:56`); **in-memory limiter 5/10min per IP** (`:28-30`) — ineffective multi-instance, see P3-O08; resolves partner name from id server-side |

---

## Domain: `api/department/**` (department_admin) — 9 handlers

Guard: `requireDepartmentAdmin`. Scope = `departmentId`/`orgId` from gate; all
writes re-check `department_id===departmentId` ownership.

| Route | Method | Auth guard | Input shape | Output shape | Error codes (shaped) | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/department` | PATCH | `requireDepartmentAdmin` (`:17`) | `{name}` | `{ok,name}` | `400` required · `409` dup · raw | `/department` settings | renames own dept only (no id trusted) |
| `/api/department/employees` | GET | `requireDepartmentAdmin` (`:27`) | — | `{department,enterprise,employees[]}` | `500` missing | `/department` roster | listUsers-1000; employees only (`client_type='employee'`) |
| `/api/department/employees` | POST | `requireDepartmentAdmin` (`:321`) | single `{name,email,allocatedMinutes?}` OR `{recipients:[...≤500]}` | single `{employee,department,invited,...}` / bulk `{sent,total,results[]}` | `400` · `403` inactive · `409` other dept · `500` | `/department` invite | `transfer_to_employee` RPC; `recordInvite` |
| `/api/department/employees/[id]` | PATCH | `requireDepartmentAdmin` (`:26`) | `{name?,status?}` (password/department_id rejected) | `{ok,status?}` | `403` password/reassign forbidden · `404` not_owned · `400` raw | `/department` employee edit | suspend → `deactivate_employee` RPC + `banUser` |
| `/api/department/employees/[id]/refill` | POST | `requireDepartmentAdmin` (`:17`) | `{amount>0}` | `{ok,employee,departmentRemaining}` | `400` · `404` not_owned | `/department` refill | `transfer_to_employee` RPC |
| `/api/department/usage` | GET | `requireDepartmentAdmin` (`:20`) | — | `{byPeriod[],perMinuteCents}` | raw | `/department` reporting | k-anon; synthetic ×300¢ |
| `/api/department/sessions` | GET | `requireDepartmentAdmin` (`:17`) | query `?limit≤200` | `{sessions[]}` | `500` raw | `/department` sessions | PII-minimized; own-dept names allowed |
| `/api/department/notifications` | GET/POST | `requireDepartmentAdmin` (`:19`/`:55`) | — | `{items,unread}`/`{ok}` | `500` raw | `/department` bell | **cookie `supabase` client** (per-user RLS) |
| `/api/department/notifications/[id]` | PATCH | `requireDepartmentAdmin` (`:15`) | — | `{ok}` | `400` missing_id · `500` | `/department` mark read | cookie client |
| `/api/department/notification-prefs` | GET/PUT | `requireDepartmentAdmin` (`:32`/`:57`) | PUT `{sessions?,lowMinutes?,newMember?}` | `{prefs}` | `500` raw | `/department` settings | merge-on-upsert |

---

## Domain: `api/reseller/**` (reseller) — 15 handlers

Guard: `requireReseller`. Scope = `resellerId`; org/dept writes re-check
`organizations.reseller_id===resellerId`. GDPR: partner endpoints expose
**aggregate-only** data (counts + k-anon usage), never end-user PII.

| Route | Method | Auth guard | Input shape | Output shape | Error codes (shaped) | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/reseller/dashboard` | GET | `requireReseller` (`:29`) | — | `{reseller,enterprises[]}` | `500` raw/missing | `/reseller` dashboard | enterprise-level aggregates |
| `/api/reseller/branding` | GET/PUT | `requireReseller` (`:37`/`:63`) | PUT `{whiteLabelEnabled?,accentColor?#hex,displayName?,supportEmail?}` | `{branding}` | `400` color/email · `500` raw | `/reseller` settings | merge-on-upsert |
| `/api/reseller/payout` | GET/PUT | `requireReseller` (`:23`/`:39`) | PUT `{payoutEmail?}` | `{payoutEmail}` | `400` invalid_email · `500` raw | `/reseller` settings | empty clears |
| `/api/reseller/enterprises` | POST | `requireReseller` (`:28`) | `{name,primaryDomain?,adminEmail,adminDisplayName,allocatedMinutes?,discountPct?,discountMonths?}` | `{enterprise,admin,invited,...}` | `400` · `403` reseller inactive · `500` | `/reseller` onboard client | creates inorganic org; `transfer_to_organization` RPC (debits reseller pool); `recordInvite`+`notifyResellerClientOnboarded`; listUsers-1000 |
| `/api/reseller/enterprises/[id]` | PATCH | `requireReseller` (`:23`) | `{name?,primaryDomain?,status?}` | `{ok,status?}` | `400` · `404` not_owned | `/reseller` client edit | suspend → `deactivate_enterprise` RPC + `banUsers` |
| `/api/reseller/enterprises/[id]/refill` | POST | `requireReseller` (`:18`) | `{amount>0}` | `{ok,enterprise,resellerRemaining}` | `400` · `404` not_owned | **ORPHAN (P1-13)** — scrapped minute-pool drawers | `transfer_to_organization` RPC |
| `/api/reseller/team-members` | GET | `requireReseller` (`:44`) | — | `{owner,team[]}` | `500` raw | `/reseller` team | listUsers perPage:200 (`:139`) — even smaller cap |
| `/api/reseller/team-members` | POST | `requireReseller` (`:107`) | `{email,fullName?,role?∈{manager,analyst,admin}}` | `{member}` | `400` email/is_owner · `409` other reseller/already · `500` | `/reseller` add teammate | links profile.reseller_id; role labels are **cosmetic (no RBAC)** (`:11`) |
| `/api/reseller/team-members/[id]` | DELETE | `requireReseller` (`:19`) | — | `{ok:true}` | `404` not_found · `500` raw | `/reseller` remove teammate | soft-delete status='removed' + unset profile.reseller_id |
| `/api/reseller/orgs` | GET | `requireReseller` (`:22`) | — | `{reseller,orgs[]}` (dept COUNT only) | `500` raw | **ORPHAN (P1-13)** — `/reseller/v2` `_drawers/` unimported | GDPR: no dept breakdown; dead helper `formatDepartment` (`:145`) never called |
| `/api/reseller/orgs/[id]/departments` | POST | `requireReseller` (`:24`) | `{name,adminEmail,adminDisplayName,allocatedMinutes?}` | `{department,adminUserId}` | `400` · `404` not_owned · `409` dup · `500` | **ORPHAN (P1-13)** | `transfer_to_department` RPC; listUsers-1000 |
| `/api/reseller/orgs/[id]/departments/[deptId]` | PATCH | `requireReseller` (`:19`) | `{name?,status?}` | `{department}` | `400` · `404` not in org/not_owned · `409` dup | **ORPHAN (P1-13)** | two-step ownership (dept→org→reseller) |
| `/api/reseller/orgs/[id]/departments/[deptId]/employees` | GET | `requireReseller` (`:22`) | — | `{department,memberCount,usage,usageSuppressed,...}` | `404` not_owned/not in org | **ORPHAN (P1-13)** | **byte-identical duplicate** of `[deptId]/route.ts` — returns aggregate, NOT an employee roster despite the path — see **P3-O01** |
| `/api/reseller/notifications` | GET/POST/DELETE | `requireReseller` (`:21`/`:58`/`:77`) | — | `{items,unread}`/`{ok}` | `500` raw | `/reseller` bell | **cookie `supabase` client** (per-user RLS); DELETE clears all |
| `/api/reseller/notifications/[id]` | PATCH | `requireReseller` (`:18`) | — | `{ok}` | `400` missing_id · `500` | `/reseller` mark read | cookie client |
| `/api/reseller/notification-prefs` | GET/PUT | `requireReseller` (`:34`/`:59`) | PUT `{newClientOnboarded?,clientLowMinutes?,payoutProcessed?}` | `{prefs}` | `500` raw | `/reseller` settings | merge-on-upsert; gates notification inserts elsewhere |

---

## Findings (NEW candidates — `P3-Oxx`)

**P3-O01 — Duplicate/misnamed reseller "employees" route returns no employees.**
`app/api/reseller/orgs/[id]/departments/[deptId]/employees/route.ts` is a
**byte-for-byte copy** of its parent `…/[deptId]/route.ts` (same header
docstring referencing `/api/reseller/orgs/:id/departments/:deptId`, same
aggregate-only GET body). It exports only GET and returns
`{department, memberCount, usage}` — there is **no employee listing** at the
`/employees` path. Either dead (the `/v2` drawers that would call it are
unimported per P1-13) or a copy-paste error that will mislead any future
consumer expecting a roster. Recommend delete or implement.

**P3-O02 — Raw Postgres/PostgREST error text returned to clients (broad).**
The org-management surface overwhelmingly returns `error.message` verbatim in
`{ error: … }` (e.g. `admin/orgs:40`, `admin/users:124`,
`enterprise/departments:51`, `reseller/dashboard:52`, and dozens more).
This leaks schema details, constraint names, and column names to the browser
(`SEC-API-PROXY-SCHEMA-1` family). Shaped/friendly errors exist only for
hand-picked cases (`23505`, `insufficient`, ownership). Recommend a single
error-mapping helper that logs raw + returns an opaque code.

**P3-O03 — `listUsers({ perPage: 1000 })` (and 200) caps every email-resolution
list.** Most GET list endpoints resolve emails by paging only the first 1000
auth users (`admin/orgs:99`, `admin/pods:54`, `admin/matching:198`,
`admin/engineers:83`, `enterprise/users:96`, `enterprise/export:102`,
`department/employees:64`, `reseller/enterprises:176`), and
`reseller/team-members:139` uses **perPage:200**. Past the cap, emails silently
render blank and POST-path "find existing user by email" lookups silently miss
(risking a duplicate invite or a wrong "not visible yet" 500). Only
`admin/users` GET is safe (RPC `user_meta_for_admin` on the page slice).
Recommend the RPC pattern everywhere, or a paged loop.

**P3-O04 — `enterprise/users` GET is unbounded (no pagination).** Unlike
`admin/users` (paginated via `lib/api/list-query`),
`app/api/enterprise/users/route.ts:55` selects **all** profiles in the org with
no `limit`/`range`, then resolves all via listUsers-1000 and filters in memory.
Large orgs get an unbounded response and the 1000-cap truncation of P3-O03.

**P3-O05 — Multi-step org/dept mutations are non-atomic (no transaction).**
Org DELETE (`admin/orgs/[id]:52`) detaches profiles → drops role grants →
deletes the org as separate awaited statements; dept DELETE
(`admin/orgs/[id]/departments/[deptId]:75`) releases minutes → detaches members
→ deletes. Create-flows roll back the org/dept on invite failure but **not** on
a later profile/role/transfer failure (those are soft-warned, e.g.
`admin/orgs:447`). A mid-sequence failure leaves orphaned grants, stranded
minutes, or detached-but-still-roled users. Recommend wrapping in an RPC/txn.

**P3-O06 — Wallet top-up idempotency has a double-credit race.**
`enterprise/wallet/topup/route.ts` reads `pi.metadata.relay_credited` (`:101`),
then credits the org (`:113`), then stamps `relay_credited='1'` (`:125`). The
check-credit-stamp sequence is not atomic and uses Stripe metadata (not a DB
lock or unique ledger row) as the guard. Two concurrent calls (or a webhook +
the client call) that both read `≠'1'` before either stamps will **credit the
minutes twice**. Recommend a DB-level idempotency key (unique on
`payment_intent_id`) inside the same update.

**P3-O07 — `wallet/activate-plan` activates a paid plan without verifying
payment.** `enterprise/wallet/activate-plan/route.ts:31` flips
`plan_tier`/`plan_status='active'` and rolls `current_period_end` forward based
**solely on the client-supplied `tier`**; `paymentIntentId` is optional and is
never re-fetched/verified against Stripe (the file's own header admits this
should be webhook-driven, `:11-14`). Any enterprise_admin — **or a
department_admin via P1-2** — can self-grant any paid tier (except the
contact-sales `enterprise` tier) for free. Currently ORPHAN (P1-13, no UI
caller) but live and reachable. Recommend gating on a verified `succeeded`
PaymentIntent (mirroring `topup`) or deleting the route.

**P3-O08 — `enterprise-request` rate limiter is in-memory (per-instance).**
`enterprise-request/route.ts:28-43` enforces **5 requests / 10 min per IP** via
a module-level `Map`. On serverless/multi-instance deploys the bucket isn't
shared, so effective limit scales with instance count and resets on cold start —
the public, unauthenticated, service-role-writing endpoint is weakly protected
against spam/enumeration. Honeypot (`website` field) and DB insert are present;
limiter should move to a shared store (e.g. Postgres/Upstash).

**P3-O09 — `department_admin` reaches org-wide `/api/enterprise/*` (impact note,
cross-ref P1-2).** Verified at `lib/enterprise-auth.ts:48-51`. Beyond the
generic P1-2 note, two endpoints are high-impact for a *department*-scoped role:
`/api/enterprise/export` (POST) lets a dept admin download the **entire org's**
members/sessions/usage CSV bundle, and `/api/enterprise/org` (PATCH) lets them
rename the org / change retention / change primary domain. Filed under P1-2;
recorded here for blast-radius visibility, not re-filed.

**P3-O10 (low) — Synthetic billing constant duplicated across 7 handlers.**
`CENTS_PER_MINUTE = 300` (and `LIST_CENTS_PER_MINUTE`) is re-declared in
`enterprise/me`, `enterprise/billing`, `enterprise/usage`,
`enterprise/sessions`, `enterprise/export`, `department/usage`,
`department/sessions`. All revenue/spend figures are fabricated from session
duration, not a billing ledger (each file's own TODO admits it). Cross-ref
P1-15 (synthetic billing); flagged as a correctness/consistency risk because
the rate is hardcoded in seven places that can drift.
