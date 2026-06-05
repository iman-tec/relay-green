# State machines — Relay.green (Phase 1 static map)

> Derived 2026-06-06 from the working tree at HEAD `6864c61`. Read-only audit:
> every claim cites `file:line`. Five machines: session lifecycle,
> queue→ring→accept, Zoom call connect/disconnect, paywall, booking.
> Cross-references known issues (PROJECT_CONTEXT.md:128-135) — nothing re-filed.

---

## 1. Session lifecycle — `guest_calls.status`

### States

Canonical union: [lib/supabase/types.ts:6-16](../../lib/supabase/types.ts)
(`SessionStatus`), human labels in
[lib/relay/session-status.ts:13-36](../../lib/relay/session-status.ts).

| Status | Meaning (UI label) | Terminal? |
| ------ | ------------------ | --------- |
| `queued` | Customer waiting for engineer ("Connecting customer…") | no |
| `assigned` | Engineer claimed ("Live" chat) | no |
| `joining` | One side in the call ("Joining call") | no |
| `live` | Both joined ("On call") | no |
| `grace` | "Reconnecting" — **declared, never written** (see note) | no |
| `ending` | "Wrapping up" — **declared, never written** (see note) | no |
| `ended` | Done | yes |
| `abandoned` | Queue/claim timed out | yes |
| `cancelled` | Customer bailed pre-live | yes |
| `expired_free` | Free cap hit, paywall buffer (legacy path) | semi (resumable) |
| `waiting` | Legacy initial value — normalised to `queued` | n/a |

DB facts:

- `guest_calls.status` is plain `text NOT NULL DEFAULT 'waiting'` with **no
  CHECK constraint** —
  [supabase/migrations/20260504143944_…sql:7](../../supabase/migrations/20260504143944_32a06db1-d372-4a69-9d34-67ce9f7b6ee5.sql).
  The state machine is enforced *only* by SECURITY DEFINER RPC code; the
  design intent "clients never write status directly" is stated at
  [20260510130000_relay_phase1_session_state_machine.sql:8-9](../../supabase/migrations/20260510130000_relay_phase1_session_state_machine.sql).
- Legacy `'waiting'` rows normalised to `'queued'`:
  [20260510130000:45](../../supabase/migrations/20260510130000_relay_phase1_session_state_machine.sql).
- **`grace` / `ending` have no writers anywhere.** A repo-wide search for
  `status = 'grace'` / `status = 'ending'` (SQL and TS) returns zero hits;
  they exist only in the type union, in readers' `IN (...)` lists (e.g.
  matcher exclusion [20260530220000:111](../../supabase/migrations/20260530220000_offer_ring_timers.sql),
  workspace query [lib/relay/useEngineerWorkspace.ts:90](../../lib/relay/useEngineerWorkspace.ts)),
  and in `humanState`. Reserved/dead states — documented so nobody "fixes"
  a reader by removing them or assumes a reconnect path exists.

### Transitions

