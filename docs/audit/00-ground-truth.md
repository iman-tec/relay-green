# 00 — Ground Truth (derived from filesystem, 2026-06-06)

> Phase 0 of the deep audit. Everything below was enumerated from the working
> tree, not from memory or docs. Counts: **95 page routes**, **134 route
> handlers** (132 under `app/api/` + `auth/callback` + `auth/confirm`),
> **27 Supabase edge functions**, **7 roles**, **4 auth surfaces**.

## 1. Rendering pattern (verified)

Zero `page.tsx` files contain `"use client"` — every page is a **server shell**
that imports a co-located `*Client.tsx` client component (e.g.
`app/room/page.tsx` → `RoomClient.tsx`, `app/(staff)/inbox/page.tsx` →
`InboxClient.tsx`). Client pages reading `useSearchParams()` are wrapped in
`<Suspense>` per Next.js 16. Static analysis of behavior therefore targets the
`*Client.tsx` files, not `page.tsx`.

**Oversized files (structural-map targets for Phase 1):**

| File | Size |
| ---- | ---- |
| `app/room/RoomClient.tsx` | 579 KB (~14k lines) |
| `app/_components/EngineerProfilePane.tsx` | 189 KB |
| `app/staff/session/[id]/EngineerSessionClient.tsx` | 115 KB |

Layouts: `app/layout.tsx` (root: fonts, theme), `app/(staff)/layout.tsx`
(shared staff chrome), `app/staff/layout.tsx`.

## 2. Roles (`lib/relay/roles.ts`)

Privilege-descending: `super_admin` → `reseller` → `enterprise_admin` →
`department_admin` → `supervisor` → `engineer` → `client`.

- Creation hierarchy: super_admin creates resellers OR enterprises;
  reseller creates enterprises; enterprise_admin creates departments +
  department_admins; department_admin creates clients.
- `STAFF_ROLES` = all except `client`. `PLATFORM_OPS_ROLES` =
  supervisor + engineer (outside enterprise hierarchy).
- DB canonical: `public.roles` lookup table, `user_roles.role_id` FK.

## 3. Auth surfaces & protected prefixes (`proxy.ts`, verified)

| Surface | Login page | Protected prefixes |
| ------- | ---------- | ------------------ |
| Customer | `/login` | `/room`, `/account` |
| Staff | `/staff` | `/dashboard`, `/inbox`, `/quotations`, `/triage`, `/supervise`, `/admin`, `/calendar`, `/finance`, `/operations`, `/bids`, `/schedule`, `/settings`, `/session-review`, `/staff/session`, `/staff/project`, `/staff/onboarding` |
| Partner | `/partner` | `/reseller` |
| Business | `/business` | `/enterprise`, `/department` |

proxy.ts also: refreshes Supabase JWT every request (`@supabase/ssr`); writes
geo→theme cookie `relay-theme-geo` (manual `relay-theme-user` wins). Real
authz is server-side (route handlers / RPCs / RLS) + client `useStaffGuard`.
Note: `/triage` prefix is protected but **no `/triage` page exists** in `app/`
— dead prefix, harmless.

## 4. Page routes (95 `page.tsx`)

### Public / marketing (no auth)
`/`, `/pricing`, `/product`, `/explainer`, `/for/[tool]`, `/for-enterprise`,
`/download`, `/download-relay-desktop`, `/brand-guidelines`,
`/sitemap-and-content-plan`, `/company/about`, `/company/governance`

**Resources** (static content): `/resources`, `/resources/articles` (+10
articles), `/resources/guides` (+2), `/resources/research` (+2),
`/resources/customer-stories` (+1), `/resources/white-papers` (+3)

**Legal**: `/legal/{acceptable-use, contracting-terms, cookies, dpa,
privacy-policy, terms-commercial, terms-consumer, terms-of-use}`

**Trust**: `/trust`, `/trust/{compliance, data-handling, privacy,
responsible-disclosure, subprocessors}`

### Auth / onboarding
`/login` (customer), `/staff` (staff login), `/staff/login`, `/business`
(business login), `/partner` (partner login), `/set-password`,
`/staff/onboarding`, `auth/callback` (route), `auth/confirm` (route)

### Customer surface
`/room` (→ RoomClient, the core engagement surface), `/account`, `/intake`,
`/intake/matching/[id]`, `/payment`, `/payment/success`, `/call/[id]`

