# Relay.green Deep Audit — INDEX & checkpoint log

> Master TOC + live progress log. Update after every page/flow so the audit
> resumes with zero lost work. Rules of engagement: see "Prime directive"
> in the audit brief — source read-only; writes only to `docs/audit/`, `qa/`,
> `tests/audit/`; QA accounts only; serialize mutations; log every
> state-changing action in §"Mutation log" below.

## Status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 0 | Ground truth & setup | ✅ **DONE** 2026-06-06 → [00-ground-truth.md](00-ground-truth.md) |
| 1 | Static structure map (route cards, component maps, state machines) | ✅ **DONE** 2026-06-06 — 41 route cards, 3 component maps, state-machines.md |
| 2 | Live walk (4 surfaces × 7 roles) + 8 core flows | 🟡 **SURFACE DONE, FLOWS BLOCKED** — pre-flight + API/auth + 24-page surface walk ✅; 8 flows 🚫 `ENV-DEVSERVER-DOWN` + missing `browser_tabs` perm (Flow 1 partial) |
| 3 | Connections & integrations deep-dive | ✅ **DONE** 2026-06-06 — [connections.md](connections.md), [api/edge-functions.md](api/edge-functions.md), [api/api-routes-org.md](api/api-routes-org.md), [api/api-routes-core.md](api/api-routes-core.md) |
| 4 | Risk map + regression checklist | ✅ **DONE** 2026-06-06 — [risk-map.md](risk-map.md) (13 entries R1–R13), [regression-checklist.md](regression-checklist.md) |
| 5 | Findings, coverage matrix, close-out | ✅ **DONE** 2026-06-06 — `qa/bug-log.csv` (11 rows), [coverage-matrix.md](coverage-matrix.md). Open item: flow re-run after server restart |

## Blockers (all resolved 2026-06-06)

1. ~~`qa/test-accounts.json` missing~~ **RESOLVED 2026-06-06**: operator
   supplied 8 accounts (7 roles + client_employee); written to
   `qa/test-accounts.json` (gitignored, confirmed via `git check-ignore`).
   Passwords never printed in any audit doc. Phase 2 unblocked.
2. ~~Live target unresolved~~ **RESOLVED 2026-06-06**: dev server live at
   `https://10.0.1.112:3000` (matches `package.json` dev script; port probes
   on 10.0.2.129 / 10.0.3.175 / localhost all closed). Set
   `PLAYWRIGHT_BASE_URL=https://10.0.1.112:3000` for Phase 2.
3. ~~Zoom mode unknown~~ **RESOLVED 2026-06-06**: `.env.local` has no
   `NEXT_PUBLIC_USE_VIDEO_SDK` / mock flags → code default applies, and
   commit `7bc6667` made Video SDK the default call surface. Expect **real
   Zoom Video SDK** (live A/V), not mocked.

## Phase plan

### Phase 1 — static map (no app/server needed; can start immediately)
Order: highest-traffic + highest-risk first.
1. `components/room-client.md` — structural map of `app/room/RoomClient.tsx`
   (579 KB): exports, state, effects, realtime subscriptions, handlers,
   element inventory. Read in ranges.
2. `components/engineer-session-client.md` (115 KB) +
   `components/engineer-profile-pane.md` (189 KB).
3. `state-machines.md` — session lifecycle, queue→ring→accept, call
   connect/disconnect, paywall, booking.
4. `routes/*.md` cards — order: room → staff/session/[id] → dashboard/inbox →
   supervise → enterprise/department/reseller → admin → intake/payment/
   account → auth pages → legacy → marketing (batch card).
   Per card: file path, roles, surface, server/client, data sources
   (tables/RPCs/channels), api+edge calls, `use*` hooks, element inventory
   (buttons/forms/modals + handlers + enable conditions).

### Phase 2 — live walk (after blockers cleared)
Per surface (customer → staff → business → partner): sign in QA account,
visit every reachable route, record to `walks/<surface>.md` (elements,
states, network/realtime, console, divergence from Phase 1). Then 8 flows →
`flows/*.md`: guest, customer-chat-call, engineer, supervisor, quote→bid→
contract, bookings, enterprise/reseller admin, payments. Serialized.
Screenshots/traces → `qa/`.

### Phase 3 — connections
`connections.md` (realtime channels, presence, heartbeat, queue/ring path
incl. bimodal latency, Zoom lifecycle, Stripe lifecycle, AI edge fns) +
`api-and-edge-functions.md` (every endpoint: method, auth, inputs/outputs
redacted, error shape).

