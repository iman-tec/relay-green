# Phase 2 — Live confirmation of static findings (API/auth layer)

> Target: `https://10.0.1.112:3000` (LAN dev server, self-signed → `curl -k`).
> Deploy probed separately where noted: `https://relay-green-471i.vercel.app`.
> Date: 2026-06-06. All probes read-only or auth-only (no tenant-data mutation).
> Passwords never printed; secrets redacted to first/last chars.

## Pre-flight (all PASS)

| Check | Result |
| --- | --- |
| `GET /` (dev) | 200 |
| `GET /login` | 200 |
| `GET /room` unauth | 307 → `/login` ✅ (proxy CUSTOMER) |
| `GET /admin/v2` unauth | 307 → `/staff` ✅ (proxy STAFF) |
| `GET /enterprise` unauth | 307 → `/business` ✅ (proxy BUSINESS) |
| `GET /reseller` unauth | 307 → `/partner` ✅ (proxy PARTNER) |
| **SEC-AUTH-12** dev backdoor `/api/dev/sign-in-as` on **DEPLOY** | **403 DEAD** ✅ |
| **SEC-AUTH-12** `/api/test/auth` POST on **DEPLOY** | **403 DEAD** ✅ |
| dev backdoors on dev target | open (400/500) — **expected on dev**, not a finding |

Proxy 4-surface routing verified end-to-end against the running app — matches
`00-ground-truth.md §3` and `proxy.ts` exactly.

## Login matrix (POST /api/auth/signin-password) — 7/8 PASS

| Account | surface | result | landing (`next`) | doc landing | match |
| --- | --- | --- | --- | --- | --- |
| client | customer | 200 | `/room` | /room | ✅ |
| engineer | staff | 200 | `/dashboard` | /dashboard | ✅ |
| super_admin | staff | 200 | `/admin/v2` | /admin/v2 | ✅ |
| enterprise_admin | business | 200 | `/enterprise/v2` | /enterprise/v2 | ✅ |
| department_admin | business | 200 | `/department/v2` | /department/v2 | ✅ |
| reseller | partner | 200 | `/reseller/v2` | /reseller/v2 | ✅ |
| supervisor | staff | 200 | `/supervise` | /supervise | ✅ |
| **client_employee** (employee5) | customer | **400 `User is banned`** | — | /room | ⚠ banned |

- All 7 working accounts have `password_set=true` (no `/set-password` divert).
- **OPERATOR NOTE (not a bug):** `employee5@yopmail.com` is **banned** in
  Supabase (auth-ban). The department-employee `client` walk can't run until
  unbanned or a replacement is supplied. Logged, not filed.

## Auth correctness — positive control PASS

- client creds submitted on **staff** surface → **403 `wrong_login_surface`**,
  session rolled back, body names `allowed_surface:"customer"`,
  `allowed_surface_url:"/login"`. The server-side surface gate
  (signin-password/route.ts:99-111) **works**. Cross-surface privilege via
  bare creds is blocked.

## Blocker/High candidates — LIVE RESULTS

| ID | Verdict | Evidence |
| --- | --- | --- |
| **P3-E1** zoom-sdk-signature credential mint | **CONFIRMED — Blocker** | POST `{SUPABASE}/functions/v1/zoom-sdk-signature` with only the public anon key (shipped in browser bundle), **no user JWT**, `role:1` (host), arbitrary `meetingNumber:"99999999999"` → **HTTP 200**, body `{signature: <valid 285-char Meeting-SDK JWT, redacted>, sdkKey: ezKCD0…, password:"", zak:""}`. Any anonymous caller mints a **host-role** Meeting-SDK signature for any meeting number. `zak` empty here (no host ZAK leaked in this path), but host signature alone permits join/host on the legacy Meeting SDK. |
| **P3-C03** online-engineers anon leak | **CONFIRMED — Med/High** | `GET /api/online-engineers` **unauthenticated** → 200, returns engineer **real `id` UUID** `43b3a66f-…`, pseudoName `gtlengineer`, tech stack, `experienceYears`, ETA. Enumerable engineer roster + user_id to anon. |
| **P3-C01** assistant anon OpenAI proxy | **CONFIRMED — High** | `POST /api/assistant` **unauthenticated** → 200, full `gpt-4o-mini-2024-07-18` completion returned. Unmetered cost-abuse / DoS surface. |
| **P3-C02** intake/turn no auth gate | **CONFIRMED (partial)** | `POST /api/intake/turn` unauth → 400 `messages required` (hit input validation, **not** 401). No auth gate before the OpenAI call path — same exposure class as C01. |
| **P3-C04** project-qa RAG IDOR | **gate present; IDOR unproven** | `POST /api/staff/project-qa` unauth → **401 `Not authenticated.`** Auth gate exists. The cross-tenant IDOR (static: filtered by client `projectId` only, no viewer RLS re-check) needs a **foreign tenant project_id** to confirm — deferred to a careful authed probe with a known cross-tenant id. |
| **C6-1 / doc** AI stack = OpenAI not Anthropic | **CONFIRMED** | assistant response `model: gpt-4o-mini-2024-07-18`. No Claude anywhere. Docs (CLAUDE.md, PROJECT_CONTEXT, ground-truth §6) are wrong. |
| **SEC-AUTH-12** dev backdoors on deploy | **CONFIRMED DEAD** | 403 on Vercel deploy (see pre-flight). |

### Not yet live-probed (need authed/cross-tenant context or are mutating)
- P3-E2 create-guest-checkout amount-trust — mutating (creates Stripe session); confirm via static only or a read-only dry call.
- P3-O07 wallet/activate-plan no-payment — **mutating tenant billing**; will NOT execute. Static only.
- P3-E3 start-guest-call endAllLiveMeetings — destructive (ends live meetings); will NOT execute.
- P3-E4/E5 Zoom webhook fail-open / double-bill — needs crafted webhook POST; defer, careful.
- C3-1 SupervisorAlerts realtime leak — confirm in browser walk (DevTools network/WS as reseller).
