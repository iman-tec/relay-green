# Relay.green — Comprehensive Error Code Reference

A catalogue of every error a user/integration can hit across all panels and the
full flow. Errors come from four layers:

| Layer | Shape | Where |
|---|---|---|
| **Next API routes** | `{ "error": "<code>" }` + HTTP status | `app/api/**` |
| **Database RPCs** | Postgres exception text (bubbles up as 400/500) | `supabase/migrations`, called via RPC |
| **Edge functions** | `{ "error": "<message>" }` + HTTP status | `supabase/functions/**` (Zoom, Stripe, AI) |
| **Supabase Auth (GoTrue)** | `{ "error_code": "...", "msg": "..." }` | passed through verbatim by login routes |

## HTTP status codes in use
| Status | Meaning | Typical cause |
|---|---|---|
| 200 | OK (some flows return `{ok:false}` with 200) | soft-fail responses |
| 400 | Bad request | validation, bad input, business-rule reject |
| 401 | Unauthenticated | no/expired session |
| 402 | Payment required | wallet/credit exhausted |
| 403 | Forbidden | wrong role / wrong surface / not owner |
| 404 | Not found | missing record or out-of-scope id |
| 409 | Conflict | duplicate, cross-tenant collision |
| 429 | Rate limited | too many requests |
| 500 | Server error | unhandled / config missing |
| 502 | Upstream error | OpenAI/Zoom/Stripe upstream failure |
| 503 | Service unavailable | provider not configured |

---

## 1. Authentication & Login (all four surfaces)

### 1a. App auth endpoints (`/api/auth/*`, `/api/dev/*`, `/api/test/*`)
| Code | Status | Meaning |
|---|---|---|
| `invalid_email` | 400 | Email missing or fails format check |
| `invalid_input` | 400 | Email/code (or password) missing/not a string |
| `email_exists` | 409 | `prepare` first-time: email already registered |
| `email_not_found` | 404 | `prepare` forgot: email not registered |
| `rate_limited` | 429 | >6 `prepare` calls/min from one IP |
| `not_authenticated` | 401 | `set-password` called without an active session |
| `wrong_login_surface` | 403 | Role not allowed on this login surface (returns `allowed_surface`, `allowed_surface_url`) |
| `sign_in_unexpected_state` | 500 | Password sign-in returned no user object |
| `supabase_env_missing` | 500 | Supabase URL/keys absent on server |
| `demo_signin_failed` | 500 | Dev sign-in: demo account auth failed |
| `forbidden_in_production` | 403 | Dev sign-in route hit in production |
| `dev_only` / `forbidden` | 403 | Dev/test endpoint disabled outside dev |
| `unknown_role` | 400 | Dev sign-in `role` param not one of the demo roles |
| `set_session_failed` | 500 | Could not write the session cookies |
| `user_role_names_query_failed` | 500 | Role lookup failed during dev sign-in |
| `supabase_unconfigured` | 503 | Supabase client not configured |
| `missing tokens` | 400 | `/api/test/auth` called without access/refresh tokens |

### 1b. Supabase GoTrue pass-through (surfaced during OTP / password)
These are returned verbatim by `send-otp` / `verify-otp` / `signin-password`:
| Code / message | Meaning |
|---|---|
| `invalid_credentials` — "Invalid login credentials" | Wrong password **or** unknown user (intentionally indistinguishable) |
| "Token has expired or is invalid" / `otp_expired` | OTP code expired or already used |
| "Invalid token" | Wrong OTP code |
| `email_not_confirmed` | Account exists but email not confirmed |
| `over_email_send_rate_limit` / `over_request_rate_limit` | Supabase's own send/verify throttle hit |
| `user_already_exists` | Signup for an existing email |
| `signup_disabled` | `shouldCreateUser:false` and user doesn't exist |
| `weak_password` | Password fails Supabase strength rules |
| `same_password` | New password equals the old one |
| `validation_failed` | Malformed request to GoTrue |

---