| # | Trigger | From → To | Code that drives it |
| - | ------- | --------- | ------------------- |
| 1 | Customer starts a session (project form / composer) | ∅ → `queued` | RPC `get_or_create_active_customer_session` — insert at [20260510130000:196-205](../../supabase/migrations/20260510130000_relay_phase1_session_state_machine.sql); redefined w/ entitlement gate + advisory lock at [20260511180000:164-224](../../supabase/migrations/20260511180000_relay_phase3_payment_lifecycle.sql). Client caller: `useCustomerSession.loadSession` → `startNewSession`/`sendOrStart` ([lib/relay/useCustomerSession.ts:268-271, 567-601](../../lib/relay/useCustomerSession.ts)) |
| 2 | Engineer clicks Take / queue head claim | `queued` → `assigned` | RPC `claim_session`, atomic conditional UPDATE ([20260510140000:47-61](../../supabase/migrations/20260510140000_relay_phase2_engineer_lifecycle.sql)). Callers: `useEngineerWorkspace.claim`/`takeNext` ([lib/relay/useEngineerWorkspace.ts:178-242](../../lib/relay/useEngineerWorkspace.ts)), `EngineerIncomingRequest.onAccept` ([app/_components/EngineerIncomingRequest.tsx:196-214](../../app/_components/EngineerIncomingRequest.tsx)), FIFO auto-ring ([app/_components/StaffShell.tsx:1200](../../app/_components/StaffShell.tsx)) |
| 3 | Engineer accepts a push match offer | `queued` → `assigned` | RPC `accept_match` (latest defn [20260523130000:85-163](../../supabase/migrations/20260523130000_engineer_aliases.sql): offer flip 100-106, session claim 118-129). Caller: `EngineerIncomingMatch.accept` ([app/_components/EngineerIncomingMatch.tsx:195-223](../../app/_components/EngineerIncomingMatch.tsx)) |
| 4 | Engineer releases pre-live | `assigned`/`joining` → `queued` | RPC `release_session` ([20260510140000:81-115](../../supabase/migrations/20260510140000_relay_phase2_engineer_lifecycle.sql)). Caller: `useEngineerSession.release` ([lib/relay/useEngineerSession.ts:284-290](../../lib/relay/useEngineerSession.ts)) |
| 5 | First party reports Zoom join | `assigned` → `joining` | RPC `mark_joined` one-side branch ([20260510140000:185-192](../../supabase/migrations/20260510140000_relay_phase2_engineer_lifecycle.sql)) |
| 6 | Both parties joined | `assigned`/`joining`(/`grace`) → `live` | RPC `mark_joined` both-joined branch ([20260510140000:160-183](../../supabase/migrations/20260510140000_relay_phase2_engineer_lifecycle.sql); also consumes the free session 173-180). Callers: customer `state.markJoined` via `CallSurface onJoined` ([app/room/RoomClient.tsx:2165](../../app/room/RoomClient.tsx), hook [lib/relay/useCustomerSession.ts:510-518](../../lib/relay/useCustomerSession.ts)); engineer ([app/staff/session/[id]/EngineerSessionClient.tsx:585, 1716](../../app/staff/session/[id]/EngineerSessionClient.tsx), hook [lib/relay/useEngineerSession.ts:292-299](../../lib/relay/useEngineerSession.ts)) |
| 7 | Free cap hit (legacy buffer path) | `live` → `expired_free` | RPC `expire_to_free` ([20260511180000:23-69](../../supabase/migrations/20260511180000_relay_phase3_payment_lifecycle.sql)). **No live client caller found** — the current client watchdog ends sessions instead (row 10). State still reachable in old data; webhook resume (row 8) still handles it |
| 8 | Stripe payment credited | `expired_free` → `live` | RPC `extend_session_paid` (customer, [20260511180000:75-122](../../supabase/migrations/20260511180000_relay_phase3_payment_lifecycle.sql)) and `extend_session_paid_admin` (service role, [20260511180000:126-158](../../supabase/migrations/20260511180000_relay_phase3_payment_lifecycle.sql)) invoked by the webhook ([supabase/functions/payments-webhook/index.ts:111-130](../../supabase/functions/payments-webhook/index.ts)) |
| 9 | Either party ends the call | any non-terminal → `ended` | RPC `end_session` ([20260510140000:204-261](../../supabase/migrations/20260510140000_relay_phase2_engineer_lifecycle.sql); idempotent on terminal 229-231; billing re-defined repeatedly, last at [20260524140000_bill_from_assigned_revert.sql](../../supabase/migrations/20260524140000_bill_from_assigned_revert.sql)). Callers: customer ([lib/relay/useCustomerSession.ts:486-508](../../lib/relay/useCustomerSession.ts)), engineer ([lib/relay/useEngineerSession.ts:261-282](../../lib/relay/useEngineerSession.ts)) — both then fire `end-zoom-meeting` + `summarize-guest-call` edge fns |
| 10 | Client billing watchdog: free expired w/ zero balance OR paid balance exhausted | `live` → `ended` | `useFreeSessionLifecycle` calls `end_session` with `_reason: free_session_expired \| paid_balance_exhausted` ([app/room/RoomClient.tsx:281-294](../../app/room/RoomClient.tsx)), decision logic in `computeSessionClock` ([lib/relay/sessionClock.ts:144-157](../../lib/relay/sessionClock.ts)) |
| 11 | Customer cancels pre-live | `queued`/`assigned` → `cancelled` | RPC `cancel_customer_session` ([20260510130000:280-306](../../supabase/migrations/20260510130000_relay_phase1_session_state_machine.sql)). Callers: `useCustomerSession.cancel` ([useCustomerSession.ts:477-484](../../lib/relay/useCustomerSession.ts)); stale-queued (>90s) silent cleanup on mount ([useCustomerSession.ts:189, 213-221](../../lib/relay/useCustomerSession.ts)); MatchingClient Skip ([app/intake/matching/[id]/MatchingClient.tsx:384-388](../../app/intake/matching/[id]/MatchingClient.tsx)); `launch_booked_session` cancelling other-project sessions ([20260601220000:40-47](../../supabase/migrations/20260601220000_launch_booked_session.sql)) |
| 12 | Queue timeout (server cron) | `queued` → `abandoned` | RPC `abandon_stale_queued_sessions` — **90 s** ([20260515140000_queue_timeout_90s.sql:9-27](../../supabase/migrations/20260515140000_queue_timeout_90s.sql), supersedes the 3-min version at [20260510130000:310-328](../../supabase/migrations/20260510130000_relay_phase1_session_state_machine.sql)). Scheduled via pg_cron every minute ([20260510130000:331-343](../../supabase/migrations/20260510130000_relay_phase1_session_state_machine.sql)) + fallback Next.js cron route [app/api/cron/abandon-queued/route.ts:18-48](../../app/api/cron/abandon-queued/route.ts) (Bearer `CRON_SECRET`, service-role RPC at :36) |
| 13 | Claim went nowhere (engineer never joined / heartbeat gone, >60 s) | `assigned`/`joining` → `abandoned` | RPC `reap_stale_assigned_sessions` v2 ([20260528061000:25-52](../../supabase/migrations/20260528061000_reap_stale_assigned_sessions_v2.sql)); invoked inline at the top of every `match_engineer` run ([20260530220000:52](../../supabase/migrations/20260530220000_offer_ring_timers.sql)) and from MatchingClient "Try again" ([MatchingClient.tsx:339](../../app/intake/matching/[id]/MatchingClient.tsx)) |
| 14 | Free cap hit with paid balance | `live` (stays `live`, pivot) | Not a status change: client stamps `paid_extension_at` by **direct table UPDATE** ([app/room/RoomClient.tsx:266-272](../../app/room/RoomClient.tsx)) when `shouldPivotToPaid` ([sessionClock.ts:146-148](../../lib/relay/sessionClock.ts)) — a notable exception to the "all writes via RPC" rule |

