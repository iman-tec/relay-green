# API routes — core half (~54 handlers)

Phase 3 audit. Application source is read-only. Literal secrets/credentials
redacted. Cites `file:line`. Findings (NEW candidates `P3-Cxx`) at the bottom;
known issues cross-referenced, not re-filed.

Conventions used in the tables:

- **Auth guard** — the line(s) that establish identity + authorization. "cookie
  `getUser`" = `lib/supabase/server` SSR client (RLS-bound); "service-role" =
  `@supabase/supabase-js` admin client constructed from
  `SUPABASE_SERVICE_ROLE_KEY` (RLS-bypassing); "role gate" = post-auth
  `user_role_names` check.
- **SR** in Notes = uses the service-role key (RLS bypass).

---

## 1. `api/auth/*` + `app/auth/*` (auth surface)

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/prepare` | POST | **none (public)**; in-memory IP rate-limit `prepare/route.ts:32-42,49-51` | `{ email, purpose?: "first-time"\|"forgot" }` | `{ ok: true }` (always neutral) | 400 `{error:"invalid_email"}`; 429 `{error:"rate_limited"}`; 500 `{error:"supabase_env_missing"}` | login / staff-login first-time + forgot flows | **SR** (`createUser`/`listUsers`). Enumeration-safe by design (SEC-API-ENUM-1, comment `:13-22`). Rate limiter is per-instance, 6/IP/60s — see P3-C11. Provisioning errors swallowed `:108-118`. |
| `/api/auth/send-otp` | POST | **none (public)**; cookie client only `send-otp/route.ts:36` | `{ email }` | `{ ok: true }` (always) | 400 `{error:"invalid_email"}` | login forms (server-side OTP proxy) | `signInWithOtp` error suppressed + logged `:42-47` (enumeration-safe). No rate limit on this route itself. |
| `/api/auth/verify-otp` | POST | cookie `verifyOtp` `verify-otp/route.ts:87-91`; surface role-gate `:106-127` | `{ email, code, surface?\|mode?, purpose? }` | `{ ok:true, next }` | 400 `{error:"invalid_input"}` / `{error:<supabase msg verbatim>}` `:96`; 403 `{error:"wrong_login_surface",allowed_surface,allowed_surface_url,allowed_roles_here}` `:116-124` | `/login`, `/staff/login` OTP submit | **SR** for `user_has_password` RPC `:149-155` (JWT-propagation workaround). Surface default = `customer` on missing param `:56-63` (fail-safe). Emits `?mode=` to `/set-password` `:143,162` — **mismatch with signin-password's `?surface=`** (P1-8 cross-ref). Supabase error message passed through verbatim `:96`. |
| `/api/auth/set-password` | POST | cookie `getUser` (must have active session) `set-password/route.ts:38-43` | `{ password, mode? }` | `{ ok:true, next }` | 400 `{error:PASSWORD_RULES_MESSAGE}` / `{error:<supabase msg>}`; 401 `{error:"not_authenticated"}` | `/set-password` | **SR** writes `app_metadata.password_set=true` `:61-69` (trustworthy flag; admin-only). Reads `mode` (legacy) — divert URL param mismatch vs verify-otp/signin-password (P1-8 cross-ref). |
| `/api/auth/signin-password` | POST | cookie `signInWithPassword` `signin-password/route.ts:69-72`; surface role-gate `:99-111` | `{ email, password, surface?\|mode? }` | `{ ok:true, next }` | 400 `{error:"invalid_input"}` / `{error:<supabase msg>}`; 403 `wrong_login_surface` (+ session rolled back `:100`); 500 `sign_in_unexpected_state` | `/login`, `/staff/login` password submit | Sets Supabase auth cookies on success. First-time temp-password users diverted to `/set-password?surface=…` `:125-128` — emits **`surface=`** (verify-otp emits `mode=`; P1-8 cross-ref). Surface default `customer` `:61-64`. |
| `/auth/callback` | GET | cookie `exchangeCodeForSession` `callback/route.ts:22` | `?code` (PKCE) | 302 redirect via `routeAfterAuth` | 302 `/login?error=auth_callback_no_code` / `auth_callback_failed` | Supabase magic-link / OAuth redirect | Legacy `?code` PKCE flow. Errors logged not surfaced. |
| `/auth/confirm` | GET | cookie `verifyOtp({type,token_hash})` `confirm/route.ts:43` | `?token_hash&type` | 302 redirect via `routeAfterAuth` | 302 `/login?error=auth_confirm_bad_params` / `auth_confirm_failed` | Supabase invite + recovery email links | `type` validated against allow-set `:22-29,36`. |

---

## 2. `api/supervisor/*` (13) — pod-scoped consoles

All read the cookie `getUser` then a role gate, then build a **service-role**
admin client and scope to the caller's pod (`pod_members.pod_role='supervisor'`).
Gate pattern A = `super_admin EXCLUDED` (`roles.includes(super_admin) || !roles.includes(supervisor)` → 403); Gate pattern B = `supervisor OR super_admin allowed`. The inconsistency is itself flagged (P3-C05).

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/supervisor/act-now` | GET | gate A `act-now/route.ts:33-40` | — | `{ estimationRequests[], callbackQueue[], escalations[] }` | 401 `not_signed_in`; 403 `forbidden`; 500 `service_role_not_configured` | `/supervise` left rail | **SR**. Pod-scoped callbacks + escalations; estimation requests are **platform-wide** (all pending quotes `:80-88`, not pod-filtered). Joins live-session sentiment. |
| `/api/supervisor/bookings` | GET | gate A `bookings/route.ts:33-35` | — | `{ bookings[] }` | 401/403/500 as above | `/supervise` bookings tab | **SR**, pod engineers only. |
| `/api/supervisor/chat-search` | GET | gate B `chat-search/route.ts:30-32` | `?projectId&q` | `{ results[] }` | 401/403/500; empty `{results:[]}` when `q<2` | supervisor project chat search | **SR**. ILIKE wildcards escaped `:58`. **No check that the project belongs to the caller's pod** — any supervisor can search any project's messages by id (cross-pod read). See P3-C05. |
| `/api/supervisor/coverage` | GET | gate A `coverage/route.ts:44-46` | `?days=1..31` | `{ days, openHour, closeHour, engineerCount, calendar[] }` | 401/403/500 | `/supervise` coverage planner | **SR**, pod-scoped. UTC-only v1. |
| `/api/supervisor/covering` | GET | gate B `covering/route.ts:29-31` | — | `{ supervisors:[{name,isOnline}] }` | 401/403/500 | "who's covering" widget | **SR**. Lists **all** supervisors platform-wide (not pod-scoped) `:44-51`. |
| `/api/supervisor/escalation-themes` | GET | gate A `escalation-themes/route.ts:33-35` | — | `{ state, sampleSize, themes[] }` | 401/403/500 | escalation-themes card | **SR** + **OpenAI** (`OPENAI_API_KEY`, key stays server-side). LLM clusters pod escalation notes `:106-127`. Degrades to `insufficient`/`unavailable`. |
| `/api/supervisor/inbox` | GET | gate B `inbox/route.ts:41-43` | — | `{ sessions[] }` (≤400) | 401/403/500 `{error:error.message}` `:64` | `/supervise` inbox | **SR**. `guest_calls.select("*")` **all-platform** by design `:57-61` (RLS bypassed intentionally). |
| `/api/supervisor/leave-requests` | GET | gate A `leave-requests/route.ts:36-38` | — | `{ requests[] }` (pending+approved engineer leave) | 401/403/500 | `/supervise` leave tab | **SR**, pod-scoped, `requester_role='engineer'`. |
| `/api/supervisor/matching` | GET | **gate = supervisor only, super_admin NOT excluded** `matching/route.ts:64-66` | — | `{ pod, rows:MatchingRow[] }` | 401/403/500 `{error:pendRes.error.message}` `:137` | `/supervise` matching board | **SR**. Different gate shape than siblings (P3-C05). Surfaces engineer **emails** via `listUsers` `:268-269`. Pod-scoped offers + stranded sessions. |
| `/api/supervisor/payouts` | GET | gate A `payouts/route.ts:31-33` | — | `{ total, engineers[] }` | 401/403/500 | `/supervise` payouts | **SR**, pod-scoped earnings view. |
| `/api/supervisor/team` | GET | gate A `team/route.ts:39-41` | — | `{ pod, engineers[] }` | 401/403/500 | `/supervise` team roster | **SR**. Surfaces engineer **emails** `:118-121` + live sentiment + 30d KPIs, pod-scoped. |
| `/api/supervisor/engineer/[id]` | GET | gate A + pod-membership check `engineer/[id]/route.ts:37-39,62-70` | path `id` | `{ engineer, escalations[], availability, devices[], recentSessions[] }` | 401/403 `forbidden`/`no_pod`/`not_in_pod`; 500 | `/supervise` engineer drill-in | **SR**. IDOR-protected: verifies engineer is in caller's pod `:62-70`. Returns device list (label/last-seen). |
| `/api/supervisor/engineer/[id]` | DELETE | gate A + pod check `engineer/[id]/route.ts:268-299` | path `id`, `?deviceId` | `{ ok:true }` | 400 `missing deviceId`; 401/403; 500 | force-kick engineer device | **SR**. Delete scoped to `id=deviceId AND user_id=engineerId` `:302-306`. F3 cap-slot free. |

---

## 3. `api/staff/*` (5) + `api/engineer/*` (3)

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/staff/assignable-engineers` | GET | cookie `getUser` + admin/supervisor role gate `assignable-engineers/route.ts:45-63` | — | `{ engineers:AssignableEngineer[] }` | 401 `not_signed_in`; 403 `forbidden`; 500 `service_role_not_configured` | "Assign manually" picker | **SR**. Comment claims supervisors are pod-scoped `:6-8` but code returns **ALL** engineers platform-wide to any supervisor `:83-91` incl. **email** `:129-133`. Over-broad PII. See P3-C06. |
| `/api/staff/broadcast-match` | POST | cookie `getUser` + STAFF_ROLES gate `broadcast-match/route.ts:57-75` | `{ intakeId }` | `{ offered }` / `{offered:0,...}` / `{offered:0,reassignNeeded,debug}` | 400 `missing_intake_id`; 401; 403 `forbidden`; 404 `intake_not_found`; 500 | engineer decline / supervisor "broadcast to all" | **SR**. Fans out pending offers to all eligible online engineers. Eligibility = heartbeat-fresh OR is_available `:184-191`. Inserts offer rows directly. |
| `/api/staff/index-session` | POST | **shared-secret header** `x-index-secret`===`RAG_INDEX_SECRET` `index-session/route.ts:29-33` | `{ session_id }`\|`{ project_id }`\|`{ reconcile, lookbackMinutes? }` | `{ ok, ... }` | 401 `unauthorized`; 400 `session_id, project_id, or reconcile required`; 500 `{error:String(e)}` `:107` | server-to-server (summarize-* edge fns) | **SR** (`ragServiceClient`). Not user-facing. 500 echoes raw `String(e)` `:107` — low-severity error detail. `maxDuration=300`. |
| `/api/staff/project-qa` | POST | cookie `getUser` **only — no project-access check** `project-qa/route.ts:152-157` | `{ projectId, question, history?, threadId? }` | `{ text, model, fallback?, threadId }` | 400; 401 `Not authenticated.` | engineer in-room project AI box | **SR** (`ragServiceClient`) for history writes `:181`. Structured reads use cookie/RLS, but **RAG `search()` over Qdrant is filtered only by client-supplied `project_id` and is NOT RLS-bound** `:370-371` → any signed-in user can read any project's indexed transcripts/docs. **IDOR / cross-tenant leak — P3-C04.** + **OpenAI**. |
| `/api/staff/quote-requests` | GET | cookie `getUser` + engineer/supervisor/super_admin gate `quote-requests/route.ts:34-40` | — | `{ requests[] }` | 401; 403 `forbidden`; 500 | engineer quote/contract queue | **SR**. Returns **all-platform** open quote requests (no pod/org scoping) `:57-64`. |
| `/api/engineer/ai-ask` | POST | cookie `getUser` `ai-ask/route.ts:86-90` + claimed_by OR supervisor-tier role `:111-132` | `{ sessionId, question }` or useChat `{messages}` | text/event-stream (AI SDK) | 400; 401 `Not signed in`; 403; 404 `Session not found`; 500 `{error:sessionErr.message}`; 503 missing creds/key | engineer live-session AI bar | **SR** for cross-RLS context + placeholder insert `:158`. **OpenAI** stream (gpt-4o). Author-check mirrors RLS `:111-126`. |
| `/api/engineer/customer-draft` | POST | cookie `getUser` + claimed_by OR supervisor/super_admin/admin `customer-draft/route.ts:51-86` | `{ sessionId }` | `{ text }` / `{ text:null }` | 400; 401; 403; 404; 500; 503 missing creds | engineer session open (prep handoff) | **SR** reads + **deletes** `customer_session_drafts` (consume) `:108-134`. Replaces a buggy RPC. |
| `/api/engineer/notifications` | GET/POST/DELETE | cookie `getUser` only `notifications/route.ts:30-34,69-73,90-94` | — | `{ items, unread }` (GET) / `{ ok:true }` | 401; 500 `{error:error.message}` | dashboard bell | Per-user via RLS (`user_id=auth.uid()`). Scoped to fixed kinds `:20-26`. No SR. |
| `/api/engineer/notifications/[id]` | PATCH | cookie `getUser` + `eq(user_id)` defence `notifications/[id]/route.ts:19-32` | path `id` | `{ ok:true }` | 400 `missing_id`; 401; 500 | bell mark-read | RLS + explicit user filter. No SR. |

---

## 4. Customer-facing core

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/me` | GET | cookie `getUser` `me/route.ts:19-22` | — | `{ userId, email, roles, role }` | 401 `{user:null}` | Electron shell post-signin | Classifies staff vs customer. No SR. |
| `/api/whoami` | GET | cookie `getUser` `whoami/route.ts:21-28` | — | `{ ok, user, profile, roles }` | 401 `{ok:false,error:"not_signed_in"}` | dev diagnostic (comment: "strip in production") | Self-only via RLS. No SR. Not env-gated — left enabled in prod. |
| `/api/customer/me-employment` | GET | cookie `getUser` `me-employment/route.ts:30-34` | — | `{isEmployee:false}` \| `{isEmployee:true,enterpriseName,departmentName,…minutes}` | 401; 500 `{error:error.message}` | `/room` employee info strip | RLS-bound self read. By spec never returns reseller info `:11-13`. No SR. |
| `/api/intake/turn` | POST | **none (public)** `intake/turn/route.ts:100` (no auth) | `{ messages[], context, profile?, resumeContext? }` | `{ body, quickReplies, extractedFields, intakeDone }` | 400; 502 (upstream); 503 `openai_not_configured` | customer IntakeAssistant chat | **OpenAI proxy, unauthenticated, no rate limit** → token-cost abuse / DoS. Upstream errors NOT leaked (logged only `:163,172,195`). See P3-C02. |
| `/api/match/directed` | POST | cookie `getUser` `directed/route.ts:49-51`; ownership + prior-relationship checks `:88-118` | `{ intakeId, engineerId }` | `{ offered:1, engineerId }` / `{offered:0,...}` | 400 `missing_params`/`not_an_engineer`; 401; 403 `forbidden`/`no_prior_relationship`; 404 `intake_not_found`; 500 | customer "Connect with <alias>" | **SR**. Tight authz: caller must own intake `:88` + have a prior claimed session with target `:103-118`. |
| `/api/match/presence` | POST | cookie `getUser` `presence/route.ts:45-48` | `{ engineerIds[] }` | `{ presence:{id:"available"\|"busy"\|"offline"} }` | 401; 500 `service_role_not_configured` | customer "Pick your engineer" modal poll | **SR** (customer can't read engineer presence under RLS). Returns only coarse status, no PII. |
| `/api/online-engineers` | GET | **none (public)** `online-engineers/route.ts:59` (no `getUser`) | `?technologies&need` | `{ engineer:{id,pseudoName,initials,technologies,matchedTechnologies,experienceYears,experienceLabel,etaSeconds} }` | 200 `{engineer:null}` on any failure | public Try-RELAY funnel "Match Found" card | **SR read, unauthenticated.** Exposes a real engineer's `user_id`, pseudonym, tech tags, experience + live availability to anonymous callers; enumerable. Full name redacted by design but `id` leaks. See P3-C03. |
| `/api/contract/accept` | POST | cookie `getUser` + ownership `accept/route.ts:25-27,54-55` | `{ quoteId }` | `{ ok:true }` / `{ok,alreadyCommitted}` | 400 `Missing quoteId.`; 401; 403 `Not your quote.`; 404; 409 `Quote isn't open.`; 500 | quote viewer "Accept (no pay)" | **SR**. Commits without Stripe. Flips `projects.contract_type` `:72-77`. |
| `/api/contract/decline` | POST | cookie `getUser` + ownership `decline/route.ts:29-31,61-62` | `{ quoteId, note(required) }` | `{ ok:true }` / `{ok,alreadyDeclined}` | 400 `Missing quoteId.`/reason-required; 401; 403; 404; 409; 500 | quote viewer decline | **SR**. Mandatory reason `:40-45`. |
| `/api/contract/delete` | POST | cookie `getUser` + ownership `delete/route.ts:29-31,53-54` | `{ quoteId, reason? }` | `{ ok:true }` / `{ok,alreadyGone}` | 400; 401; 403; 409 `active contract can't be deleted`; 500 | quote viewer remove | **SR**. Deletes row; reason logged to server console only `:64-67`. |
| `/api/contract/checkout` | POST | cookie `getUser` + ownership `checkout/route.ts:23-25,61-62` | `{ quoteId }` | `{ clientSecret, paymentIntentId, amountCents }` | 400 `Missing quoteId.`/`Quote has no amount.`; 401; 403; 404; 409 `not open for payment`; 500 `Stripe key not configured.` | quote viewer pay | **SR** + **Stripe** PaymentIntent (EUR). Metadata binds quote+user `:84-87`. |
| `/api/contract/commit` | POST | cookie `getUser` + ownership `commit/route.ts:27-29,65-66` | `{ quoteId, paymentIntentId }` (pi_ prefix) | `{ ok:true }` / `{ok,alreadyCommitted}` | 400; 401; 403; 404; 402 `Payment not completed`; 409; 500 | post-payment commit | **SR** + **Stripe** verify. Re-checks PI status + metadata match `:76-90` before commit. Flips contract_type. |

---

## 5. Billing (2)

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/billing/payment-methods` | GET | cookie `getUser` via `getStripeCustomerId` `payment-methods/route.ts:88-95` | — | `{ paymentMethods[] }` | 401 `Not authenticated.`; 500 `Stripe is not configured.`; 502 (Stripe error msg) | `/room` billing | **Stripe**. Stripe customer id from `customer_entitlements` (cookie/RLS read). Empty list (not 404) when no card. 502 body echoes Stripe error message `:148-151`. |
| `/api/billing/payment-methods` | DELETE | cookie `getUser` + PM-ownership check `payment-methods/route.ts:184-194` | `?id=pm_…` | `{ ok:true }` | 400 invalid id; 401; 403 `Not your payment method.`; 404 `No Stripe customer.`; 502 | billing remove card | **Stripe**. Verifies `pm.customer===stripeCustomerId` before detach `:189` (blocks pm_-id enumeration). |
| `/api/billing/payment-methods/setup-intent` | POST | cookie `getUser` `setup-intent/route.ts:74-77` | — | `{ clientSecret, customerId }` | 401 `Not authenticated.`; 500 `Stripe is not configured.`; 502 | billing add card | **Stripe**. Lazy-creates Stripe Customer + persists to `customer_entitlements` `:94-113`. 502 echoes Stripe error. |

---

## 6. Misc (8)

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | UI caller | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/assistant` | POST | **none (public)** `assistant/route.ts:104` (no auth) | `{ mode, profile?, funnel?, resume?, messages? }` | `{ text, model, fallback? }` | always 200 (heuristic fallback on `no_key`/`openai_error`) | RoomClient chat / IntakeAssistant | **OpenAI proxy, unauthenticated, no rate limit** → cost abuse / DoS. See P3-C01. |
| `/api/contact` | POST | **none (public)**; honeypot + per-IP rate limit `contact/route.ts:191-193,209-211` | `{ name,email,company,topic,message,marketingConsent,website(honeypot) }` | `{ ok:true }` | 400 `invalid_json`/`invalid_body`/`invalid`; 429 `rate_limited`; 500 `send_failed` | marketing forms | **SR** insert to `enquiries` `:94-112` + **Resend** email `:115-163`. Rate limit 5/10min in-memory per instance `:48-50` (P3-C11). Honeypot → silent 200. |
| `/api/channel-partners` | GET | **none (public)** `channel-partners/route.ts:16` | — | `{ channelPartners:[{id,name}] }` | 200 `{channelPartners:[]}` on any error/misconfig | enterprise inquiry form picker | **SR** (resellers RLS hides rows). Returns only id+name by design `:24-29`. Public exposure intentional + minimal. |
| `/api/internal/compensation` | GET | `requireEnterpriseAdmin()` `compensation/route.ts:32-34` | — | `{ currency, staff[] }` | gate-driven (`{error,status}`) | enterprise/dept comp roster | **SR** (helper returns admin client). Org-scoped via gate's `orgId`. Surfaces staff **emails** + salaries `:55-71` (in-org, admin-gated — OK). |
| `/api/internal/compensation` | PUT | `requireEnterpriseAdmin()` + target-in-org check `compensation/route.ts:137-139,158-168` | `{ userId, monthlyCents }` | `{ ok:true }` | 400 invalid; 403 `user_not_in_org`; 500 | comp edit | **SR**. Verifies target's `organization_id===orgId` `:163-168` before upsert. |
| `/api/internal/feedback` | GET | `requireEnterpriseAdmin()` `feedback/route.ts:17-19` | `?limit=1..200` | `{ feedback[] }` | gate-driven | org feedback feed | **SR**. Org-scoped via engineer membership `:29-41`. |
| `/api/invite` | GET/POST | cookie `getUser` + role→scope `resolve()` `invite/route.ts:33-87` | POST `{ recipients:[{email,name?,role?,departmentId?}] }` | GET `{ invites[] }`; POST `{ sent,total,results[] }` | 401 `not_signed_in`; 403 `no_scope`; 400 (no/too-many recipients); 500 | reseller/enterprise/dept onboarding | **SR**. Scope from role, never from client `:66-84`. Max 500 recipients `:129`. Emails via Supabase. |
| `/api/invite/[id]` | PATCH/DELETE | cookie `getUser` + `invited_by` ownership `invite/[id]/route.ts:18-52` | path `id` | `{ ok:true }` | 401; 403 `not_owned`; 404 `not_found`; 400 (PATCH already accepted); 500 | invite resend/revoke | **SR**. IDOR-protected by `invited_by===user.id` `:49`. |

---

## 7. `api/cron/*` (2)

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | Scheduler | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/cron/abandon-queued` | GET | **Bearer `CRON_SECRET`** header `abandon-queued/route.ts:20-24` | — | `{ ok:true, abandoned }` | 401 `unauthorized`; 500 `supabase env missing`/`{ok:false,error}` | external (no `vercel.json` in repo) | **SR**. Calls RPC `abandon_stale_queued_sessions`. **No `vercel.json crons` committed** — schedule lives outside the repo (comment: "Vercel Cron / GitHub Actions / external pinger"). See P3-C07. |
| `/api/cron/enterprise-digest` | GET | **Bearer `CRON_SECRET`** header `enterprise-digest/route.ts:23-26` | — | `{ ok:true, orgsNotified }` | 401; 500 | external | **SR**. Calls RPC `enterprise_weekly_digest`. Same no-committed-schedule gap (P3-C07). |

CRON_SECRET gate is constant-string compared (`authHeader !== \`Bearer ${expected}\``) — not constant-time, but low value/risk.

---

## 8. Pass-through / dev / test (4) — security-sensitive

| Route | Method | Auth guard (file:line) | Input shape | Output shape | Error codes + body | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/supabase/[...path]` | GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD | **delegated to upstream Supabase** (forwards browser's apikey + JWT) `supabase/[...path]/route.ts:55-63` | any path + body + query | upstream response streamed back verbatim | 500 `supabase_url_missing` | Same-origin Supabase proxy. Auth/RLS enforced **upstream** (browser only holds anon key + user JWT; admin paths need service role it doesn't have). **Injects anon key if missing** `:55-63`. **Streams upstream body + status verbatim** `:83-88` → PostgREST/GoTrue raw error bodies (table/column/constraint names, hints) pass through unmodified = **SEC-API-PROXY-SCHEMA-1 (cross-ref, not re-filed)**. Strips hop-by-hop + encoding headers only. |
| `/api/dev/sign-in-as` | GET | **`NODE_ENV==="production"` → 403** `dev/sign-in-as/route.ts:34-39` | `?role&next?` | 302 redirect with auth cookies set | 403 `forbidden_in_production`; 400 `unknown_role`; 500 | **One-click impersonation of any staff role.** Gate is a **runtime env check, NOT build-time stripping** — route ships in the prod bundle. **Hardcoded demo password literal + demo emails in source** `:22,26-31` (REDACTED here). If any reachable deploy has `NODE_ENV!=="production"` (e.g. misconfigured staging/preview), full role takeover. SEC-AUTH-12 cross-ref + see P3-C08. |
| `/api/dev/why-no-match` | GET | **`NODE_ENV==="production"` → 404** `dev/why-no-match/route.ts:32-34` | `?customer_email`\|`?intake_id` | match-diagnostic JSON | 404 `dev_only`; 500 `supabase_unconfigured` | **SR** diagnostic dumping engineer is_available/presence/heartbeat + customer intake by email. Runtime env gate only (ships in bundle). SEC-AUTH-12 cross-ref. |
| `/api/test/auth` | POST/DELETE | **`NODE_ENV==="production"` → 403** `test/auth/route.ts:17-19,35-37` | POST `{ access_token, refresh_token }` | `{ ok:true }` | 403 `forbidden`; 400 `missing tokens`; 500 | Playwright auth bypass — sets/clears SSR session cookies from caller-supplied tokens. Runtime env gate only. SEC-AUTH-12 cross-ref. |

**Production-kill mechanism (dev/test):** all three rely on a single runtime
guard `process.env.NODE_ENV === "production"`. There is **no build-time
exclusion** — the handlers are compiled into the production bundle and only
short-circuit at request time. On Vercel `NODE_ENV` is `"production"` for both
Production and Preview builds, so the standard deploy path is covered; the
exposure is any environment where `NODE_ENV` is unset/`development`/`test` yet
publicly reachable (self-host, misconfigured container, `vercel dev` exposed).
Combined with the hardcoded shared demo credential in `dev/sign-in-as`, this is
elevated to P3-C08 (SEC-AUTH-12 cross-ref).

---

## Findings (NEW candidates)

- **P3-C01 — `/api/assistant` is an unauthenticated, unthrottled OpenAI proxy.**
  No `getUser`, no API token, no rate limit (`assistant/route.ts:104`). Any
  anonymous caller can drive unlimited OpenAI completions on the platform's key
  → direct billing/cost abuse and DoS. Severity: medium-high.

- **P3-C02 — `/api/intake/turn` is likewise unauthenticated + unthrottled.**
  Public OpenAI proxy (`intake/turn/route.ts:100`), no auth, no rate limit. Same
  cost-abuse/DoS exposure as P3-C01. (It does correctly avoid leaking upstream
  error bodies.) Severity: medium-high.

- **P3-C03 — `/api/online-engineers` leaks engineer identity/availability to
  anonymous callers.** No auth check (`online-engineers/route.ts:59`); a
  service-role read returns a live engineer's `user_id`, pseudonym, tech tags,
  experience tier and "available now" status to anyone, enumerable by tweaking
  `?technologies`. Full name is withheld but the stable `user_id` + presence is
  an information-disclosure / scraping vector. Severity: medium.

- **P3-C04 — `/api/staff/project-qa` RAG retrieval bypasses RLS (cross-tenant
  read / IDOR).** Auth is only "any signed-in user" (`project-qa/route.ts:152-157`).
  Structured reads use the cookie/RLS client, but the Qdrant semantic search is
  filtered solely by the client-supplied `projectId` and is **not** RLS-bound
  (`:370-371`). With an arbitrary `projectId`, `retrieved` is populated from
  another tenant's indexed transcripts/captions/documents, `hasAny` becomes
  true, and the model answers (and persists) over data the caller cannot
  otherwise see. Any authenticated customer can exfiltrate any project's RAG
  corpus by id. Severity: high.

- **P3-C05 — Inconsistent supervisor authorization + missing pod-scope on
  `chat-search`.** Sibling supervisor routes use three different gate shapes:
  super_admin-excluded (act-now/team/etc.), super_admin-allowed (inbox/covering/
  chat-search), and supervisor-only-no-super_admin-exclusion (`matching/route.ts:64-66`).
  More concretely, `/api/supervisor/chat-search` does **not** verify the queried
  `projectId` belongs to the caller's pod (`chat-search/route.ts`), so any
  supervisor can full-text search any project's chat history platform-wide.
  Severity: medium.

- **P3-C06 — `/api/staff/assignable-engineers` is over-broad vs its own
  contract.** The header comment says supervisors are scoped to pods they run
  (`:6-8`), but the implementation returns **every** engineer platform-wide,
  including **email addresses**, to any supervisor or admin
  (`assignable-engineers/route.ts:83-91,129-133`). Either the comment or the
  scoping is wrong; as written it over-discloses staff PII. Severity: low-medium.

- **P3-C07 — Cron endpoints have no committed schedule.** Both `/api/cron/*`
  routes are CRON_SECRET-gated but there is **no `vercel.json` (`crons`)** or CI
  workflow in the repo; scheduling depends entirely on an out-of-band external
  pinger. If unconfigured, `abandon-queued` never reaps stale `queued` sessions
  and the weekly digest never fires — a silent reliability gap, not a security
  hole. Severity: low (operational).

- **P3-C08 — Dev/test routes are runtime-gated only and ship a hardcoded
  credential.** `dev/sign-in-as`, `dev/why-no-match`, `test/auth` are excluded
  solely by a runtime `NODE_ENV==="production"` check, not stripped at build, so
  they exist in every bundle. `dev/sign-in-as` additionally embeds a shared demo
  password literal + demo account emails in source
  (`dev/sign-in-as/route.ts:22,26-31`). Any reachable deploy where `NODE_ENV`
  isn't `"production"` exposes one-click impersonation of every staff role.
  Cross-ref SEC-AUTH-12; the in-source credential is the new element. Severity:
  medium (high if such an environment exists).

- **P3-C09 — `/api/whoami` diagnostic left enabled in production.** Self-only and
  RLS-bound (low data risk), but the file's own comment says "strip in
  production" and there is no env gate (`whoami/route.ts`). Minor
  information-surface / hygiene issue. Severity: low.

- **P3-C10 — In-memory rate limiters are per-instance and ineffective on
  serverless.** `prepare` (6/IP/60s, `prepare/route.ts:31-42`) and `contact`
  (5/IP/10min, `contact/route.ts:50-63`) keep buckets in a module-level `Map`.
  Under Vercel Fluid/serverless fan-out each instance has its own map, so the
  effective limit scales with instance count and resets on cold start —
  trivially bypassed. Move to a shared store (KV/Redis) for a real limit.
  Severity: low-medium.

### Cross-referenced (not re-filed)

- **SEC-API-PROXY-SCHEMA-1** — `/api/supabase/[...path]` streams upstream
  PostgREST/GoTrue error bodies verbatim (`supabase/[...path]/route.ts:83-88`),
  leaking schema detail. Documented in §8.
- **SEC-AUTH-12** — dev/test routes must be dead on deployed builds; see P3-C08.
- **P1-8** — `/set-password` surface param mismatch: `verify-otp` emits `?mode=`
  (`verify-otp/route.ts:143,162`) while `signin-password` emits `?surface=`
  (`signin-password/route.ts:126`). Noted in §1; not re-filed.