## 2. Shared authorization gates (every protected panel)
Returned by the role gates (`requireEnterpriseAdmin`, `requireDepartmentAdmin`, `requireReseller`, admin/supervisor guards) before any panel logic runs:
| Code | Status | Meaning |
|---|---|---|
| `not_signed_in` | 401 | No authenticated session |
| `Not authenticated.` | 401 | Same, billing/engineer wording |
| `forbidden` | 403 | Authenticated but role not permitted here |
| `no_scope` | 403 | Caller has no partner/org/department scope (invite endpoint) |
| `no_organization` / `org missing` | 403 | Org admin has no `organization_id` on profile |
| `department missing` | 403 | Dept admin has no `department_id` |
| `no_pod` / `not_in_pod` | 403 | Supervisor not attached to a pod |
| `reseller row missing` | 403 | Reseller role with no reseller record |
| `service_role_not_configured` / `service_role_not_configured` | 500 | Service-role key missing server-side |
| `missing_id` | 400 | Required path/route id absent |
| `not_owned` | 403 | Caller doesn't own the target record (e.g. invite) |
| `not_found` | 404 | Target record missing or out of scope |

---

## 3. Customer flow — Room / Intake / Session

### Intake assistant (`/api/intake/turn`, `/api/assistant`)
| Code | Status | Meaning |
|---|---|---|
| `invalid_json` | 400 | Request body isn't valid JSON |
| `messages required` | 400 | No transcript supplied |
| `openai_not_configured` | 503 | `OPENAI_API_KEY` missing |
| `openai_upstream` | 502 | OpenAI call failed |
| `openai_parse` | 502 | OpenAI returned unparseable output |
| `empty_completion` | 502 | OpenAI returned nothing |
| `bad_completion_json` | 502 | Assistant JSON output malformed |

### Customer/session (`/api/customer`, `/api/me`, `/api/whoami`, session RPCs)
| Code | Meaning |
|---|---|
| `not_signed_in` | Customer not logged in |
| `NO_SESSION` / `SESSION_NOT_FOUND` | No active/!found session |
| `SESSION_ALREADY_CLAIMED` | Another engineer already took it |
| `SESSION_UNAVAILABLE` | Session not in a joinable state |
| `NOT_YOUR_SESSION` | Caller isn't a participant |
| `NO_ENTITLEMENT` | Customer has no free/paid entitlement to start |
| `NO_PAID_CREDIT` | Out of paid minutes (extend/continue) |
| `RECALL_CAP_REACHED` | Too many engineer recalls on one session |
| `OFFER_NOT_ACTIONABLE` | Match offer expired/already handled |
| `PROJECT_NOT_FOUND` / `PROJECT_ARCHIVED` | Project missing/closed |

---

## 4. Engineer / Staff flow

### `/api/engineer/ai-ask`, `/api/staff/*`
| Code | Status | Meaning |
|---|---|---|
| `Not signed in` / `not_signed_in` | 401 | No session |
| `Invalid JSON body` | 400 | Body not JSON |
| `Missing question` / `Missing sessionId` | 400 | Required field absent |
| `projectId and question required` | 400 | Staff project-QA missing inputs |
| `Session not found` | 404 | Session id invalid |
| `You don't have access to this session's project.` | 403 | Engineer not assigned to project |
| `Server is missing OPENAI_API_KEY` | 500 | AI key not configured |
| `Server is missing Supabase service credentials` | 500 | Service-role key absent |
| `forbidden` | 403 | Not a staff role |

### Engineer/session RPC exceptions
| Code | Meaning |
|---|---|
| `NOT_AN_ENGINEER` | Caller lacks engineer role |
| `NO_ENGINEER_PROFILE` | Engineer profile row missing |
| `NOT_ASSIGNED_TO_YOU` / `Not assigned to you` | Acting on a session not assigned to caller |
| `ENGINEER_BUSY` | Engineer already in a live session |
| `INVALID_PRESENCE_STATE` | Bad availability/presence value |
| `OFFER_NOT_ACTIONABLE` | Match offer expired/declined already |
| `SESSION_ALREADY_CLAIMED` | Claimed by another engineer |
| `DEVICE_NOT_FOUND` / `MISSING_FINGERPRINT` / `MISSING_DEVICE` | 3-device cap / device registration issues |
| `BODY_REQUIRED` / `MESSAGE_NOT_FOUND` | Chat message issues |
| `A message can carry at most 3 images` | Attachment cap |