### Staff surface — grouped `app/(staff)/` (share staff layout)
`/dashboard`, `/inbox`, `/supervise`, `/admin`, `/admin/users`, `/admin/v2`,
`/calendar`, `/schedule`, `/quotations`, `/bids`, `/finance`, `/operations`,
`/settings`

### Business/partner surfaces — ALSO under `app/(staff)/` (staff layout, but business/partner login)
`/enterprise`, `/enterprise/departments`, `/enterprise/wallet`,
`/enterprise/supervise`, `/enterprise/v2`, `/department`, `/department/v2`,
`/reseller`, `/reseller/v2`

### Staff surface — ungrouped
`/staff/session/[id]` (engineer workspace → EngineerSessionClient),
`/staff/project/[id]`, `/staff/assistant`, `/session-review/[id]`

### LEGACY (Prisma-stub backed — expected to throw "Prisma is no longer wired")
`/customer`, `/engineer`, `/supervisor`, `/widget/customer`, `/widget/engineer`

## 5. API route handlers (134)

### Auth (7)
`api/auth/{prepare, send-otp, verify-otp, set-password, signin-password}`,
`auth/callback`, `auth/confirm`
— QA signs in via `POST /api/auth/signin-password`. Rate-limited:
`api/auth/prepare` (in-memory, per-instance).

### Admin / super_admin (28)
`api/admin/{availability-requests, engineers, engineers/[id], leave-requests,
matching, ops-escalations, users, users/[id], users/[id]/resend-invite}`
Orgs: `api/admin/orgs[/[id]]{, /admins[/[userId]], /departments[/[deptId]]
{, /admin, /employees[/[empId]]}, /members, /refill}`
Pods: `api/admin/pods[/[id]]{, /members[/[userId]], /eligible-users}`
Resellers: `api/admin/resellers[/[id]]{, /refill}`

### Enterprise (27)
`api/enterprise/{billing, export, me, org, regenerate-code, sessions, usage,
notification-prefs, notifications[/[id]]}`
Departments: `api/enterprise/departments[/[id]]{, /admin, /refill,
/employees[/[empId]]{, /refill}}`
Members/users: `api/enterprise/{members/[id]{, /erase, /resend-invite},
users[/[id]]}`
Wallet: `api/enterprise/wallet{, /activate-plan, /checkout, /topup}`
Plus `api/enterprise-request` (public lead form, rate-limited).

### Department (9)
`api/department{, /employees[/[id]]{, /refill}, /notification-prefs,
/notifications[/[id]], /sessions, /usage}`

### Reseller (15)
`api/reseller/{branding, dashboard, payout, notification-prefs,
notifications[/[id]], team-members[/[id]]}`
`api/reseller/enterprises[/[id]]{, /refill}`,
`api/reseller/orgs[/[id]/departments[/[deptId]]{, /employees}]`

### Supervisor (13)
`api/supervisor/{act-now, bookings, chat-search, coverage, covering,
engineer/[id], escalation-themes, inbox, leave-requests, matching, payouts,
team}`

### Staff / engineer (8)
`api/staff/{assignable-engineers, broadcast-match, index-session, project-qa,
quote-requests}`, `api/engineer/{ai-ask, customer-draft,
notifications[/[id]]}`

### Customer-facing core (12)
`api/me`, `api/whoami`, `api/customer/me-employment`, `api/intake/turn`
(AI intake), `api/match/{directed, presence}`, `api/online-engineers`,
`api/contract/{accept, decline, delete, checkout, commit}`

### Billing (2)
`api/billing/payment-methods{, /setup-intent}`

### Misc (8)
`api/assistant`, `api/contact` (rate-limited), `api/channel-partners`,
`api/internal/{compensation, feedback}`, `api/invite[/[id]]`,
`api/cron/{abandon-queued, enterprise-digest}`

### Pass-through / dev / test (4) — security-sensitive
- `api/supabase/[...path]` — Supabase proxy (known issue
  SEC-API-PROXY-SCHEMA-1: raw error leak)
- `api/dev/sign-in-as`, `api/dev/why-no-match`, `api/test/auth` — **must be
  dead on deployed builds** (SEC-AUTH-12). Never used for mutation in this
  audit.