Every RPC transition writes `session_audit_log` via `_log_session_event`
([20260510130000:136-150](../../supabase/migrations/20260510130000_relay_phase1_session_state_machine.sql)).

### Diagram

```
            create (RPC get_or_create…)            cron 90s
  ∅ ───────────────────────────────▶ queued ─────────────────────▶ abandoned
                                      │  ▲ │                          ▲
              claim_session /         │  │ └── cancel_customer_…──▶ cancelled
              accept_match            │  │ release_session            ▲
                                      ▼  │                            │
                                   assigned ── cancel_customer_… ─────┘
                                      │   \
                       mark_joined    │    \  reap_stale_assigned (60s) ──▶ abandoned
                       (one side)     ▼     \
                                   joining ──┘
                       mark_joined    │
                       (both sides)   ▼
        ┌────────────────────────── live ◀────────────────┐
        │ expire_to_free (legacy,     │                    │ extend_session_paid[_admin]
        │ no live caller)             │ end_session        │ (Stripe webhook)
        ▼                             ▼                    │
   expired_free ─── end_session ──▶ ended            expired_free
        (10-min buffer)                ▲
                                       │ watchdog: free_session_expired /
                                       │ paid_balance_exhausted (RoomClient:281)
   [grace], [ending] — declared in the type union, never written by any code.
```

---

## 2. Queue → ring → accept (`engineer_match_offers`)

### Offer states

`engineer_match_offers.status`: `pending | accepted | declined | expired` —
CHECK at [20260520100000_onboarding_and_matching.sql:110](../../supabase/migrations/20260520100000_onboarding_and_matching.sql).
Default `expires_at = now() + 30 s` ([20260530220000:32-33](../../supabase/migrations/20260530220000_offer_ring_timers.sql)).

### Producer side (customer)

1. Customer completes intake / sends first message → a `queued` guest_call +
   `client_intakes` row exist.
2. `match_engineer(_intake_id, _force_broadcast)` is invoked from:
   [app/intake/IntakeClient.tsx:151, 260](../../app/intake/IntakeClient.tsx),
   [app/room/RoomClient.tsx:1370, 1647](../../app/room/RoomClient.tsx),
   [app/_components/intake/QuickReturnIntake.tsx:199](../../app/_components/intake/QuickReturnIntake.tsx),
   [app/_marketing/TryRelayFunnel.tsx:262](../../app/_marketing/TryRelayFunnel.tsx),
   and recursively by the advance trigger (below).