---

## 5. Supervisor flow (`/api/supervisor/*`)
| Code | Status | Meaning |
|---|---|---|
| `not_signed_in` | 401 | No session |
| `forbidden` | 403 | Not a supervisor/super_admin |
| `no_pod` / `not_in_pod` | 403 | Supervisor has no pod / target outside pod |
| `missing deviceId` | 400 | Device action missing id |
| `service_role_not_configured` | 500 | Service-role key absent |

### Supervisor/escalation/booking RPC exceptions
| Code | Meaning |
|---|---|
| `NOT_A_SUPERVISOR` | Caller isn't a supervisor |
| `NOT_STAFF` | Caller isn't staff |
| `ESCALATION_NOT_OPEN` / `ESCALATION_NOT_OPEN_OR_FORBIDDEN` | Escalation already resolved / not yours |
| `BOOKING_NOT_FOUND` | Manual booking id invalid |
| `SLOT_UNAVAILABLE` / `SLOT_IN_PAST` / `INVALID_SLOT` | Booking slot problems |
| `ENGINEER_BUSY` | Target engineer occupied |
| `CANNOT_REQUEST_SELF` / `TARGET_NOT_ENGINEER` | Invalid assignment target |
| `PERMISSION_DENIED` | Action not allowed for caller |

---

## 6. Enterprise Admin panel (`/api/enterprise/*`)
| Code | Status | Meaning |
|---|---|---|
| `name_required` | 400 | Org name empty |
| `invalid_domain` / `domain_taken` | 400/409 | Primary domain invalid / already used |
| `invalid_retention` | 400 | Retention window not allowed |
| `nothing_to_update` / `Nothing to update.` | 400 | No changed fields |
| `A department with this name already exists.` / `Another department already uses this name.` | 409 | Duplicate department |
| `Department not found in your org.` / `Department doesn't belong to this organization.` | 404 | Out-of-scope dept |
| `Department is not active.` / `Department is suspended — reactivate it before adding members.` | 403 | Inactive dept |
| `Enterprise is not active.` | 403 | Org suspended |
| `Allocation must be non-negative.` | 400 | Negative minutes |
| `Allocation exceeds the department's remaining minutes (N).` | 400 | Over-allocation to dept |
| `Allocation exceeds the enterprise's remaining minutes (N).` | 400 | Over-allocation from org pool |
| `Need name and email.` / `Invalid email.` / `Invalid admin email.` | 400 | Member/admin invite validation |
| `Need email, displayName, and role ∈ {enterprise_admin, client}.` | 400 | Bad invite role |
| `This employee already belongs to another department.` | 409 | Member already placed |
| `This user already belongs to another organization. Ask a super admin to release them first.` / `User belongs to a different organization.` | 409 | Cross-org collision |
| `Enterprise admins can only be changed/removed by a super admin.` | 403 | Privilege boundary |
| `Can't remove yourself.` / `cannot_modify_self` / `cannot_erase_self` | 403 | Self-action blocked |
| `already_has_admin` | 409 | Dept already has an admin |
| `need_promote_or_invite` | 400 | Must promote existing or invite new |
| `Need tier ∈ starter/pro/business/enterprise.` / `Enterprise tier is contact-sales…` | 400 | Plan activation issues |
| `Bundle has no minutes.` / `Unknown bundle.` | 400 | Wallet top-up bundle invalid |
| `Missing or invalid paymentIntentId.` / `Payment belongs to another organization.` / `Payment is not a minute bundle.` / `Payment not completed (status: …).` | 400 | Wallet checkout/credit issues |
| `Stripe key not configured for this build.` | 500 | Stripe env missing |
| `Couldn't generate a unique code after 5 tries.` | 500 | Enterprise/dept code generation exhausted |
| `client role not seeded` / `department_admin role not seeded` / `role_not_seeded` | 500 | Roles lookup table missing rows |

