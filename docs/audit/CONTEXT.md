# Relay.green — Team Context & Do-Not-Break Entry Point

> **Read this first.** Any human or AI session (incl. Claude Code) starts here
> before optimizing code or decommissioning legacy. It orients you to load-bearing
> behavior so you don't break it. It does NOT restate the audit — it points to the
> canonical docs and flags where code and docs disagree.
>
> Canonical sources (this file summarizes; THEY are truth):
> [INDEX.md](INDEX.md) · [risk-map.md](risk-map.md) (R1–R13) ·
> [regression-checklist.md](regression-checklist.md) · [coverage-matrix.md](coverage-matrix.md) ·
> [bug-log.csv](bug-log.csv) (committed snapshot; live local copy is gitignored
> `qa/bug-log.csv`) · [flows/](flows/) ·
> route cards [routes/](routes/) · [connections.md](connections.md) ·
> [api/](api/) · [components/](components/) · [state-machines.md](state-machines.md)

## TL;DR — before you change anything

1. **Read the touch-area row** in "Don't break this" below + the matching section of
   [regression-checklist.md](regression-checklist.md). Run those checks after your change.
2. **dev and prod share ONE Supabase backend** (project ref `vdduelvjrzeczmakxgpn`).
   A write from your local `npm run dev` hits the SAME data as `relay-green-471i.vercel.app`.
   Log every mutation (INDEX.md "Mutation log") and clean up after yourself.