3. Latest matcher defn: [20260530220000_offer_ring_timers.sql:36-145](../../supabase/migrations/20260530220000_offer_ring_timers.sql).
   Tiering: tier 1 (0 prior offers) rings the single best-scored engineer for
   **30 s**; tier 2 (1 prior) next-best, 30 s; tier 3 (≥2 prior) or
   `_force_broadcast` ("Try again" → `retry_broadcast_match`,
   [20260530120000:147](../../supabase/migrations/20260530120000_match_engineer_tiered_online.sql))
   broadcasts to all eligible — forced broadcast rings **90 s**
   ([:83-85](../../supabase/migrations/20260530220000_offer_ring_timers.sql)).
   Eligibility excludes busy engineers via the `status IN
   ('assigned','joining','live','grace','expired_free','ending')` subquery
   ([:108-112](../../supabase/migrations/20260530220000_offer_ring_timers.sql)).
   Zero candidates → `guest_calls.reassign_needed = true`
   ([:134-140](../../supabase/migrations/20260530220000_offer_ring_timers.sql))
   which toasts supervisors ([StaffShell.tsx:1303-1309](../../app/_components/StaffShell.tsx)).
4. Customer waits on `/intake/matching/[id]`: 90 s hard window
   ([MatchingClient.tsx:126-140](../../app/intake/matching/[id]/MatchingClient.tsx)),
   realtime on offers + guest_calls **plus a 1.5 s poll** (`POLL_MS`,
   [MatchingClient.tsx:61, 279-315](../../app/intake/matching/[id]/MatchingClient.tsx)).
   When the poll sees a lapsed pending offer it sweeps server-side:
   `expire_stale_offers` ([MatchingClient.tsx:272-277](../../app/intake/matching/[id]/MatchingClient.tsx);
   RPC defn [20260520100000:352-365](../../supabase/migrations/20260520100000_onboarding_and_matching.sql)).

### Consumer side (engineer)

- **Push ring (offers)** — `EngineerIncomingMatch` (mounted in the staff
  shell): realtime `postgres_changes` filtered `engineer_user_id=eq.<me>`
  ([EngineerIncomingMatch.tsx:116-130](../../app/_components/EngineerIncomingMatch.tsx))
  **plus a 2 s poll fallback** ([:131-133](../../app/_components/EngineerIncomingMatch.tsx)).
  Accept → `accept_match` ([:206-208](../../app/_components/EngineerIncomingMatch.tsx)) →
  `/staff/session/[id]`. Decline → `decline_match`
  ([:229](../../app/_components/EngineerIncomingMatch.tsx)). Countdown-zero →
  client invokes `expire_stale_offers` + missed-call toast
  ([:146-159](../../app/_components/EngineerIncomingMatch.tsx)).
- **Pull queue (fallback)** — `list_queue` RPC (staff-only, urgency-then-FIFO,
  [20260510140000:266-287](../../supabase/migrations/20260510140000_relay_phase2_engineer_lifecycle.sql))
  surfaced by `EngineerIncomingRequest` (realtime on all guest_calls changes,
  [EngineerIncomingRequest.tsx:84-94](../../app/_components/EngineerIncomingRequest.tsx))
  and the dashboard via `useEngineerWorkspace`
  ([useEngineerWorkspace.ts:96, 154-176](../../lib/relay/useEngineerWorkspace.ts)).
- **FIFO auto-ring** — `FifoAutoRing`
  ([StaffShell.tsx:1143-1218](../../app/_components/StaffShell.tsx)): watches
  `myActive` for an `assigned/joining/live/grace/expired_free → ended`
  transition (:1156-1166), waits **30 s** (:1209), re-checks
  `presence_state='online'` (:1175-1189) and the queue head (:1192-1198),
  then `takeNext()` (:1200) and routes to the session.

### Offer transitions