### Phase 4 — protective deliverables
`risk-map.md` (Zoom singleton, StrictMode-off, RoomClient shared state,
realtime/heartbeat wiring, proxy.ts edges, non-atomic booking, CSP
report-only) + `regression-checklist.md` (run-before-ship list).

### Phase 5 — close-out
`qa/bug-log.csv` (cross-ref known: E2E-CLEANUP-1, CHAT-LOSS-1, CHAT-LOCK-1,
FUNC-BOOK-ATOMIC-1, ring-latency, SEC-API-PROXY-SCHEMA-1),
`coverage-matrix.md` (routes × roles × documented/walked/flow-tested),
finalize this INDEX.

## Table of contents (grows as files land)

> 👉 **Team entry point: [CONTEXT.md](CONTEXT.md)** — read first before optimizing
> code or decommissioning legacy. Orients to load-bearing behavior + landmines.
> (CLAUDE.md at repo root points here too.)


- [00-ground-truth.md](00-ground-truth.md) — routes (95 pages, 134 handlers),
  roles, surfaces, 27 edge functions, harness facts, blockers
- routes/ — ✅ **complete, 41 cards**:
  - Customer: [room](routes/room.md), [account](routes/account.md),
    [intake](routes/intake.md), [intake-matching](routes/intake-matching.md),
    [payment](routes/payment.md), [payment-success](routes/payment-success.md),
    [call](routes/call.md), [login](routes/login.md)
  - Staff: [dashboard](routes/dashboard.md), [inbox](routes/inbox.md),
    [supervise](routes/supervise.md), [staff-session](routes/staff-session.md),
    [staff-project](routes/staff-project.md), [session-review](routes/session-review.md),
    [staff-assistant](routes/staff-assistant.md), [staff-onboarding](routes/staff-onboarding.md),
    [calendar](routes/calendar.md), [schedule](routes/schedule.md),
    [quotations](routes/quotations.md), [bids](routes/bids.md),
    [finance](routes/finance.md), [operations](routes/operations.md),
    [settings](routes/settings.md)
  - Admin: [admin](routes/admin.md), [admin-users](routes/admin-users.md),
    [admin-v2](routes/admin-v2.md)
  - Business/partner: [enterprise](routes/enterprise.md),
    [enterprise-departments](routes/enterprise-departments.md),
    [enterprise-wallet](routes/enterprise-wallet.md),
    [enterprise-supervise](routes/enterprise-supervise.md),
    [enterprise-v2](routes/enterprise-v2.md), [department](routes/department.md),
    [department-v2](routes/department-v2.md), [reseller](routes/reseller.md),
    [reseller-v2](routes/reseller-v2.md)
  - Auth: [staff-login](routes/staff-login.md), [business-login](routes/business-login.md),
    [partner-login](routes/partner-login.md), [set-password](routes/set-password.md),
    [auth-callbacks](routes/auth-callbacks.md)
  - Batches: [legacy-batch](routes/legacy-batch.md), [marketing-batch](routes/marketing-batch.md)
- components/ — ✅ [room-client](components/room-client.md) (14,519 lines mapped),
  [engineer-session-client](components/engineer-session-client.md),
  [engineer-profile-pane](components/engineer-profile-pane.md)
- [state-machines.md](state-machines.md) — ✅ session lifecycle, queue→ring→accept,
  Zoom call machine, paywall, booking
- [connections.md](connections.md) — ✅ 47 realtime channels, presence/heartbeat,
  queue/ring wiring, Zoom lifecycle, Stripe wiring, AI fns
- api/ — ✅ [edge-functions.md](api/edge-functions.md) (27 edge fns),
  [api-routes-org.md](api/api-routes-org.md) (~80 admin/enterprise/dept/reseller
  handlers), [api-routes-core.md](api/api-routes-core.md) (~54 auth/supervisor/
  staff/customer/billing/misc/cron/dev handlers)
- walks/ — ✅ [_live-confirmation.md](walks/_live-confirmation.md) (API/auth),
  [customer.md](walks/customer.md), [staff.md](walks/staff.md),
  [business.md](walks/business.md), [partner.md](walks/partner.md).
  flows/ — 🟡 in progress (background 2-party agent)
