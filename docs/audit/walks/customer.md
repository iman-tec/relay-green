# Phase 2 Browser Walk — Customer surface (`client`)

> Target: `https://10.0.1.112:3000` (LAN dev, self-signed cert — bypassed via Chrome
> "Proceed (unsafe)" interstitial; exception now stored in the MCP persistent profile).
> Date: 2026-06-06. Role: `client` (gtlcustomer@yopmail.com). OBSERVE-MOSTLY.
> Passwords never printed.

## Login (`/login`)

- **URL/title**: `https://10.0.1.112:3000/login` — "Sign in to Relay".
- **Auth model**: the page copy says "Enter your email — we'll send you an 8-digit
  code" but the form is **password-based** (email + password + Sign in), plus
  Google/GitHub OAuth and a "First time signing in?" affordance and "Forgot password?".
  Password login used (per task), POST `/api/auth/signin-password` → **200**.
- **Cookie consent**: a "We value your privacy." dialog renders **twice** (two
  stacked `role=dialog` cookie banners, refs e66 + e78). The duplicate overlay
  intercepts pointer events — a normal click on "Accept & Continue" **times out**
  (element-intercepts-pointer); had to dismiss both via JS. Minor UX/a11y bug.
- **Console**: 1 error (CSP `upgrade-insecure-requests` ignored in report-only mode —
  benign), CSS-preload warnings (benign).
- Screenshot: `qa/screens/client-login.png`.

## `/room` (landing — live engagement surface)

- **URL/title**: `/room` — "Session — Relay.green".
- **State on entry**: the account already had a **pre-existing `live` session**
  (status pill **"Live"**, timer `00:24` labelled **"paid"**, system row
  "👤 Luca joined as engineer"). Not created by me.
- **Chat-first call gating (Priority verification #2 — CONFIRMED)**: the green call
  button is **disabled** and labelled **"Waiting for your engineer to start the
  call"** even though the session is `live`. Matches room.md: enabled only when
  `engineerOnCall && (isLiveish || apptReady)`; here the engineer has joined the
  *session* but has not *started the Zoom call*, so `engineerOnCall` is false and the
  customer has **no start-call path** — join only. Chat-first/call-second confirmed.
  - "Add participant" → **disabled** ("coming soon").
  - "More actions" (⋯) → present, inert.
  - "End session" (red) → **enabled** (NOT exercised — would mutate).
  - Chat composer present: textarea, attach (10 MB/file, 3 max), Dictate, Record
    voice, Send (Send disabled when empty). NOT exercised.
- **Layout**: collapsed left sidebar (Home / Search sessions / Current session /
  user "R" pill), center session column + chat, right "Session summary" rail
  (collapsed). Matches the documented chat-first room.
- **Stripe**: `js.stripe.com/v3` loads on /room in **test mode**
  (`pk_test_51QjPWD…`). Framed under report-only CSP `frame-src 'self'` → logged-only
  violations (no enforcement). Stripe telemetry POSTs to m./r.stripe.com.

### Network / realtime (customer)
- REST goes through the same-origin proxy `/api/supabase/rest/v1/...` (per
  `lib/supabase/browser.ts`).
- **No Supabase realtime WebSocket observed.** The page instead **polls**: repeated
  GETs to `guest_calls?...status=in.(queued,assigned,…)` and `projects?...` every few
  seconds. A `window.WebSocket` interceptor installed immediately after a fresh reload
  (before React hydration) caught **zero** sockets over 10 s; an offline→online
  dispatch produced no reconnect. Per the browser client comment, realtime would dial
  `wss://<project>.supabase.co` directly (not proxied) — none seen here. Net: customer
  live-updates appear to run on **REST polling**, not realtime, in this environment.
- **BUG (data) — projects select 400**: `GET /api/supabase/rest/v1/projects?select=
  id,name,created_at,ai_summary_title,ai_summary_overview,ai_next_steps,summary,
  summary_updated_at,completion_status,completed_at&customer_id=eq.<uid>` returns
  **400 Bad Request**, repeatedly. The client then refetches the **same select minus
  `completion_status,completed_at`** → **200**. So the room's two-tier
  retention-column fallback (room.md "two-tier select w/ retention-column fallback")
  is **actively firing** — `completion_status`/`completed_at` columns are missing on
  this DB's `projects`, generating a steady stream of 400s on every poll. Page does
  not crash (fallback keeps it alive) but it is noisy and wasteful.

- Screenshot: `qa/screens/client-room.png`.

## `/account` (profile)

- **URL/title**: `/account` — "Your profile". Renders fully, no crash.
- **Sections**: Identity (name "Rohan Mehta", email `gtlcustomer@yopmail.com` —
  "Email can't be changed", expertise "Non-technical", Change photo), **Wallet**
  ("Paid plan · **118.67 min remaining**", Recharge), Field of interest (8
  checkboxes), Security (Reset password → emails a link), Save changes, Back to room.
- **Controls present, NOT exercised** (would mutate): Change photo, Recharge, Reset
  password, checkboxes, Save changes.
- **Console**: only benign CSP report-only / Stripe-frame errors. No realtime.
- Screenshot: `qa/screens/client-account.png`.

## Divergences & findings

1. **DATA-400 (new):** `projects` select including `completion_status,completed_at`
   → **400** on every customer poll; client silently falls back to the shorter
   select. Schema drift between RoomClient's preferred select and the live
   `projects` table. Noisy but non-fatal. (Cross-ref room.md "retention-column
   fallback" / "Stats query fails silent if projects.contract_type is pre-migration".)
2. **REALTIME (new/contradicts room.md):** customer `/room` shows **no realtime
   WebSocket** — it polls REST. room.md documents a `relay-session:{id}` realtime
   channel; in this environment that channel did not open a visible socket. Relevant
   to EDGE-03 (realtime-blocked fallback) — polling fallback appears to be the
   *default* here, not an exception.
3. **UX cookie banner (new):** the cookie-consent dialog mounts **twice**, stacked;
   the top copy intercepts clicks on the underlying "Accept & Continue". A11y/UX bug.
4. **Auth copy mismatch (minor):** `/login` says "we'll send you an 8-digit code"
   but the surface is password-first. Stale copy.
5. **Chat-first gating CONFIRMED** (Priority #2): customer cannot start a call; green
   button stays "Waiting for your engineer to start the call" while engineer is in
   the session but not on the Zoom call. No crash / no Prisma stub anywhere.

## client_employee (employee5@yopmail.com) — BLOCKED (banned)
Confirmed live via the form's backing endpoint: POST `/api/auth/signin-password`
(`surface:"customer"`) → **400 `{"error":"User is banned"}`**. The department-employee
customer walk (employee paywall-suppression, minutes-debit) could NOT be run. Matches
the known operator note from Phase 1; no session created.

## Mutations performed
- Customer login (POST `/api/auth/signin-password`, 200) — session only. No data
  created/edited/deleted. No call started, no session ended, no recharge.
- employee5 login attempt → 400 banned (no session).