| Trigger | From → To | Code |
| ------- | --------- | ---- |
| `match_engineer` insert | ∅ → `pending` | [20260530220000:121-127](../../supabase/migrations/20260530220000_offer_ring_timers.sql) |
| Engineer Accept | `pending` → `accepted` (+ session `queued→assigned`; sibling pendings → `expired`) | `accept_match` [20260523130000:100-142](../../supabase/migrations/20260523130000_engineer_aliases.sql) |
| Engineer Decline | `pending` → `declined` (+ engineer appended to `intake.declined_by`) | `decline_match` [20260520100000:320-345](../../supabase/migrations/20260520100000_onboarding_and_matching.sql) |
| `expires_at` lapses + any sweep | `pending` → `expired` | `expire_stale_offers` [20260520100000:352-365](../../supabase/migrations/20260520100000_onboarding_and_matching.sql); swept from MatchingClient :272-277 and EngineerIncomingMatch :155-158 |
| Offer closes while session still queued | (re-entry) → next `pending` | trigger `advance_match_on_offer_close_trg` on `pending→declined/expired` re-invokes `match_engineer` ([20260520900000_sequential_matching.sql:136-169](../../supabase/migrations/20260520900000_sequential_matching.sql)) |
| Session goes terminal | all `pending` → `expired` | trigger in [20260520800000_expire_offers_on_session_end.sql:28](../../supabase/migrations/20260520800000_expire_offers_on_session_end.sql) |
| Scheduled-call join | ∅ → `pending` (120 s, directed) | `launch_booked_session` [20260601220000:66-69](../../supabase/migrations/20260601220000_launch_booked_session.sql) |

```
                 match_engineer (tier 1: best, 30s)
 queued session ────────▶ offer#1 pending ──accept──▶ accepted ⇒ session assigned
                              │ decline/30s-expire
                              ▼  (advance trigger)
                          offer#2 pending (tier 2, 30s) ──accept──▶ …
                              │ decline/expire
                              ▼
                          broadcast offers (tier 3, 30s) ──none──▶ reassign_needed
                                                                   (supervisor toast)
 customer window: 90s hard stop (MatchingClient) → "busy" notice → one retry
 (retry_broadcast_match, 90s broadcast)
```

### Bimodal ring latency (~0.5 s vs ~31 s) — explanation (cross-ref, not re-filed)

Known issue listed at [PROJECT_CONTEXT.md:134](../../PROJECT_CONTEXT.md). The
two modes fall directly out of the paths above:

- **Fast mode (~0.5 s):** `match_engineer` INSERTs the offer; the target
  engineer's `EngineerIncomingMatch` realtime subscription
  ([EngineerIncomingMatch.tsx:116-130](../../app/_components/EngineerIncomingMatch.tsx))
  fires on the INSERT push and the ring renders sub-second (worst case the
  2 s poll at :131-133 catches it).
- **Slow mode (~31 s):** the tier-1 offer went to a *different* engineer (or
  one whose tab missed the push). Nothing advances until that offer's **30 s**
  `expires_at` lapses ([20260530220000:83-85](../../supabase/migrations/20260530220000_offer_ring_timers.sql)).
  Server-side there is **no cron sweeping offers** — expiry is flipped by the
  customer's MatchingClient sweep, which detects the lapse on its **1.5 s
  poll** ([MatchingClient.tsx:61, 262-277](../../app/intake/matching/[id]/MatchingClient.tsx))
  and calls `expire_stale_offers`; the `advance_match_on_offer_close` trigger
  ([20260520900000:164-169](../../supabase/migrations/20260520900000_sequential_matching.sql))
  then re-runs `match_engineer`, and the *next* engineer's realtime push
  rings them. Total: 30 s offer TTL + up to ~1.5 s sweep granularity ≈ **31 s**.
  So the observed bimodality is "first-rung engineer vs second-rung engineer",
  with the 30 s tier TTL plus the client-driven sweep cadence as the gap.
  (Corollary: if the customer closes the matching tab, nothing sweeps and the
  tiers stall until an engineer-side countdown sweep at
  [EngineerIncomingMatch.tsx:146-159](../../app/_components/EngineerIncomingMatch.tsx) fires.)

---

## 3. Call connect / disconnect — Zoom Video SDK

### Surface gate

`isVideoSdkEnabled()` —
[lib/video/LaunchCallContext.tsx:59-66](../../lib/video/LaunchCallContext.tsx):
Video SDK is **default ON**; only the explicit string
`NEXT_PUBLIC_USE_VIDEO_SDK="false"` re-enables the legacy Meeting-SDK path
(fix shipped in commit `7bc6667`). Gates: customer `launchCall`
([app/room/RoomClient.tsx:348-350](../../app/room/RoomClient.tsx)), engineer
([EngineerSessionClient.tsx:195](../../app/staff/session/[id]/EngineerSessionClient.tsx));
when **off**, the engineer auto-mints a Meeting-SDK meeting via
`mint-zoom-for-session` ([EngineerSessionClient.tsx:308, 320, 1691-1735](../../app/staff/session/[id]/EngineerSessionClient.tsx)).

### Hook states

`useZoomCall` `Status` union —
[lib/video/useZoomCall.ts:18-25](../../lib/video/useZoomCall.ts); machine
sketch in the header comment (:9-11).

