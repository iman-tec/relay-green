# Regression Checklist — Run Before You Ship

> The "must-not-break" list. Distilled from [risk-map.md](risk-map.md). Each
> section is gated by *what you touched* — run the section if your change is in
> its trigger area. ☐ = verify green before merge/deploy. Anything that ends a
> session, charges a card, or mints a credential is a Blocker if it regresses.

## ALWAYS (every deploy — the 12-point smoke, from ORCHESTRATION §5)

- ☐ `/` loads; "Try RELAY" mints a guest anon session (`signInAnonymously` →
  `/intake/matching/[id]`).
- ☐ Customer login → `/room`; engineer login → `/dashboard`; super_admin →
  `/admin/v2`; supervisor → `/supervise`; enterprise_admin → `/enterprise/v2`;
  dept_admin → `/department/v2`; reseller → `/reseller/v2`. (Phase-2 login matrix.)
- ☐ Customer queues → engineer rings → accept → both join → call goes **live**.
- ☐ Chat crosses live both ways (cross-role realtime).
- ☐ Engineer ends → both see PostCallView + session-review has a summary.
- ☐ Paywall on exhausted free; Stripe test card `4242…` pays; session resumes.
- ☐ `client` CANNOT reach `/admin/v2` or `/api/admin/*` → 302/403.
- ☐ No service-role / Stripe-secret / OpenAI key in the client bundle.
- ☐ Logout clears session; protected route → its login surface.
- ☐ **Dev backdoors dead on the DEPLOY target** (`/api/dev/sign-in-as`,
  `/api/test/auth` → 403). (Phase-2: currently PASS on Vercel.)
- ☐ No console errors / white screens on the core path; theme renders.
- ☐ `/supervise` loads with a live session visible.

## IF you touched call / Zoom / `lib/video/` / StrictMode / room layout  → R1, R2, R12

- ☐ `reactStrictMode: false` still set in `next.config.ts`.
- ☐ One customer + one engineer in the same session → exactly ONE Zoom client per
  tab, A/V connects, no duplicate/ghost participant.
- ☐ Open/close the call surface 3× → no leaked client, no re-init.
- ☐ Screen-share tile still portals.
- ☐ After engineer starts call, customer green button enables within one poll
  (R2 — and if you changed a Zoom system-message string, you changed it in BOTH
  the edge fn and RoomClient, preferring the session-row signal).
- ☐ Full customer flow → no double-fired `mark_joined` / `end_session` in network.
- ☐ Panel widths persist across reload (`autoSaveId` intact).

## IF you touched billing / pricing / session clock / paywall  → R3, R8

- ☐ Free session hits cap → `end_session` fires once; reopen tab → resumes, no
  double-charge.
- ☐ Kill the tab mid-free-session → server sweeper ends it within ≤90 s.
- ☐ Paid pivot stamps `paid_extension_at` exactly once (no double-stamp on remount).
- ☐ Replay a Stripe/Zoom webhook event twice → exactly ONE billing effect (dedup).
- ☐ Unset a webhook secret in a test env → handler REJECTS (no fail-open).
- ☐ `wallet/activate-plan` / `wallet/topup` without a verified payment → 402/403,
  no tier grant, no double-credit.

## IF you touched matching / queue / ring / offers  → R4

- ☐ Customer queues, tier-1 engineer ignores → next engineer rings within ~31 s.
- ☐ Customer queues then CLOSES the matching tab → escalation behavior unchanged
  or improved (today it STALLS — do not make worse; ideally add a server cron).
- ☐ FIFO auto-ring fires 30 s after a session ends (engineer present + queue
  non-empty).
- ☐ `EngineerIncomingMatch` 2 s poll fallback still fires if realtime drops.

## IF you touched realtime / presence / heartbeat / chat sub  → R5

- ☐ Chat both directions while toggling network offline→online → no message loss
  after reconnect (don't regress CHAT-LOSS-1 further).
- ☐ `guest_calls` (and any spread-merged UPDATE table) has `REPLICA IDENTITY FULL`.
- ☐ Engineer closes tab → presence flips offline within the heartbeat reap window.
- ☐ Channel names/filters unchanged unless intentional; supervisor still gets
  escalation toasts.

## IF you touched `proxy.ts` / auth surfaces / a new protected page  → R6, R9

- ☐ Unauth GET each protected prefix → 307 to the correct login surface.
- ☐ Wrong-surface creds → 403 `wrong_login_surface` (server gate).
- ☐ Any NEW protected page: its prefix is in the right `*_PREFIXES` set AND it has
  a server-side guard (don't trust the proxy alone — cf. `/staff/assistant` gap).
- ☐ Reseller / enterprise_admin browser: no `guest_calls` / `session_escalations`
  realtime subscription attempted (R9 — after the allow-list fix).

## IF you touched edge functions / `config.toml` / webhooks  → R7, R8

- ☐ `zoom-sdk-signature` anon POST → 401/403 (must NOT mint a host signature).
- ☐ Every `verify_jwt=false` function has an internal auth/ownership gate OR is
  intentionally public + harmless (document which).
- ☐ No function returns raw `err.message` / DB error text to the client
  (SEC-API-PROXY-SCHEMA-1 family).
- ☐ Webhook signature verify FAILS CLOSED when the secret is unset.

## IF you touched booking SQL / `/calendar` / `/schedule`  → R10

- ☐ Two concurrent identical-slot bookings → exactly one succeeds.
- ☐ Two concurrent overlapping different-start bookings → ideally one (today both
  succeed; don't regress, prefer an exclusion constraint).

## IF you touched `projects` queries / ran a migration  → R11

- ☐ `/room` + `/dashboard` network shows NO 400 on the `projects`
  (`completion_status` / `contract_type`) selects.
- ☐ Dashboard KPI tiles show real numbers, not silent zeros from the fallback.

## IF you render any user-supplied content (chat, names, intake)  → R13

- ☐ `<script>` / `<img onerror=…>` in chat / project name / intake answers does
  NOT execute when rendered to the other party (CSP is Report-Only — it will NOT
  save you; a firing XSS is a Blocker).
- ☐ `/api/assistant` + `/api/intake/turn` require auth + rate limit (before prod).

## Tooling

- ☐ `npm run verify` (lint + typecheck + format:check) green.
- ☐ `npx playwright test` (sequential, `workers:1`) — existing specs pass.
- ☐ If you changed the dev LAN IP: update all three — `package.json` dev `-H`,
  `playwright.config.ts` baseURL, `next.config.ts` `allowedDevOrigins`.
