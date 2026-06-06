# Flows 4–8 — supervisor / quote-bid / bookings / admin / payments (PRODUCTION)

> Target `https://relay-green-471i.vercel.app`. Supervisor flows driven in an
> injected supervisor context (ctx B); customer flows in ctx A (`gtlcustomer`).
> Date 2026-06-06. Observe-mostly; no payment completed, no booking created.

## Flow 4 — Supervisor `/supervise` ("Live operations") ✅
- On-duty/off-duty presence toggle present.
- Tabs + counts: **all 196 · waiting 0 · live 1 · past 195 · appointments · team · matching**.
- **1 live session** visible (real other-user session on the shared backend) with a
  **"Watch"** (act-now monitor) control. Did NOT open it (privacy — not our session).
- **Callback queue: absent** — expected (`customer_request_engineer` producer not
  shipped, OQ-7). NOT a bug.
- Screenshot: `qa/screens/flow4-supervise.png`. Verdict: **PASS** (pod view + act-now affordance live).

## Flow 5 — Quote → bid → contract 🟡 (chain breaks at the producer)
- Customer-side **"Request a Quote"** (room sidebar) → **no visible response** (no
  modal/pane/nav). Likely needs a project context or is a stub. No `project_quote_requests`
  row produced.
- Supervisor **`/bids`** renders ("Estimation requests and escalations from your pod
  awaiting your review… Act now · Review project history (AI) · AI project assistant")
  but the **bid queue is EMPTY** — nothing to bid on.
- Verdict: **PARTIAL** — both ends render; the chain can't be exercised end-to-end
  because the customer quote-request CTA didn't create a request (producer gap, cousin
  of `AUDIT-STARTCALL-NOOP-1`/`A2P-2`). Screenshot: `qa/screens/flow5-bids.png`.

## Flow 6 — Bookings `/schedule` 🟡 (view verified; create skipped)
- `/schedule` loads (slow ~10s, not stuck): "No upcoming appointments" + **Team schedule
  with clickable bookable slots** (9:00–9:15, 9:30–9:45, 10:15–10:30, …). `/api/supervisor/bookings` → 200.
- Did **NOT** create a booking — booking write is the known **non-atomic** path
  (FUNC-BOOK-ATOMIC-1); creating + the cleanup + avoiding a double-book hammer wasn't
  worth the mutation here. Capability (clickable slots → draft appointment) confirmed present.
- Screenshot: `qa/screens/flow6-schedule.png`. Verdict: **PARTIAL** (view + affordance; no create).

## Flow 7 — Admin reads ✅ (covered earlier)
- Already surface-walked as super_admin in [walks/staff.md](../walks/staff.md):
  `/admin/v2` (Channel Partners / Enterprise / Pods / Bench / Internal Users),
  `/admin/users`, `/admin`. Read-only org/pod/user management; no re-run needed.
  Known data bug there: `AUDIT…`/P1-3 Pods-tab API contract mismatch.

## Flow 8 — Payments ✅ (entry + Stripe test mode; no charge)
- Customer `/account` → **"Recharge"** → modal tiers: **"Start free" · "Continue with €50"
  · "€100" · "€200"**.
- Clicking a tier → **Stripe.js loads in TEST mode** — `apiKey=pk_test_51QjPWD…`
  (test publishable key confirmed live on prod).
- **Did NOT complete payment** (stopped at Stripe load; no card entry, no charge).
- Screenshot: `qa/screens/flow8-recharge.png`. Verdict: **PASS** (checkout entry + Stripe test mode verified; full pay→credit→resume not completed to avoid a real charge).

## Mutation log (this run)
| Action | Persisted? | Cleanup |
|---|---|---|
| Supervisor login + context (injected) | session | global sign-out best-effort + context closed |
| Customer "Request a Quote" click | none (no-op) | — |
| Customer "Recharge" → Stripe tier click | opened Stripe checkout; **NO payment** | modal dismissed; no charge, no credit |
| Supervisor token echoed to transcript (setup) | — | **rotate `gtlsupervisor` QA password** (same as engineer) |

## Net
Flows 4, 7, 8 PASS; 5 and 6 PARTIAL (producer gap / mutation avoided). Combined with
[2-3-two-party-live.md](2-3-two-party-live.md) (flows 2+3 full two-party) and
[1-guest.md](1-guest.md), the 8 core flows are now exercised to the extent the live
environment + non-destructive rules allow.