```
 idle ─mount─▶ fetching-token ─▶ joining ─▶ joined ⇄ reconnecting
                    │               │          │            │
                    ▼ error         ▼ error    ▼ leave()    ▼ SDK "Closed"
                  error           error      ended        ended
```

| Trigger | From → To | Code |
| ------- | --------- | ---- |
| Join effect starts | `idle` → `fetching-token` | [useZoomCall.ts:209](../../lib/video/useZoomCall.ts); invokes edge fn `zoom-video-sdk-token` (:211-218) |
| Token bad / init or join failure | * → `error` | :220-223, :239-247, :295-334 (5012 "duplicated join" tolerated only if already in target topic :297-304) |
| `client.init` ok | `fetching-token` → `joining` | :248; stale-topic leave-then-join handling :263-294 |
| `client.join` resolves | `joining` → `joined` | :336-337 |
| SDK `connection-change` | `joined` ⇄ `reconnecting`; → `ended` on `Closed` | listener :340-343 |
| Explicit Leave button | * → `ended` | `leave()` :1022-1064 — flushes captions **before** invoking edge fn `zoom-video-sdk-end` (:1043-1056), resets join guard :1060 |
| Page unload | (server notified) | `pagehide` beacon to `zoom-video-sdk-end` :555-575; SDK `leaveOnPageUnload: true` :237 |
| React unmount | (no transition) | deliberately does **not** leave — call survives HMR/re-mounts :616-633 |

### Singleton + session-machine bridge

- Process-wide client singleton cached on `globalThis.__relayVideoClient__` —
  [lib/video/zoomClient.ts:16-48](../../lib/video/zoomClient.ts) (`destroyVideoClient`
  :54-72). Pairs with `reactStrictMode: false`
  ([next.config.ts](../../next.config.ts)).
- Bridge into machine #1: `CallSurface onJoined` → `state.markJoined()` →
  RPC `mark_joined` → `joining`/`live`
  ([RoomClient.tsx:2165](../../app/room/RoomClient.tsx),
  [EngineerSessionClient.tsx:585](../../app/staff/session/[id]/EngineerSessionClient.tsx),
  contract noted at [app/_components/call/CallSurface.tsx:22](../../app/_components/call/CallSurface.tsx)).
- Session end → hang up Zoom: both end paths fire `end-zoom-meeting`
  ([useCustomerSession.ts:500-502](../../lib/relay/useCustomerSession.ts),
  [useEngineerSession.ts:274-276](../../lib/relay/useEngineerSession.ts));
  the session `ended` status auto-closes the customer's surface
  ([RoomClient.tsx:352-354](../../app/room/RoomClient.tsx)).
- Media defaults: mic + camera start OFF; audio starts inside the first click
  gesture ([useZoomCall.ts:388-399, 820-848](../../lib/video/useZoomCall.ts)).
- Transcription side-machine: native LTT attempted (host, :483-547; account
  errorCode 7300 expected) else per-participant Whisper chunks every 30 s to
  `transcribe-chunk` (:673-802); caption flush precedes summarization
  (:1036-1046).

---

## 4. Paywall — free-time exhaustion → Stripe → resume

### Client paywall state

`paywallOpen: null | "free_expired" | "no_credits" | "manual"` —
[app/room/RoomClient.tsx:755-757](../../app/room/RoomClient.tsx). Employees
(dept-pool minutes) are exempt everywhere (`isEmployee` guard,
:751-754, :851-852, :876-877).

| Trigger | → Paywall state | Code |
| ------- | --------------- | ---- |
| Session status hits `expired_free` | `free_expired` | [RoomClient.tsx:853-855](../../app/room/RoomClient.tsx) |
| Session `ended` with reason `free_session_expired`/`paid_balance_exhausted` and wallet ≤ 0 | `free_expired` | :857-867 |
| RPC error `NO_ENTITLEMENT` on new-session attempt | `no_credits` | :876-881 (raised by `get_or_create…` [20260511180000:195-200](../../supabase/migrations/20260511180000_relay_phase3_payment_lifecycle.sql)) |
| `?paywall=` URL param (Try-Relay funnel) | `no_credits`/`free_expired` | :810-825 |
| Manual "Recharge"/"See plans" | `manual` | :1661-1668, :1846 |
| `?relay_paid=<plan>` return from Stripe | → `null` + toast + delayed `refresh()` | :886-905 |

### Enforcement clock (drives the transitions in machine #1)