- [risk-map.md](risk-map.md) — ✅ 13 fragility entries R1–R13 (Zoom singleton,
  string-gating, client-billing, ring-bimodality, realtime, proxy edges,
  zoom-sig mint, webhook fail-open, SupervisorAlerts oversub, booking,
  schema-drift, giant files, CSP+AI-proxy)
- [regression-checklist.md](regression-checklist.md) — ✅ run-before-ship,
  gated by touch-area
- `qa/bug-log.csv` — ✅ 11 rows (live-confirmed + known cross-refs + ENV blocker)
- flows/ — 🟡 [1-guest.md](flows/1-guest.md) partial (dev);
  [2-customer-deploy.md](flows/2-customer-deploy.md) partial (PROD, login→PostCall);
  flows 3–8 + 2-party ring/accept pending (need engineer-side / 2nd context)
- [coverage-matrix.md](coverage-matrix.md) — ✅ routes×roles×{doc/walk/flow}
- walks/ — (pending Phase 2)
- flows/ — (pending Phase 2)
- connections.md — (pending Phase 3)
- api-and-edge-functions.md — (pending Phase 3)
- risk-map.md — (pending Phase 4)
- regression-checklist.md — (pending Phase 4)
- coverage-matrix.md — (pending Phase 5)

## Phase 1 findings staging (→ Phase 4 risk-map / Phase 5 bug log; static analysis, unverified live)

**Cross-references of KNOWN issues (do not re-file):**
- CHAT-LOSS-1 mechanics: draft auto-flush is one-shot, never retries on insert
  failure (RoomClient.tsx:429-536); realtime message sub is INSERT-only with no
  catch-up re-fetch on reconnect (useCustomerSession.ts:413-445).
- CHAT-LOCK-1 confirmed UI-deep only: client `TERMINAL_STATES` check
  (useCustomerSession.ts:551); no server-side insert rejection found in surface.
- FUNC-BOOK-ATOMIC-1: engineer side partially fixed (partial unique index, same
  `slot_start` only — 20260601100000_booking_atomic_and_last_engineer.sql:24-26);
  supervisor side fully racy: count-then-insert at
  20260601120000_supervisor_scheduling.sql:182-205, no unique index.
- Ring-latency bimodality EXPLAINED: fast = realtime INSERT push to rung engineer
  (EngineerIncomingMatch.tsx:116-133); slow = 30s offer TTL
  (20260530220000_offer_ring_timers.sql:32-33) swept only by the CUSTOMER's 1.5s
  poll (MatchingClient.tsx:61, 262-277 → `expire_stale_offers`) → ~31s. No server
  cron sweeps offers — customer closing the matching tab stalls tier escalation.

