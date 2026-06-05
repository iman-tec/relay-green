# Flows 2 + 3 — TWO-PARTY live handshake (customer ↔ real engineer UI), PRODUCTION

> Target **`https://relay-green-471i.vercel.app`** (deploy; dev server unbindable
> — IP drift to 10.0.2.40). Driven by main thread via Playwright MCP with **two
> real browser contexts**: ctx A = customer (`gtlcustomer`/"Rohan Mehta"), ctx B =
> engineer (`gtlengineer`, injected session → real `/dashboard`). Date 2026-06-06.
> Every step is a real UI interaction in the real deployed app. Mutations logged.

## Result: core loop WORKS two-party; ONE real call-start propagation bug

| # | Step | Customer (ctx A) | Engineer (ctx B, real UI) | Verdict |
|---|---|---|---|---|
| 1 | Customer "Connect to a Relay engineer" → wizard | new project → Q1 "I'm building" → Q2 techs (Claude+Supabase+Next.js+React) → Q3 "Right now" → **required project-name field** → "Find my engineer" | — | ✅ (see A2P-2) |
| 2 | "Pick your engineer" → Connect to **gtlengineer** | → `/intake/matching/<id>` "Looking for an engineer…" | — | ✅ ring sent |
| 3 | **Ring propagation** | ringing | dashboard shows **"Ringing"** + "Sound on" + full-screen **EngineerIncomingMatch**: "Incoming match — Building: Website — Supabase·Next.js·React — Decline/Accept" (21s countdown) | ✅ **cross-role propagation incl. intake tech tags** |
| 4 | Engineer **Accept** | `/room` → state **"Live"** | → real workspace **`/staff/session/b9c183eb…`**, "Project memory · Audit test 2026-06-06" | ✅ both live |
| 5 | **Chat both ways** | sends `cust2eng AUDIT…` → appears on engineer | engineer reply `eng2cust AUDIT…` → appears on customer | ✅ **bidirectional (≈4.5s poll)** |
| 6 | Engineer **"Start a Zoom meeting"** | — | engineer → **"on call"** | ⚠️ engineer side OK |
| 7 | **Customer join after call-start** | join button **stuck DISABLED: "Waiting for your engineer to start the call"** ≥30s | on call | ❌ **A2P-1 — call-start does NOT propagate to customer** |
| 8 | Engineer **End session** | → **"summary"** (PostCallView) | → **"review"** | ✅ end→PostCall both sides |
| 9 | Teardown | no lingering active session (`guest_calls` active = `[]`) | context closed; global sign-out 401 (token not cleanly invalidated) | ✅ clean / ⚠️ token |

Screenshots: ⚠️ these were captured but **did NOT persist** (MCP temp cleared on
browser relaunch — see INDEX "Evidence note"). The authoritative evidence is the
DOM-snapshot / network / console observations recorded in the table above and in
the session transcript (e.g. engineer overlay text "Incoming match — Building:
Website — Supabase·Next.js·React", customer button aria-label "Waiting for your
engineer to start the call", `guest_calls` returning `[]`). The
`flow3-engineer-session.png` cookie-modal-over-session image was Read back as an
image mid-session (confirming the live engineer UI) but is not on disk now.

## Findings

### A2P-1 (NEW, Medium-High) — engineer call-start doesn't reach the customer (directed-connect path)
In the **directed "Pick your engineer → Connect"** flow, after the engineer clicks
**"Start a Zoom meeting"** and goes "on call", the customer's call button stays
**disabled — "Waiting for your engineer to start the call"** for 30s+ (well past the
~1–2s poll). The customer **cannot join** the call the engineer started.
- **Root-cause hypothesis (not fully asserted):** this directed-connect session is
  **not a `guest_calls` row** — `guest_calls?id=eq.b9c183eb` and
  `?customer_user_id=eq.<uid>` both returned `[]` from both contexts, yet chat
  crossed fine (messages keyed by a different `guest_call_id`). The customer room's
  call-join gating keys off `guest_calls` fields + the "Zoom meeting started"
  system-message string (R2 / P1-6); this path doesn't populate them → button never
  enables. **Chat uses one keying, call-gating another — they disagree.**
- **Links:** risk-map **R2** (string-protocol call gating), **P1-6**, and a NEW
  structural split: directed-connect vs guest_calls/intake session models.
- Contrast: the **stale guest_calls session** earlier (flows/2-customer-deploy.md)
  DID show the join button **enabled** — so the bug is specific to the directed
  connect path's session model, not all sessions.

### A2P-2 (NEW, Low UX) — "Find my engineer" silently disabled on empty required field
The connect-wizard final CTA "Find my engineer →" stays `disabled` with **no error,
asterisk, or hint** until the **project-name** text field (placeholder
"e.g. ATLAS Project, Acme Landing, Mobile MVP") is filled. Looked like a dead-end
for ~6 probes before the cause was found. Cousin of `AUDIT-STARTCALL-NOOP-1`.

## Positive confirmations (the loop largely works two-party)
- Ring → engineer real dashboard ring overlay **with the customer's intake data**.
- Accept → both transition live (real engineer workspace + customer room).
- **Bidirectional chat** confirmed by unique stamp in both DOMs.
- End → **both** sides reach PostCall (customer "summary" / engineer "review").
- Project name + tech tags propagate into the engineer's session ("Project memory").

## Mutation log (this run)
| Action | Persisted? | Cleanup |
|---|---|---|
| Customer created project "Audit test 2026-06-06" + directed session | project row persists; session **ended** | session ended (step 8); project row left (benign test row) |
| ~6 chat messages (cust+eng, "AUDIT…" stamped) | in session transcript (ended) | n/a — ended/read-only |
| Engineer started a real Zoom meeting | meeting created | ended via End session |
| Engineer session token leaked to transcript (setup step) | — | global sign-out returned 401; token expires ~1h. **Recommend rotating `gtlengineer` QA password.** |

## Coverage delta
Flows 2 + 3 are now **end-to-end two-party verified** (ring→accept→live→chat→end),
EXCEPT live Zoom **A/V media** (no mic/cam in headless — state transitions only) and
the **customer-join-after-call-start step which is BROKEN (A2P-1)** on this path.