Single source of truth `computeSessionClock`
([lib/relay/sessionClock.ts:79-176](../../lib/relay/sessionClock.ts)):
anchor = `assigned_at` (:34, RoomClient:215-218), free cap 10 min
(`DEFAULT_FREE_MINUTES` :28, plan "free" [lib/relay/pricing.ts:12-27](../../lib/relay/pricing.ts)).
Outcomes (:144-157): `shouldPivotToPaid` (free cap hit, balance > 0) →
client stamps `paid_extension_at` ([RoomClient.tsx:266-272](../../app/room/RoomClient.tsx));
`shouldEnd` → `end_session(free_session_expired | paid_balance_exhausted)`
([RoomClient.tsx:281-294](../../app/room/RoomClient.tsx)). Appointment calls
are exempt ([RoomClient.tsx:225-231](../../app/room/RoomClient.tsx)).

### Money flow

```
 paywall card click ─▶ edge fn create-relay-checkout (PaywallModal.tsx:101-106)
        │                       plans: base €50/100min · pro €100/240min ·
        ▼                       max €200/500min (lib/relay/pricing.ts:28-71)
   Stripe Checkout ──success──▶ redirect ?relay_paid=<plan> (RoomClient.tsx:886-905)
        │                                  │ (belt & braces)
        │ webhook                          ▼
        ▼                        edge fn credit-relay-payment
 edge fn payments-webhook        (client-invoked, idempotent — PaywallModal.tsx:690-698)
 checkout.session.completed
   ├─ credit credit_wallets + ledger + customer_entitlements
   │    (payments-webhook/index.ts:48-106)
   └─ auto-resume newest expired_free session via extend_session_paid_admin
        (index.ts:111-130) ⇒ guest_calls expired_free → live
 guest extension variant (create-guest-checkout → meta.kind="guest_extension"):
   bumps guest_calls.free_minutes + stamps paid_extension_at (index.ts:135-167)
```

Resume UX: the realtime UPDATE on the session row flips the customer back to
`live` ([useCustomerSession.ts:397-412](../../lib/relay/useCustomerSession.ts));
wallet refresh dismisses the paywall (:886-897).

---

## 5. Booking — `engineer_bookings` / `supervisor_bookings`

### States

- `engineer_bookings.status`: `booked | cancelled | completed | no_show`
  (CHECK [20260527120000_engineer_availability.sql:69-73](../../supabase/migrations/20260527120000_engineer_availability.sql))
  **+ `expired`** added by [20260601200000_appointment_lifecycle.sql:19-22](../../supabase/migrations/20260601200000_appointment_lifecycle.sql).
- `supervisor_bookings.status`: `booked | cancelled | completed | no_show`
  ([20260601120000_supervisor_scheduling.sql:75-79](../../supabase/migrations/20260601120000_supervisor_scheduling.sql)).
- `cancelled_at` stamped by a shared BEFORE UPDATE trigger on any
  `booked→cancelled` ([20260604150000_booking_cancelled_at.sql:22-39](../../supabase/migrations/20260604150000_booking_cancelled_at.sql)).

### Transitions

| Trigger | From → To | Code |
| ------- | --------- | ---- |
| Customer books a slot (ScheduleEngineerModal / calendar pickers) | ∅ → `booked` | RPC `book_engineer_slot` — current defn [20260601100000_booking_atomic_and_last_engineer.sql:28-72](../../supabase/migrations/20260601100000_booking_atomic_and_last_engineer.sql) |
| Customer books a supervisor call ("Ask for appointment" on a bid) | ∅ → `booked` (supervisor_bookings) | RPC `book_supervisor_slot` [20260601120000:128-226](../../supabase/migrations/20260601120000_supervisor_scheduling.sql) |
| Either party cancels | `booked` → `cancelled` | `cancel_booking` ([20260527120000:216-247](../../supabase/migrations/20260527120000_engineer_availability.sql)); with reason + notifications: `cancel_booking_with_reason` ([20260601200000:58-100](../../supabase/migrations/20260601200000_appointment_lifecycle.sql)); supervisor side `cancel_supervisor_booking` ([20260601120000:230-271](../../supabase/migrations/20260601120000_supervisor_scheduling.sql)) |
| Customer reschedules ("Schedule for later") | `booked` → `cancelled` (`cancel_reason='rescheduled'`), then a **new** booking is created via the picker | RPC `reschedule_booking` ([20260601200000:106-138](../../supabase/migrations/20260601200000_appointment_lifecycle.sql)); client callers [app/_components/AppointmentPopup.tsx:243](../../app/_components/AppointmentPopup.tsx), [app/_components/ScheduledCenterView.tsx:268-273](../../app/_components/ScheduledCenterView.tsx); supervisor variant re-books then cancels ([SupervisorScheduleModal.tsx:429](../../app/_components/SupervisorScheduleModal.tsx)) |
| Customer clicks Join at slot time | `booked` → `completed` + directed 120 s match offer to the booked engineer | RPC `launch_booked_session` ([20260601220000:19-83](../../supabase/migrations/20260601220000_launch_booked_session.sql); offer insert :66-69, status flip :72) — feeds machine #2/#1 |
| Slot window passes, never launched | `booked` → `expired` | pg_cron `tick_appointment_lifecycle` every minute ([20260601200000:144-196](../../supabase/migrations/20260601200000_appointment_lifecycle.sql); expire loop :169-187, 15-min heads-up :150-167) |