---

## 7. Department Admin panel (`/api/department/*`)
| Code | Status | Meaning |
|---|---|---|
| `Department name is required.` / `Another department already uses this name.` | 400/409 | Dept identity |
| `Department is not active.` | 403 | Inactive dept |
| `Department admins can't reassign employees.` | 403 | Boundary: reassignment is enterprise-level |
| `Department admins can't reset employee passwords.` | 403 | Boundary: password resets restricted |
| `Need name and email.` / `Invalid email.` | 400 | Add-employee validation |
| `No valid recipients.` / `Max 500 recipients per batch.` | 400 | Bulk-invite limits |
| `Allocation must be non-negative.` / `Allocation exceeds the department's remaining minutes (N).` | 400 | Minute allocation |
| `This employee already belongs to another department.` | 409 | Member already placed |
| `amount must be > 0` | 400 | Refill amount invalid |
| `invalid status` | 400 | Bad status transition |
| `missing_id` / `org missing` / `department missing` | 400/403 | Scope/id problems |

---

## 8. Channel Partner / Reseller panel (`/api/reseller/*`)
| Code | Status | Meaning |
|---|---|---|
| `Reseller not found.` / `Reseller is not active.` | 404/403 | Reseller record/state |
| `Org not found.` / `Department not found in this org.` | 404 | Out-of-scope target |
| `Need name, adminEmail, and adminDisplayName.` / `Department name, admin name and admin email are required.` | 400 | Onboarding validation |
| `Invalid admin email.` / `invalid_email` | 400 | Email validation |
| `Allocation must be non-negative.` | 400 | Negative minutes |
| `Allocation exceeds your remaining minutes (N).` / `Allocation exceeds the enterprise's remaining minutes (N).` | 400 | Over-allocation |
| `already_in_team` | 409 | Team member already present |
| `is_owner` | 403 | Can't act on the reseller owner |
| `user_in_other_reseller` | 409 | User bound to another partner |
| `invalid_accent_color` / `invalid_support_email` | 400 | Branding settings validation |
| `enterprise_admin role not seeded` / `department_admin role not seeded` | 500 | Roles missing |

---

## 9. Super Admin panel (`/api/admin/*`)
| Code | Status | Meaning |
|---|---|---|
| `forbidden` / `not_signed_in` | 403/401 | Not a super admin |
| `Org not found.` / `Organization not found.` | 404 | Org id invalid |
| `Reseller not found.` / `Reseller is suspended.` | 404/403 | Reseller state |
| `A reseller with this email already exists.` / `Another reseller already uses this email.` | 409 | Duplicate reseller |
| `The Channel Partner's pool is short — top up the partner first.` | 400 | Insufficient partner pool |
| `Commission must be 0–100.` / `Commission must be between 0 and 100.` | 400 | Commission range |
| `Pod name is required.` / `Pod name cannot be empty.` | 400 | Pod identity |
| `Invalid pod role. Must be 'supervisor' or 'engineer'.` / `Need userId and podRole…` | 400 | Pod membership |
| `Member not found in this pod.` / `This user is already in {pod}. Remove them first.` | 404/409 | Pod membership conflicts |
| `Role must be engineer, supervisor, or super_admin.` | 400 | Invalid role assignment |
| `Status must be ACTIVE or DEACTIVATED.` / `invalid status` | 400 | Status value |
| `Super Admins can't be deleted from the admin UI.` / `You can't delete/edit your own super-admin record…` | 403 | Self/super-admin protections |
| `Couldn't allocate a unique slug.` | 500 | Slug generation exhausted |
| `…role not seeded` / `role_not_seeded` | 500 | Roles table missing rows |
| `Admin/Member/User invited but auth row not (yet) visible — try again…` | 500 | Invite race (auth row lag) |

---

## 10. Billing, Payments & Contracts