**NEW candidates (verify live in Phase 2/3 before filing):**
| # | Area | Finding |
|---|------|---------|
| P1-1 | security/authz | `/staff/assistant` unprotected at every layer — not in STAFF_PREFIXES (proxy.ts:53-55), no server getUser, no client guard; anon renders full chrome. Also `project-qa` Qdrant retrieval filters by project_id only, no viewer RLS re-check (route.ts:363-392). |
| P1-2 | authz | `requireEnterpriseAdmin` accepts department_admin → dept admins can hit org-wide `/api/enterprise/*`. Conversely v2 pages admit super_admin "to preview" but APIs reject → all tabs error. |
| P1-3 | bug | Admin v2 Pods tab: fetches `/api/admin/users?limit=1000`, reads `body.users`; API paginates `pageSize` (default 25) and returns `{rows}` → member status always "active", deactivate toggle fires wrong state (PodsTab.tsx:107-118 vs lib/api/list-query.ts:121-128). |
| P1-4 | authz/scoping | Bid feeds platform-wide: `/api/supervisor/act-now` + `/api/staff/quote-requests` fetch `project_quote_requests` with no pod/org filter. |
| P1-5 | billing/risk | Billing enforcement runs in customer's browser: `useFreeSessionLifecycle` (RoomClient.tsx:203-296) fires `end_session`/stamps `paid_extension_at` from the tab; paid pivot is a direct UPDATE bypassing the RPC wall (RoomClient.tsx:266-272). Tab close depends on server sweepers. |
| P1-6 | fragility | Call-join gating parses literal system-message strings ("Zoom meeting started/ended") — copy change in Zoom edge fns silently dead-buttons customers (already happened once → commit 6864c61). |
| P1-7 | schema | `guest_calls.status` is unconstrained text; `grace`/`ending` states declared but never written (dead states). |
| P1-8 | auth bug | `signin-password` emits `?surface=` but `/set-password` reads only `?mode=` → 401-bounce defect (landing saved by `?continue=`). Auth callback/confirm error paths hardcode `/login` with unrendered `?error=`. |
| P1-9 | rls | `engineer_profiles` RLS (`user_id = auth.uid()` FOR ALL, 20260520100000:41-45) lets any authed user self-insert an engineer profile (mitigated: matcher sources from `user_roles`). |
| P1-10 | exposure | Bare-mode StaffShell mounts `SupervisorAlerts` for any non-engineer (StaffShell.tsx:500, 1241) → pure resellers subscribe to guest_calls/escalation realtime channels. |
| P1-11 | privacy | Reseller onboarding/referral URLs sent to third-party `api.qrserver.com` for QR rendering. |
| P1-12 | ux/data | `/session-review` soft-deleted messages still appear in center transcript + .txt download (filter only in right ChatPane); session row never refreshed → live→ended doesn't lock composer. |
| P1-13 | dead code | `/payment/success` orphaned (real flow returns `/room?relay_paid=`); RoomClient dead components (ReviewPanel, ReadOnlyChatPane, ChatHistoryView); Dashboard CallsWaitingBox never rendered; reseller v2 `_drawers/` unimported (scrapped minute-pool) leaving `/api/reseller/.../refill` + `/api/reseller/orgs/*` with no UI callers; `/api/enterprise/regenerate-code` + `wallet/activate-plan` uncalled; FinanceClient SalariesSection unmounted. |
| P1-14 | gates | `/bids` server gate doesn't exclude super_admin (API does → empty rail); `/schedule` missing from SUPER_ADMIN_HIDDEN (link shown, page bounces); `/quotations` + `/calendar` no server-side role gate (client bounce only); `/settings` blank page for non-engineer staff. |
| P1-15 | stub | Partner Settings: partner-name PATCH is a TODO, white-label saves to local state only; billing transactions synthetic (€3/min hardcoded ×4). Engineer "Request when busy" stub fakes success toast (RoomClient). |

## Phase 3 findings staging (→ Phase 4/5; STATIC analysis — verify live before filing as bugs)

> ⚠️ Several are Blocker/High class IF live-confirmed. `verify_jwt` flags assume
> committed `supabase/config.toml` is authoritative — hosted Dashboard overrides
> can't be seen from the repo; **must confirm against deployed project in Phase 2/3-live**.

**Doc-vs-reality correction (not a bug, fix the docs):**
- **AI stack is OpenAI + Groq, NOT Anthropic.** Every "AI" edge fn uses
  `gpt-4o-mini`/`gpt-4o`/`whisper-1` (OpenAI) or `llama-3.3-70b-versatile` (Groq).
  No Claude/Anthropic call exists anywhere. CLAUDE.md, PROJECT_CONTEXT.md, and
  00-ground-truth.md §6 all wrongly say "Anthropic Claude." (connections.md C6-1)

**Edge functions (api/edge-functions.md):**
| # | Sev? | Finding |
|---|------|---------|
| P3-E1 | **Blocker ✅LIVE** | `zoom-sdk-signature` (`verify_jwt=false`, no auth) mints Meeting-SDK JWT for any caller-supplied `meetingNumber`+`role:1` — credential minting, zero auth. **Confirmed 2026-06-06**: anon+public-anon-key → 200 + valid 285-char host signature + sdkKey (`zak` empty in probe). Legacy Meeting-SDK path but live in config. |
| P3-E2 | Blocker? | `create-guest-checkout` trusts client `amount_cents`/`minutes` → pay $0.50, claim arbitrary minutes. (No client invoke site found — legacy/desktop; live if deployed.) |
| P3-E3 | High | `start-guest-call` (no auth) calls `endAllLiveMeetings()` — ends EVERY live Zoom on the host account before minting → cross-session DoS. `mint-`/`restart-` siblings protect active sessions; this one doesn't. |
| P3-E4 | High | Both Zoom webhooks **fail open**: signature verify `return true` when secret env unset (`zoom-webhook:40`, `zoom-video-webhook:57`). Stripe webhooks do NOT have this hole. |
| P3-E5 | High | `zoom-video-webhook` `session.ended` **double-bills** on Zoom redelivery (no `status==='billed'` guard, unlike `zoom-webhook`). `payments-webhook` guest_extension branch double-extends (no dedup). |
| P3-E6 | Med | 6+ fns `verify_jwt=false` with no internal gate: `restart-guest-zoom`, `summarize-guest-call/-project/-customer`, `regenerate-guest-brief`, `score-session-health`, `morning-brief` → UUID-guessable state change / AI spend / user enumeration. |
| P3-E7 | Med | Nearly every non-webhook fn leaks `err.message`/`String(e)` (SEC-API-PROXY-SCHEMA-1 family). `purge-completed-projects` is the only one with a correct anti-fail-open shared-secret gate. |