3. **Don't trust the docs blind.** CLAUDE.md / PROJECT_CONTEXT call the AI stack
   "Anthropic Claude" — that is FALSE in code (it's OpenAI + Groq, see below).
   When a doc and the code disagree, the **code wins** — flag it, don't propagate it.
4. **Two things are exploitable by anyone right now** (see Open Findings): the Zoom
   signature edge fn (public anon key → host creds) and `/api/assistant` (no auth →
   OpenAI spend). Don't assume "internal".
5. **Realtime is actually REST-polling** in dev AND prod (zero websockets observed).
   The documented `relay-session:{id}` realtime channels are wired in code but not the
   live transport — don't reason about timing from "realtime".

## Architecture orientation

| Aspect | Reality (verified) | Source |
|---|---|---|
| Framework | Next.js **16** + React **19** + Tailwind **v4**, App Router, Turbopack. `proxy.ts` (root) replaces `middleware.ts`. `reactStrictMode:false` on purpose (Zoom SDK singleton). | CLAUDE.md, next.config.ts |
| Hosting | Vercel. Prod deploy `https://relay-green-471i.vercel.app`. Dev `https://10.0.1.112:3000` (LAN, self-signed; IP also in playwright.config + next.config `allowedDevOrigins`). | 00-ground-truth §8 |
| Data/auth/realtime | **Supabase** (`@supabase/ssr`). **Prisma is NOT wired** (`lib/db.ts` throws). `supabase/migrations/` is authoritative; `prisma/schema.prisma` is doc-only. | CLAUDE.md |
| **Same backend dev≡prod** | Both point at Supabase ref `vdduelvjrzeczmakxgpn`. Same accounts, same rows, same stale sessions. | live-confirmed (login + UUID match on both) |
| Auth cookie | One JS-readable (non-httpOnly) cookie `sb-vdduelvjrzeczmakxgpn-auth-token` (~2700 chars) + `relay-theme-geo` (manual `relay-theme-user` wins). QA login: `POST /api/auth/signin-password {email,password,surface}`. | live-confirmed |
| **AI stack** | **OpenAI** (`api.openai.com` — `gpt-4o`, `gpt-4o-mini`, `whisper-1`) + **Groq** (`api.groq.com` — `llama-3.x`). **NO Anthropic/Claude anywhere.** | grep: score-session-health:240, summarize-*, transcribe-chunk:104, regenerate-guest-brief:74 |
| Zoom call path | Video SDK is the DEFAULT surface (commit 7bc6667). Legacy Meeting SDK is fallback, gated by `isVideoSdkEnabled()`. Lifecycle via edge fns (`zoom-video-sdk-token`, `create-zoom-meeting`, `end-zoom-meeting`, webhooks). Call-join UI partly keys off literal system-message strings ("Zoom meeting started/ended") + a session-row fallback. | risk-map R1/R2, connections.md |
| Realtime vs polling | Code wires Supabase realtime channels (47 `.channel()` sites) BUT the live transport is **REST polling** (`/api/supabase/rest/v1/...` every ~1–2s); zero wss seen dev or prod. | AUDIT-REALTIME-POLLING-1, R5 |
| Roles (7) | super_admin→reseller→enterprise_admin→department_admin→supervisor→engineer→client. 4 login surfaces: customer `/login`→`/room,/account`; staff `/staff`→dashboard/inbox/supervise/admin/…; partner `/partner`→`/reseller`; business `/business`→`/enterprise,/department`. | 00-ground-truth §2-3, proxy.ts |

## Open findings — prioritized (source: qa/bug-log.csv, 15 rows)

> ⭐ = exploitable by anyone with the public anon key or less — fix before any "it's internal" assumption.

| ID | Sev | Area | Repro (short) | Evidence |
|---|---|---|---|---|
| ⭐ **AUDIT-ZOOM-SIG-1** | **Blocker** | auth | `POST {SUPABASE}/functions/v1/zoom-sdk-signature` with **only the public anon key**, no user JWT, `{meetingNumber:any, role:1}` → 200 + valid **host** Meeting-SDK signature | bug-log r2; verify_jwt=false config.toml:47-48 |
| ⭐ **AUDIT-ASSISTANT-OPEN-1** | High | api | `POST /api/assistant` **unauthenticated** (no key needed at all) → full gpt-4o-mini completion (cost-abuse/DoS). `/api/intake/turn` same class. | bug-log r3 |
| AUDIT-ONLINE-ENG-LEAK-1 | Med | idor | `GET /api/online-engineers` anon → engineer real UUID+PII (dev AND prod) | bug-log r4 |
| AUDIT-DATA-400-1 | Med | api | `/room` + `/dashboard` `projects?select=…,completion_status,completed_at` → **400, 4×/poll**, silent fallback. **PROD-confirmed.** | bug-log r5; screens/deploy-client-room-stale.png |
| AUDIT-SUPALERTS-OVERSUB-1 | Med | authz | StaffShell mounts SupervisorAlerts for any `!isEngineer` → reseller/ent/dept admins attempt global guest_calls/escalation subs. No live leak today (RLS `[]` + polling), 1 RLS regression from a breach. | bug-log r10; StaffShell.tsx:485-500,1240-1346 |
| E2E-CLEANUP-1 | Med | e2e | Stale "paid/live" session lingers on accounts (self-resolved once via clock expiry) | bug-log r13 |
| AUDIT-REALTIME-POLLING-1 | Low | realtime | No wss; REST polling is the live transport, prod incl. | bug-log r6 |
| AUDIT-STARTCALL-NOOP-1 | Low | ux | `/room` idle: type draft + "Start a call" (unsent) → silent no-op, no session, no feedback | bug-log r7 |
| AUDIT-BULK-IN-QUERY-1 | Low | api | history reads use `guest_call_id=in.(~90 UUIDs)`, grows per customer | bug-log r9 |
| AUDIT-LOGIN-COPY-1 | Low | ux | `/login` says "8-digit code" over a password form (dev+prod) | bug-log r11; screens/client-login.png |
| AUDIT-GUEST-ERRLEAK-1 | Low | ux | Try-RELAY renders raw "(Failed to fetch)" into guest copy when online-engineers fails | bug-log r15 |
| AUDIT-COOKIE-DLG-1 | Low | ux | cookie-consent dialog reported double-mounted (UNVERIFIED) | bug-log r12 |
| AUDIT-CSP-REPORTONLY-PROD-1 | Info | security | CSP is Report-Only on PROD (Stripe frame violation "logged, not blocked") — a firing XSS is NOT blocked | bug-log r8 |
| SEC-AUTH-12 | Pass | auth | dev backdoors (`/api/dev/*`,`/api/test/auth`) → **403 dead on deploy** ✅ | bug-log r14 |
| ENV-DEVSERVER-DOWN | env | infra | dev `npm run dev` died mid-run (not an app bug) | bug-log r16 |

## Legacy & decommission landmines

> Deleting any of these "blind" breaks something or leaves a hole open. Read before you cut.

| Thing | Looks like | Why blind delete/ignore is dangerous | Safe move |
|---|---|---|---|
| **`zoom-sdk-signature` edge fn** | legacy Meeting-SDK path; Video SDK is default | It is **live + reachable with the public anon key** (verify_jwt=false). **Removing the UI caller does NOT close it** — the function stays deployed and exploitable (mints host signatures). | Remove/lock the **function itself** (delete + drop `[functions.zoom-sdk-signature]` from config.toml, or add ownership auth). Don't stop at the frontend. |
| **Documented realtime channels** (`relay-session:{id}`, 47 `.channel()` sites) | "unused" — live transport is polling | **Don't delete blind:** code still subscribes; removing channels may break the intended path or a future realtime enable. **Don't re-enable blind:** polling masks bugs (INSERT-only sub, no reconnect refetch = CHAT-LOSS-1; spread-merge needs `REPLICA IDENTITY FULL`). | Decide explicitly: keep polling OR fix-then-enable realtime with R5 checks. Document which. |
| **Schema-drift columns** `completion_status` / `completed_at` / `contract_type` | client queries them; they 400 | Client `projects`/`guest_calls` selects reference columns the live schema lacks → **silent 400 + empty fallback**. Any query "cleanup" that drops them hides data the UI was supposed to show; any migration that adds them changes behavior silently. | Reconcile query ↔ schema deliberately (add columns OR fix selects), then confirm no 400 on `/room`+`/dashboard` and KPIs show real numbers. |
| `/payment/success`, RoomClient dead components (ReviewPanel, ReadOnlyChatPane, ChatHistoryView), reseller `_drawers/`, Dashboard CallsWaitingBox, FinanceClient SalariesSection | orphaned/dead | Mostly safe to remove, BUT several "orphan" APIs (`reseller/.../refill`, `enterprise/regenerate-code`, `wallet/activate-plan`) have NO UI caller yet are **reachable + some unsafe** (activate-plan grants paid tier w/o payment). Don't assume "no caller = harmless". | Cross-check each against api/ docs + INDEX P1-13/P3-O07 before removing; lock unsafe orphan endpoints rather than just hiding UI. |
| Legacy pages `/customer`,`/engineer`,`/supervisor`,`/widget/*` | "Prisma-stub, will throw" | They do NOT throw — they redirect / return null / live electron bridge. The scary "Prisma is no longer wired" framing is inaccurate for these. | See routes/legacy-batch.md before touching; verify the redirect target still exists. |

## Don't break this — gated by touch area

> Mirror of [regression-checklist.md](regression-checklist.md) + [risk-map.md](risk-map.md). Run the row's checks after editing that area.

| If you touch… | Re-check (risk) |
|---|---|
| call / Zoom / `lib/video/` / StrictMode / room layout | `reactStrictMode:false` stays; one Zoom client per tab, no double-init; call open/close ×3 no leak; customer join-button enables after engineer starts; system-message strings changed in BOTH edge fn + RoomClient (R1, R2, R12) |
| billing / pricing / `sessionClock` / paywall / webhooks | free-cap ends once; tab-kill → server sweeper ≤90s; paid pivot stamps once; webhook replay → one effect; webhook secret unset → REJECT; activate-plan/topup w/o payment → 402/403 (R3, R8) |
| matching / queue / ring / offers | tier escalates ~31s; **customer closes matching tab → escalation still advances?** (today NO); FIFO auto-ring 30s post-end (R4) |
| realtime / presence / heartbeat / chat sub | no msg loss on reconnect (CHAT-LOSS-1); `REPLICA IDENTITY FULL` on spread-merged tables; presence flips offline on tab close (R5) |
| `proxy.ts` / auth surfaces / new protected page | unauth prefix → 307 to correct login; wrong-surface creds → 403; new page in right `*_PREFIXES` **AND** has server guard (`/staff/assistant` gap); reseller/ent admin attempts no guest_calls sub (R6, R9) |
| edge functions / `config.toml` / webhooks | `zoom-sdk-signature` anon → 401/403; every `verify_jwt=false` fn has internal gate or is intentionally public+harmless; no raw `err.message` to client; webhook verify fails CLOSED (R7, R8) |
| booking SQL / `/calendar` / `/schedule` | concurrent identical-slot → one succeeds; overlapping different-start → ideally one (today both, FUNC-BOOK-ATOMIC-1) (R10) |
| `projects` queries / migrations | no 400 on `projects` selects; KPI tiles real not silent-zero (R11) |
| any user-supplied content render (chat/names/intake) | `<script>`/`<img onerror>` does not execute on the other party — **CSP is Report-Only, won't save you** (R13) |
| dev LAN IP | update all three: package.json `-H`, playwright.config baseURL, next.config `allowedDevOrigins` |

## Coverage — verified vs not

| Layer | State |
|---|---|
| Static map (routes, components, state machines) | ✅ 41 route cards, 3 component maps, state-machines.md |
| Connections + API/edge contracts | ✅ connections.md + api/ (27 edge fns, ~134 handlers) |
| Risk map + regression checklist | ✅ R1–R13 + gated checklist |
| Surface walk (7 roles, 24 pages) | ✅ walks/ + 26 screenshots; zero crashes; nav role-filters match |
| API/auth live-confirmation | ✅ login matrix 7/7, proxy routing exact, backdoors dead on deploy, ⭐ findings confirmed live |
| **2-party live call (ring→accept→Zoom A/V→cross-role chat→end)** | ❌ **NOT verified.** Customer "Start a call" never reached ring; one MCP browser = one auth. Needs engineer-side curl-RPC driving OR a 2nd context. See coverage-matrix.md re-run reqs. |
| Flows 1 (guest), 2 (customer) | 🟡 partial: guest funnel→"no engineers"; customer login→/room→auto-end→PostCallView (prod) |
| Flows 3–8 (engineer, supervisor, quote/bid, bookings, admin, payments) | 🟡 surface-level only; not end-to-end |

## Conventions for AI sessions on this repo

- **Read before write.** Source is read-only during audit-style work; this file + the
  touch-area row first. Real changes: run the gated re-checks.
- **Shared dev≡prod backend.** Any DB write is real and visible to everyone. Use only
  QA accounts (`qa/test-accounts.json`, gitignored — never print passwords). Log every
  mutation in INDEX.md "Mutation log"; clean up sessions/rows you create.
- **No secrets in transcripts.** Read via `process.env`; redact to first/last 4 chars.
  Don't paste cookie/session tokens or `qa/test-accounts.json` contents.
- **One finding = one bug-log row** (`qa/bug-log.csv`, the ORCHESTRATION §6 columns).
  Cross-reference known IDs (E2E-CLEANUP-1, CHAT-LOSS-1, CHAT-LOCK-1,
  FUNC-BOOK-ATOMIC-1, ring-latency, SEC-API-PROXY-SCHEMA-1) — never re-file.
- **When code and a doc disagree, the code wins** — and flag the doc.

---
_Last updated: 2026-06-06 (HEAD 6864c61). **Keep in sync:** when you change a
load-bearing path, update [INDEX.md](INDEX.md), [risk-map.md](risk-map.md),
[bug-log.csv](bug-log.csv), and this file. Stale orientation is worse than none._
