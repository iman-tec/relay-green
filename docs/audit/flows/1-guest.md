# Flow 1 — Guest funnel ("Try RELAY")

> Target: `https://10.0.1.112:3000` (LAN dev, self-signed). Date: 2026-06-06.
> Driven via Playwright MCP (single browser context — see Blockers).
> Customer side = anonymous guest (no login). Engineer side = NOT reachable (see Blockers).

## Verdict: PARTIAL / BLOCKED

The guest funnel UI works end-to-end up to the match step. The actual
match + anonymous-session creation could NOT complete because (a) no engineer
was online and (b) the dev server lost connectivity to its API/Supabase layer
and then went fully unreachable mid-run.

## URL path

`/` (home) → "Try Relay" opens an in-page modal funnel (no route change; stays on `/`).
The 3-question funnel is a client dialog, not a `/intake` route. On match it
calls `/api/online-engineers`, then (fallback) an anonymous Supabase signup +
`start-guest-call`, intended to land on `/intake/matching/[id]` / `/room`.

## Steps with observed state

| # | Action | Observed state | Result |
| --- | --- | --- | --- |
| 1 | Load `/` | Home renders (hero "Try Relay", pricing, FAQ). 1 console error (CSP report-only notice — benign). | PASS |
| 2 | Click "Try Relay" (hero) | Modal dialog opens: **"What do you need right now?" — Question 1 of 3**, 3 radios (building / launch / maintain). Back+Continue disabled until pick. | PASS |
| 3 | Pick "I'm building — need help getting unstuck" → Continue | **Question 2 of 3 "What are you building with?"** — chip groups: AI tool (Claude/ChatGPT/Cursor/…), Backend (AWS/Vercel/Supabase/…), Frontend (React/Next.js/…). | PASS |
| 4 | Select Claude + Supabase + Next.js → Continue | **Question 3 of 3 "How soon do you need someone?"** — radios: Right now / This week / I'm planning ahead. | PASS |
| 5 | Pick "Right now — I'm stuck" → "Find my engineer →" | Dialog flips to **"MATCH FOUND — Finding an engineer who's shipped on your stack…"** (spinner). Fires `GET /api/online-engineers?technologies=Claude,Supabase,Next.js&need=stuck`. | PASS (UI) |
| 6 | (wait ~3s) | Dialog: **"No engineers online right now. (Failed to fetch)"** + buttons "← Back" / "Open the room →". `/api/online-engineers` had **timed out** (`net::ERR_CONNECTION_TIMED_OUT`), so "Failed to fetch". No engineer was online, so even a successful call would show "no engineers". | DEGRADED |
| 7 | Click "Open the room →" | Dialog: **"No engineers online right now. Hop into the room — we'll page someone the moment they're back."** → button shows **"Connecting you…"** (creating anon session). | PASS (UI) |
| 8 | (wait ~6s) | **Stuck on "Connecting you…".** Network: `POST /api/supabase/auth/v1/signup` → `net::ERR_CONNECTION_TIMED_OUT` (the anonymous guest sign-up). Guest never gets a session; never navigates to `/intake/matching/[id]` or `/room`. | BLOCKED |
| 9 | Diagnostics | Direct `fetch('/api/online-engineers')` aborted at 12s; `fetch('/login')` "Failed to fetch" in 808ms. Then **all navigation to `:3000` → `ERR_CONNECTION_TIMED_OUT`**. Server unreachable for 3.5+ min, no self-recovery. | SERVER DOWN |

## Mutation list

- None committed. The anonymous Supabase signup (`/api/supabase/auth/v1/signup`)
  **timed out**, so no guest user / `guest_calls` row is believed to have been
  created. (Could not verify DB state — no shell/DB access.) No cleanup needed.

## Screenshots

- `qa/screens/flow-1-match-no-engineers.png` — "No engineers online right now. (Failed to fetch)" modal.

## Findings

- **ENV-DEVSERVER-DOWN (blocker, environmental, not an app bug):** the dev
  server at `10.0.1.112:3000` served the home page and funnel UI fine
  (~20:21–20:25), then its server-side API routes that call Supabase began
  timing out (`/api/online-engineers`, `/api/supabase/auth/v1/signup` →
  `ERR_CONNECTION_TIMED_OUT`), and by ~20:26 the whole server stopped
  answering TCP on :3000 (all navigations `ERR_CONNECTION_TIMED_OUT`). Did not
  recover across ~3.5 min of retries. Cannot restart (no shell access). This
  blocks all 8 flows until the operator restarts `npm run dev`.
- **Guest funnel UX note (not a bug, but worth flagging):** when
  `/api/online-engineers` errors, the modal shows the raw "(Failed to fetch)"
  string to the user alongside "No engineers online right now." That parenthetical
  is a developer-facing error leaking into guest-facing copy.
- The funnel is a **client modal on `/`**, not a `/intake/*` route — the guest
  only reaches `/intake/matching/[id]` after the anon signup + start-guest-call
  succeed, which never happened here.

## What remains UNVERIFIED (needs server up + engineer online + 2nd context)

- Anonymous Supabase session creation and the `/intake/matching/[id]` ring page.
- Engineer (ctx B) receiving the ring and accepting.
- Guest landing in `/room`, post-call view, paywall on exhausted free minutes.
</content>
</invoke>