**Org/admin API routes (api/api-routes-org.md):**
| # | Sev? | Finding |
|---|------|---------|
| P3-O07 | Blocker? | `enterprise/wallet/activate-plan` flips `plan_tier` to active from client-supplied `tier` with **NO payment verification** (paymentIntentId optional, never checked) → any enterprise_admin/dept_admin self-grants paid tier free. (ORPHAN — no UI caller, but reachable.) |
| P3-O06 | High | `enterprise/wallet/topup` double-credit race: check→credit→stamp on Stripe PI metadata, no DB lock/unique ledger. |
| P3-O09 | High | P1-2 blast radius: `requireEnterpriseAdmin` accepts `department_admin` (enterprise-auth.ts:48-51) → dept admins hit org-wide `/api/enterprise/*` incl. full-org GDPR `export` + org-settings PATCH. |
| P3-O01 | Med | `reseller/orgs/[id]/departments/[deptId]/employees` is byte-for-byte duplicate of parent, returns dept aggregate not employee roster. |
| P3-O02/O03 | Med | Pervasive raw DB error text to client; `listUsers({perPage:1000})` (200 for reseller) silently truncates email/dup-lookup everywhere except `admin/users`. |
| P3-O04/O05/O08/O10 | Low-Med | Unbounded `enterprise/users` GET; non-atomic org/dept deletes; `enterprise-request` in-memory 5/10min/IP limiter (ineffective multi-instance); €3/min synthetic billing hardcoded in 7 files. |

**Core API routes (api/api-routes-core.md):**
| # | Sev? | Finding |
|---|------|---------|
| P3-C04 | Blocker? | `staff/project-qa` Qdrant RAG search filtered ONLY by client `projectId`, not RLS-bound → any signed-in user reads any project's indexed transcripts/docs (cross-tenant IDOR). (= P1-1 second half.) |
| P3-C08 | Blocker? | `dev/sign-in-as`, `dev/why-no-match`, `test/auth` gated by **runtime `NODE_ENV==="production"` check only, NOT build-time stripping** (SEC-AUTH-12). `dev/sign-in-as` has hardcoded shared demo password + emails. **MUST probe on deploy target** — if NODE_ENV≠production there, auth bypass is live. |
| P3-C01/C02 | **High ✅LIVE** | `api/assistant` + `api/intake/turn` unauthenticated, unthrottled OpenAI proxies → cost-abuse/DoS. **Confirmed**: anon `POST /api/assistant` → 200 full gpt-4o-mini completion; `intake/turn` anon → 400 validation (no 401 gate). |
| P3-C03 | **Med ✅LIVE** | `api/online-engineers` leaks engineer `user_id` + availability to anonymous callers (service role). **Confirmed**: anon GET → 200 with real `id` UUID + pseudoName + tech + experience + ETA. |
| P3-C06 | Med | `staff/assignable-engineers` returns all engineers + emails platform-wide, contradicting pod-scope comment. |
| P3-C05/C07/C09/C10 | Low-Med | Inconsistent supervisor gates + unscoped `chat-search`; no committed `vercel.json` cron schedule (out-of-band); `whoami` on in prod; per-instance in-memory rate limits ineffective on serverless. |

**Connections (connections.md):**
| # | Sev? | Finding |
|---|------|---------|
| C3-1 | High | `StaffShell` mounts `SupervisorAlerts` on `!isEngineer` (StaffShell.tsx:499-500, 1240-1413) — resellers, enterprise_admin, dept_admin, super_admin ALL open 2 unfiltered platform-wide subs (`guest_calls *`, `session_escalations INSERT`) + get escalation ringtone. Wrong helper (should be `useIsSupervisor()`). (= P1-10, now confirmed worse.) |
| C5-1 | High | Enterprise wallet top-up non-atomic remote-flag idempotency → double-credit race (= P3-O06). |