### `/api/billing/*`
| Code | Status | Meaning |
|---|---|---|
| `Not authenticated.` | 401 | No session |
| `Stripe is not configured on this environment.` | 500 | Stripe env missing |
| `Missing or invalid payment method id.` | 400 | Bad PM id |
| `Not your payment method.` | 403 | PM belongs to another user |
| `No Stripe customer.` | 400 | No Stripe customer mapping |

### `/api/contract/*`
| Code | Status | Meaning |
|---|---|---|
| `Quote not found.` / `Not your quote.` | 404/403 | Quote scope |
| `Quote isn't open.` / `This quote isn't open for payment.` | 400 | Quote state |
| `Quote has no amount.` / `Missing quoteId.` / `Missing quoteId or paymentIntentId.` | 400 | Inputs |
| `Payment doesn't match this contract.` / `Payment not completed (status).` | 400 | Payment validation |
| `Stripe key not configured.` | 500 | Stripe env missing |

### Payment/credit RPCs
| Code | Meaning |
|---|---|
| `NO_PAID_CREDIT` / `NO_ENTITLEMENT` | Out of minutes |
| `INVALID_AMOUNT` / `INVALID_MINUTES` | Bad amount |
| `department/enterprise/reseller has insufficient remaining_minutes` | Pool exhausted during transfer |
| `amount must be positive` | Non-positive transfer |

---

## 11. Invites & onboarding (`/api/invite/*`)
| Code | Status | Meaning |
|---|---|---|
| `not_signed_in` | 401 | No session |
| `no_scope` | 403 | Caller has no invite scope |
| `not_owned` | 403 | Invite belongs to someone else |
| `not_found` | 404 | Invite id invalid |
| `Already accepted.` | 400 | Re-send of an accepted invite |
| `No valid recipients.` / `Max 500 recipients per batch.` | 400 | Batch validation |
| `service_role_not_configured` | 500 | Service-role key absent |

---

## 12. Marketing / Contact forms (`/api/contact`, `/api/enterprise-request`)
| Code | Status | Meaning |
|---|---|---|
| `invalid` / `invalid_body` / `invalid_json` | 400 | Form validation |
| `rate_limited` | 429 | Spam throttle / honeypot |
| `send_failed` | 500 | Email send failed |
| `not_configured` | 503 | Contact backend not configured |
| `persist_failed` | 500 | Could not store the request |

---

## 13. Edge functions (Zoom / Stripe / AI)
| Message | Function area | Meaning |
|---|---|---|
| `NOT_AUTHENTICATED` / `Unauthorized` | all | No/invalid JWT |
| `NOT_AUTHORIZED` / `Forbidden — not an enterprise admin.` / `Only staff can schedule Zoom meetings` | all | Role check failed |
| `Not a session participant` / `Not assigned to you` | Zoom/session | Caller not on the session |
| `session_id required` / `guest_call_id required` / `thread_id required` / `intake_id required` / `project_id required` / `customer_id required` / `request_id…` / `meetingNumber required` | all | Missing input |
| `Session not found` / `SESSION_NOT_FOUND` / `thread not found` / `intake not found` / `Project not found` / `Request not found` | all | Record missing |
| `ZOOM_SDK_KEY/SECRET not configured` / `ZOOM_VIDEO_SDK_KEY/SECRET not configured` | Zoom | Zoom creds missing |
| `Zoom create failed` / `Couldn't end Zoom meeting` | Zoom | Zoom API error |
| `STRIPE key not configured` / `STRIPE key not configured on the project` | Stripe | Stripe creds missing |
| `Stripe price not found for package` / `Package not found` / `Missing package_code or return_url` | Stripe | Checkout config |
| `Amount too low` / `Invalid plan` / `Invalid tier (enterprise tier is contact-sales…)` | Stripe | Checkout validation |
| `PaymentIntent does not belong to this user` / `PaymentIntent missing Relay metadata` / `Invalid payment_intent_id` | Stripe | Credit validation |
| `GROQ_API_KEY not configured` | AI (session health) | AI key missing |
| `Invalid email` / `Name required` / `Invalid start_at` / `Missing request_id, topic, or start_at` | misc | Input validation |

---

## 14. Database RPC exceptions (full reference)
Raised by `SECURITY DEFINER` functions; surface as 400/500 with the text.