## 6. Supabase edge functions (27, `supabase/functions/`)

| Domain | Functions |
| ------ | --------- |
| Payments/Stripe | `create-credits-checkout`, `create-enterprise-checkout`, `create-guest-checkout`, `create-relay-checkout`, `credit-relay-payment`, `payments-webhook`, `relay-stripe-webhook` |
| Zoom lifecycle | `create-zoom-meeting`, `end-zoom-meeting`, `mint-zoom-for-session`, `restart-guest-zoom`, `start-guest-call`, `zoom-sdk-signature`, `zoom-video-sdk-token`, `zoom-video-sdk-end`, `zoom-webhook`, `zoom-video-webhook` |
| AI (Anthropic) | `score-session-health`, `summarize-call`, `summarize-customer`, `summarize-guest-call`, `summarize-intake`, `summarize-project`, `regenerate-guest-brief`, `morning-brief`, `transcribe-chunk` |
| Housekeeping | `purge-completed-projects` |
| Shared | `_shared` (helpers, not a function) |

## 7. Client/data layer

- `lib/supabase/{browser,server}.ts` — the only sanctioned Supabase clients;
  `types.ts` generated.
- `lib/relay/` (41 files) — hooks + helpers: `useCustomerSession`,
  `useEngineerSession`, `useEngineerQueue`, `useEngineerHeartbeat`,
  `useEngineerWorkspace`, `useStaffGuard`, `useIsSupervisor`,
  `useRequireEngineerProfile`, `useRingtone`, `useSessionTimer`,
  `useOverlayDismiss`, `useIsDesktop`, plus helpers (`pricing`, `roles`,
  `loginSurface`, `orgGuard`, `session-status`, `sessionClock`,
  `sessionDrafts`, `ringingHud`, `theme`, `kanonymity`, `accessAudit`,
  `deviceTracking`, `engineerAiContext`, `assistantTab`, `chatAttachments`,
  `customerProfile`, `projectMetadata`, `intakeOptions`, `invites`,
  `resellerNotify`, `csv`, `zip`, `timezones`, `transient`,
  `silenceSdkNoise`, `stubDraftAttachments`, `rag/`)
- `lib/video/` — `zoomClient.ts` (SDK singleton), `useZoomCall.ts`,
  `LaunchCallContext.tsx`, `silenceVideoSdkNoise.ts`. Video SDK default;
  Meeting SDK legacy fallback. Pairs with `reactStrictMode: false`.
- Per-audience auth helpers: `lib/{admin-auth, enterprise-auth,
  department-auth, reseller-auth, auth-ban, password-policy}.ts`.
- `lib/db.ts` — Prisma stub Proxy, throws on touch. `lib/auth.ts` — Phase-0
  demo, not live.
- Other lib dirs: `allocation/`, `api/`, `billing/`, `contact/`, `hooks/`,
  `intake/`, `seo/`, `stripe/`.

## 8. Test harness (verified from `playwright.config.ts`)

- `testDir: ./tests`, **`workers: 1`, `fullyParallel: false`** (shared
  Supabase state), retries 1, chromium only, trace retain-on-failure.
- `baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://10.0.3.175:3000"`.
- Existing specs: `customer`, `e2e`, `engineer-flow`, `engineer-notification`,
  `engineer`, `guards`, `paywall`, `public` + `tests/helpers/supabase.ts`.
- **⚠ Three different LAN IPs in the repo** (multi-developer):
  `package.json dev` binds **10.0.1.112**; `playwright.config.ts` defaults
  **10.0.3.175**; CLAUDE.md/PROJECT_CONTEXT say **10.0.2.129**. All three are
  in `allowedDevOrigins`. Live-walk target must be confirmed before Phase 2.

## 9. Phase-2 blockers (resolve before live walk)

1. **`qa/test-accounts.json` does NOT exist** (`qa/` dir absent). Prime
   directive: stop, don't invent credentials. Need the file (8 password
   accounts, 7 roles + client_employee) from the dev.
2. **Target URL unresolved** — which of the three LAN IPs (or the Vercel
   deploy) is live now. Set `PLAYWRIGHT_BASE_URL`.
3. Zoom mode unknown (`NEXT_PUBLIC_USE_VIDEO_SDK` / mock flags in
   `.env.local`) — determines whether call flows assert real A/V or state
   transitions only.