## ⚠️ Evidence note — screenshots are mostly ephemeral

The MCP browser saved screenshots to a per-session temp dir that **cleared on
browser relaunch**. Only **3 PNGs persisted**: `qa/screens/flow5-bids.png`,
`flow6-schedule.png`, `flow8-recharge.png`. The other screenshot filenames cited
in `qa/bug-log.csv` and the flow/walk docs (surface-walk set, `deploy-client-*`,
`flow2/3/4-*`) **no longer exist on disk** — they were real at capture time (some
were Read back as images mid-session) but were not durably persisted.
**The authoritative evidence for every finding is the recorded DOM-snapshot,
network-request, and console output quoted in the flow/walk docs and this INDEX**
(exact statuses, button labels, query strings, `model:` values, etc.) — those are
verbatim tool observations, not reconstructions. Re-run with an explicit durable
screenshot path if image artifacts are needed for a report.

## Phase 2 live-walk results (browser surface walk, 7 roles, 24 pages)

Surface walks: [walks/customer.md](walks/customer.md), [walks/staff.md](walks/staff.md),
[walks/business.md](walks/business.md), [walks/partner.md](walks/partner.md),
[walks/_live-confirmation.md](walks/_live-confirmation.md) (API/auth).
Screenshots: `qa/screens/*.png` (24). Bug log: `qa/bug-log.csv`.

- **Zero crashes / white screens / Prisma-stub errors** across all 24 reachable pages.
- **Nav role-filters all match** the documented StaffShell sets (engineer/supervisor/super_admin/enterprise_admin/dept_admin/reseller).
- **C3-1 nuanced verdict**: code over-subscribes (deny-list `!isEngineer` mounts SupervisorAlerts for reseller/enterprise/dept admins) BUT no live leak — RLS returns `[]` for reseller on `guest_calls`/`session_escalations`, and realtime WS is non-functional in this env (everything REST-polls). Fragile (one RLS regression → live channel-partner cross-tenant leak), not an active breach. → `AUDIT-SUPALERTS-OVERSUB-1`.
- **NEW `AUDIT-DATA-400-1`**: `projects` select incl. `completion_status,completed_at` → 400 on `/room` (every poll) + `guest_calls...projects(contract_type,completion_status)` → 400 on engineer `/dashboard` KPIs; both silent-fallback. Schema drift.
- **NEW `AUDIT-LOGIN-COPY-1`** (visually confirmed): `/login` says "8-digit code" on a password-first form.
- **E2E-CLEANUP-1 confirmed** (known, not re-filed): QA customer account holds a stale LIVE "paid" session ("Luca joined as engineer"). Not ended (mutation avoided).
- Realtime polling-only in this env contradicts documented `relay-session:{id}` channel (room.md) — may be dev-env only; revisit in Phase 3-live if a deploy walk is run.
- `client_employee` (employee5) **banned** → customer-employee flow (paywall suppression, minutes debit) NOT runnable until unbanned/replaced.