**Auth / roles:** `NOT_AUTHENTICATED`, `NOT_AUTHORIZED`, `PERMISSION_DENIED`, `PERMISSION_DENIED: only super_admin may grant/revoke super_admin`, `NOT_AN_ADMIN`, `NOT_AN_ENGINEER`, `NOT_A_SUPERVISOR`, `NOT_STAFF`, `INVALID_ROLE: <x>`, `UNKNOWN_ROLE: <x>`, `SUPER_ADMIN_ALREADY_EXISTS`, `TARGET_NOT_ENGINEER`.

**Sessions:** `SESSION_NOT_FOUND`, `NO_SESSION`, `SESSION_ALREADY_CLAIMED`, `SESSION_UNAVAILABLE`, `NOT_YOUR_SESSION`, `NOT_ASSIGNED_TO_YOU`, `INVALID_STATE: <x>`, `RECALL_CAP_REACHED`, `OFFER_NOT_ACTIONABLE`, `ENGINEER_BUSY`.

**Escalations / bookings / requests:** `ESCALATION_NOT_OPEN`, `ESCALATION_NOT_OPEN_OR_FORBIDDEN`, `BOOKING_NOT_FOUND`, `SLOT_UNAVAILABLE`, `SLOT_IN_PAST`, `INVALID_SLOT`, `REQUEST_NOT_FOUND`, `REQUEST_NOT_OPEN`, `REQUEST_NOT_PENDING`, `CANNOT_REQUEST_SELF`.

**Quotes / projects:** `QUOTE_NOT_OPEN`, `QUOTE_NOT_PENDING`, `QUOTE_NOT_QUOTED`, `QUOTE_NOT_ACTIONABLE`, `PROJECT_NOT_FOUND`, `PROJECT_ARCHIVED`, `INVALID_CONTRACT_TYPE`.

**Minutes / billing:** `INVALID_AMOUNT`, `INVALID_MINUTES`, `amount must be positive`, `NO_ENTITLEMENT`, `NO_PAID_CREDIT`, `department/enterprise/reseller has insufficient remaining_minutes`, `department/organization/reseller not found: <id>`, `profile has no department: <id>`, `profile not found: <id>`.

**Intake / messaging:** `INTAKE_NOT_FOUND`, `intake <id> not found`, `not authorized to append to intake <id>`, `MESSAGE_NOT_FOUND`, `BODY_REQUIRED`, `A message can carry at most 3 images`, `role must be assistant or user, got <x>`.

**Devices / availability:** `DEVICE_NOT_FOUND`, `MISSING_FINGERPRINT`, `MISSING_ENGINEER`, `INVALID_PRESENCE_STATE`, `INVALID_WEEKDAY`, `DATE_IN_PAST`, `MISSING_DATE`, `MISSING_REASON`, `INVALID_NAME`, `INVALID_STATUS`, `INVALID_KIND`, `EXPECTED_ARRAY(S)`, `NEXT_STEPS_MUST_BE_ARRAY`.

**Code generation / seed integrity:** `department_code/reseller_code/enterprise_code generation exhausted retries`, `…backfill exhausted`, `roles lookup is missing expected rows — apply roles migrations first`, `RATE_LIMITED`.

---

## 15. System / configuration errors
| Code | Meaning |
|---|---|
| `supabase_env_missing` / `supabase env missing` / `supabase_url_missing` | Supabase URL/keys not set |
| `supabase_unconfigured` | Supabase client unavailable |
| `service_role_not_configured` | Service-role key missing |
| `openai_not_configured` / `Server is missing OPENAI_API_KEY` | OpenAI key missing |
| `GROQ_API_KEY not configured` | Groq (session-health) key missing |
| `STRIPE key not configured` / `Stripe is not configured…` | Stripe key missing |
| `ZOOM_SDK_KEY/SECRET not configured` / `ZOOM_VIDEO_SDK_KEY/SECRET…` | Zoom creds missing |
| `unauthorized` (cron) | Cron called without `CRON_SECRET` bearer |