```
            book_engineer_slot / book_supervisor_slot
       ∅ ──────────────────────────────▶ booked
                                            │── cancel_* ───────────▶ cancelled
                                            │── reschedule_booking ─▶ cancelled('rescheduled') → (new booked)
                                            │── launch_booked_session ▶ completed ⇒ rings machine #2 (120s offer)
                                            └── cron tick (window passed, no launch) ▶ expired
       no_show: in the CHECK constraint; no writer found (reserved).
```

### FUNC-BOOK-ATOMIC-1 — the non-atomic check-then-insert (cross-ref, not re-filed)

Known issue at [PROJECT_CONTEXT.md:133](../../PROJECT_CONTEXT.md). Exact code:

1. **Original race** — `book_engineer_slot` v1: `SELECT count(*)` overlap
   check at [20260527120000_engineer_availability.sql:196-203](../../supabase/migrations/20260527120000_engineer_availability.sql)
   followed by the INSERT at [:205-208](../../supabase/migrations/20260527120000_engineer_availability.sql).
   Two customers confirming the same free slot concurrently could both pass
   the count and both insert.
2. **Partial fix (engineer flow)** —
   [20260601100000_booking_atomic_and_last_engineer.sql](../../supabase/migrations/20260601100000_booking_atomic_and_last_engineer.sql):
   partial unique index `uniq_engineer_booking_active_slot
   (engineer_user_id, slot_start) WHERE status='booked'` (:24-26) and the
   RPC traps `unique_violation` → `SLOT_UNAVAILABLE` (:60-67). The
   migration's own header concedes the limit: collision is caught **only
   when the two bookings share an identical `slot_start`**; overlapping
   bookings with *different* starts "additionally rely on the overlap
   pre-check" (:9-11) — i.e. the racy count survives for that shape.
3. **Still fully non-atomic (supervisor flow)** — `book_supervisor_slot`:
   `count(*)` overlap check at
   [20260601120000_supervisor_scheduling.sql:182-189](../../supabase/migrations/20260601120000_supervisor_scheduling.sql)
   then INSERT at [:198-205](../../supabase/migrations/20260601120000_supervisor_scheduling.sql),
   with **no unique index on `supervisor_bookings` anywhere in
   `supabase/migrations/`** and no advisory lock — two concurrent customers
   can double-book the same supervisor slot. This is the surviving live
   instance of FUNC-BOOK-ATOMIC-1.

---

## Appendix — cross-machine couplings worth keeping in view

- **Queue abandon (90 s) vs ring window (90 s):** `abandon_stale_queued_sessions`
  abandons any `queued` row older than 90 s ([20260515140000:21-22](../../supabase/migrations/20260515140000_queue_timeout_90s.sql))
  on a 1-min cron, while MatchingClient rings for exactly 90 s — so tier-3
  broadcasts and "Try again" retries race the abandon cron depending on cron
  phase (the retry path does not reset `created_at`).
- **Busy-engineer detection** in the matcher keys off `grace`/`ending`
  ([20260530220000:111](../../supabase/migrations/20260530220000_offer_ring_timers.sql))
  — harmless today since those states are never written.
- **Direct table writes that bypass the RPC wall:** client stamp of
  `paid_extension_at` ([RoomClient.tsx:266-272](../../app/room/RoomClient.tsx))
  and the webhook's `free_minutes` bump
  ([payments-webhook/index.ts:155-165](../../supabase/functions/payments-webhook/index.ts)).
- **`no_show`** (both booking tables) is in the CHECK constraints but has no
  writer in the repo — reserved, like `grace`/`ending`.