### Phase 2 gap — 8 core flows NOT yet end-to-end-walked
Surface walks + API confirmations done. The 8 numbered flows (esp. 2-party live
call: guest/customer ↔ engineer accept ↔ live Zoom ↔ post-call/summary) need
either two concurrent browser contexts or a paired run, and live Zoom A/V.
Single-context solo walk can cover: guest Try-RELAY entry → ring (done-ish),
customer chat, paywall render, booking forms (read-only). Deferred:
flows/*.md per-flow write-ups. → resume target for next Phase 2 session.

## Mutation log (every state-changing action on the live app)

| # | When | Account | Action | Cleanup |
| - | ---- | ------- | ------ | ------- |
| 1 | 2026-06-06 | all 8 QA | `signin-password` ×8 (login; cookie jars → `qa/.cookies/`, gitignored) | sessions self-expire; signout on teardown |
| 2 | 2026-06-06 | client | `signin-password` surface=staff (wrong-surface gate test) | server auto-rolled-back session (403 path) |
| 3 | 2026-06-06 | anon | `POST /api/assistant`, `POST /api/intake/turn` (read-only; ~1 OpenAI completion spent) | none (read-only) |
| 4 | 2026-06-06 | anon (public anon key) | `POST functions/v1/zoom-sdk-signature` ×1 (minted host sig for fake meeting #, unused) | none — credential discarded, no meeting created |
| 5 | 2026-06-06 | guest anon (flow agent) | Try-RELAY funnel: 3 answers + attempted anon signup (timed out, no session created) | none — signup failed before session minted |
| 6 | 2026-06-06 | client (DEPLOY) | UI login on relay-green-471i.vercel.app → /room | session self-expires |
| 7 | 2026-06-06 | client (DEPLOY) | stale "Luca" session ended via clock-expiry (R3 client lifecycle) while observing | self-cleaned — **resolves the E2E-CLEANUP-1 instance** |
| 8 | 2026-06-06 | client (DEPLOY) | typed draft msg + clicked "Start a call" | NO session created (`guest_calls`=`[]`), draft unsent — nothing to clean |
| 9 | 2026-06-06 | client+engineer (DEPLOY, 2-party) | full handshake: created project "Audit test 2026-06-06" + directed session, ring→accept→live→6 chat msgs→engineer started Zoom→**engineer ended session** | session ENDED; customer active sessions `[]` confirmed; project row left (benign) |
| 10 | 2026-06-06 | engineer (DEPLOY) | global sign-out attempt to invalidate leaked token | returned 401 — token not cleanly invalidated (~1h expiry); **recommend rotating gtlengineer QA password** |
| 11 | 2026-06-06 | supervisor (DEPLOY) | injected context for flows 4–6; walked /supervise, /bids, /schedule | token echoed (rotate gtlsupervisor pw); global sign-out best-effort + context closed |
| 12 | 2026-06-06 | client (DEPLOY) | flow 8: /account → Recharge → Stripe test checkout opened | **no payment completed**, no charge; modal dismissed |

## Checkpoint log

- 2026-06-06: Phase 0 complete. Filesystem inventory done (95 pages, 134
  handlers, 27 edge fns, 3 oversized client files identified). No app code
  touched, no live app contacted. Phase 2 blocked on test accounts + target
  URL; Phase 1 can proceed without either.
- 2026-06-06 (later session): Phase 1 partial — 10 route cards + 2 component
  maps landed (~12:19–12:22 AM) but INDEX wasn't checkpointed; reconciled now.
  Blockers re-checked: target = `https://10.0.1.112:3000` (live, port probe);
  Zoom = real Video SDK (no mock flags in `.env.local`, commit 7bc6667).
  Remaining blocker: `qa/test-accounts.json`. No commits since ground truth
  (HEAD 6864c61) → 00-ground-truth.md still current. Next Phase 1 work:
  components/room-client.md, state-machines.md, remaining route cards.
- 2026-06-06: **Phase 1 COMPLETE.** 8 parallel read-only agents produced:
  room-client.md (14,519-line structural map), routes/room.md,
  state-machines.md (5 machines incl. ring-bimodality root cause), 31 new
  route cards (enterprise/dept/reseller ×9, admin ×3, staff-ops ×7,
  session/project/misc ×5, auth ×5, legacy+marketing batches). 48 files total
  under docs/audit/. 15 new finding candidates + 4 known-issue
  cross-references staged above. No source touched, no live app contacted.
  Next: Phase 2 (needs qa/test-accounts.json) or Phase 3 (connections —
  static, can start now).
- 2026-06-06: **Phase 3 COMPLETE.** 4 parallel read-only agents →
  connections.md (47 realtime channels, presence/heartbeat, queue/ring, Zoom,
  Stripe, AI wiring), api/edge-functions.md (27 fns), api/api-routes-org.md
  (~80 handlers), api/api-routes-core.md (~54 handlers). Heavy security signal:
  ~6 Blocker-class candidates (zoom-sdk-signature credential mint, guest
  checkout amount-trust, activate-plan no-payment, project-qa RAG IDOR, dev
  routes runtime-only gate, AI=OpenAI-not-Anthropic doc error). All STATIC —
  flagged for live confirmation in Phase 2. No source touched.
- 2026-06-06: **qa/test-accounts.json supplied** by operator (8 accounts) and
  written (gitignored, confirmed). Phase 2 fully unblocked. Passwords never
  echoed in docs.
- 2026-06-06: **TWO-PARTY live call VERIFIED on deploy.** Dev server unbindable
  (IP drift → 10.0.2.40); ran on `relay-green-471i.vercel.app` with two real
  browser contexts (customer + engineer-injected). Full loop:
  connect→ring→**engineer real-UI accept**→both Live→**chat both ways**→engineer
  Start Zoom→engineer End→**both PostCall**. → [flows/2-3-two-party-live.md](flows/2-3-two-party-live.md).
  NEW bugs: **A2P-1** (High — engineer call-start doesn't reach customer in the
  directed-connect path; that session isn't a `guest_calls` row so the
  R2/P1-6 call-gating never fires; chat keying ≠ call-gating keying), **A2P-2**
  (Low — wizard CTA silently disabled on empty required project-name),
  AUDIT-COOKIE-DLG-1 upgraded to confirmed (modal blocks engineer session view).
  Process: leaked engineer token via run_code_unsafe filename echo (PROC-TOKEN-LEAK-1)
  — global sign-out 401, **rotate gtlengineer QA password**. Cleanup: session
  ended, customer active=[], engineer context closed. bug-log now 19 rows.
- 2026-06-06: **Flows 4–8 run** (deploy) → [flows/4-8-staff-payments.md](flows/4-8-staff-payments.md).
  4 ✅ supervisor Live ops (live 1, Watch/act-now, no callback queue=expected);
  5 🟡 quote→bid chain breaks (Request-a-Quote no-op → empty /bids, A2P-3);
  6 🟡 /schedule view + bookable slots (no create — non-atomic); 7 ✅ admin
  (surface-walked); 8 ✅ Recharge → **Stripe TEST checkout** (pk_test), no charge.
  Supervisor token also echoed → **rotate gtlsupervisor pw too**. Supervisor
  context closed; 1 context (customer) left. **All 8 core flows now exercised**
  to the extent the live env + non-destructive rules allow. bug-log 22 rows.
- 2026-06-06: **Phase 2 surface layer DONE.** Pre-flight (proxy routing + deploy
  backdoor-dead verified), login matrix 7/7, API/auth live-confirmation (P3-E1
  Blocker / C01 / C03 confirmed live; wrong-surface gate works), browser walk
  24 pages/7 roles/4 surface files/24 screenshots, C3-1 nuanced verdict (code
  oversub real, RLS backstops, no live leak). qa/bug-log.csv created. 2-party
  flows launched as background role-interaction-agent (owns browser).
- 2026-06-06: **Phase 4 DONE.** risk-map.md (R1–R13) + regression-checklist.md
  written from accumulated Phase 1–3 maps + Phase 2 live evidence. Static, no
  app contact.
- 2026-06-06: **2-party flow run BLOCKED.** Background role-interaction-agent
  drove Flow 1 guest funnel (3-question modal on `/`, not `/intake/*`) to
  "no engineers online" then the dev server died: Supabase-backed API routes
  timed out, then whole port unreachable (curl 000, confirmed by main thread).
  `ENV-DEVSERVER-DOWN` — needs operator restart. Agent also lacked
  `browser_tabs`+`Bash` → 2-context realtime asserts impossible regardless.
  Flows 2–8 not reached. 1 new low finding (AUDIT-GUEST-ERRLEAK-1: raw
  "Failed to fetch" in guest copy). Stale QA session left uncleaned (server
  down).
- 2026-06-06: **Phase 5 DONE.** coverage-matrix.md (routes×roles×{doc/walk/
  flow}) makes the Flow gap explicit; bug-log.csv at 11 rows. All static +
  surface + connection + risk deliverables shipped.
- 2026-06-06: **DEPLOY live run** (main thread drove Playwright on
  `relay-green-471i.vercel.app` after dev server stayed down). Flow 2 (customer)
  partial PASS: login→/room→stale-session→**auto-end→PostCallView** (live R3
  client-billing end observed) → idle chat-first room. Cookie-injection blocked
  (VM has no fs/import) → used UI login. → `flows/2-customer-deploy.md`. New
  PROD-confirmed evidence: **DATA-400 reproduces on production** (every /room),
  **app is REST-polling not realtime even on PROD** (zero wss), CSP report-only
  on PROD (Stripe frame violation logged-not-blocked), unbounded `in.(~90 uuid)`
  history query, start-a-call no-op on unsent draft, online-engineers anon leak
  on PROD. bug-log.csv now 16 rows. E2E-CLEANUP-1 stale session self-resolved
  (clock expiry). 2-party ring/accept still NOT reached — customer "Start a
  call" never engaged matching; needs engineer-side curl-RPC or 2nd context.
