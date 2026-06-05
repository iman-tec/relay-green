# Risk Map — "Do Not Break" (Phase 4)

> The protective deliverable. Each entry: **why it's fragile**, **what depends on
> it**, **blast radius if changed**, and the **exact regression checks** to run
> before touching it. Grounded in the Phase 1–3 maps + Phase 2 live walk. Pair
> with [regression-checklist.md](regression-checklist.md) (the run-before-ship
> list). Severity = damage if it breaks, not likelihood.
>
> Source of truth for each claim is the linked audit doc; file:line citations
> live there. This file is the index of fragility, not a re-derivation.

---

## R1 — Zoom Video SDK singleton + `reactStrictMode: false`  ⚠️ CRITICAL

**Why fragile:** `lib/video/zoomClient.ts` holds the SDK client on a `globalThis`
singleton (no per-mount instance). `next.config.ts` sets `reactStrictMode: false`
*specifically* because StrictMode's dev double-invoke would double-init that
singleton and the SDK rejects it. `CallSurface` is gated to mount at most once
(`callOpen`), inside `LaunchCallProvider`.

**Depends on it:** every live call (customer `/room`, engineer
`/staff/session/[id]`), screen-share tile portaling, the `isVideoSdkEnabled()`
default-ON gate (`LaunchCallContext.tsx`).

**Blast radius if changed:** re-enabling StrictMode, or mounting `CallSurface`
twice, or moving the singleton to per-component state → double-init → calls fail
to connect or connect twice (echo/ghost participant) for ALL users. This is a
core-loop Blocker.

**Regression checks before touching call/SDK/StrictMode/room layout:**
- Confirm `reactStrictMode: false` still in `next.config.ts`.
- One customer + one engineer join the same session → exactly one Zoom client per
  tab, A/V connects, no duplicate participant.
- Toggle call open/closed 3× → no leaked client, no second init.
- Screen-share tile still portals (the callback-ref `setTilesTarget` path).

Refs: [components/room-client.md](components/room-client.md) §Zoom singleton,
[state-machines.md](state-machines.md) §call machine, `lib/video/`.

---

## R2 — Call-join gating parses literal system-message strings  ⚠️ HIGH

**Why fragile:** customer call-button enablement and call cards key off literal
chat-system-message bodies ("Zoom meeting started" / "Zoom meeting ended") AND a
belt-and-braces session-row fallback (`engineerOnCall = callStarted ∥
engineer_joined_at ∥ status∈joining/live/grace`). The string path means a copy
change in the Zoom edge functions silently dead-buttons customers.

**Depends on it:** customer ability to JOIN a call (`/room` header green button),
the inline `MeetingChatEntry` call cards.

**Blast radius:** edit the system-message copy in `create-zoom-meeting` /
`zoom-webhook` / `start-guest-call` → customers can't join, no error shown.
**This already bit once** — commit `6864c61` added the session-row fallback after
the string match alone failed in a deployed build.

**Regression checks before touching Zoom edge fns or their system messages:**
- After engineer starts call, customer's green button enables within one poll.
- Grep the edge fns + RoomClient for the exact strings; if you change one, change
  both, and prefer the session-row signal over the string.

Refs: [components/room-client.md](components/room-client.md) (header button line
7138–7228), bug `AUDIT-... ` P1-6, connections.md §Zoom.

---

## R3 — Client-side billing enforcement (`useFreeSessionLifecycle`)  ⚠️ HIGH

**Why fragile:** free-cap exhaustion and the pivot-to-paid run in the CUSTOMER's
browser — a 1 s tick calls `end_session` / stamps `paid_extension_at` via a
direct UPDATE that bypasses the RPC wall (`RoomClient.tsx:203–296, 266–272`).
Tab close / sleep / kill ⇒ no client tick ⇒ relies entirely on server sweepers
(`abandon_stale_queued_sessions` 90 s, `reap_stale_assigned_sessions` 60 s).

**Depends on it:** revenue correctness, free-minute caps, paid-extension start.

**Blast radius:** change the clock logic (`lib/relay/sessionClock.ts`
`computeSessionClock`) or the ACTIVE_TIMER_STATES set → either customers get
billed wrong, or free sessions never end (cost leak), or paid sessions end early.
A malicious customer can already suppress the end by freezing the tab; only the
sweeper catches it (latency = free overage window).

**Regression checks:**
- Free session hits cap → `end_session` fires; reopen tab mid-grace → resumes,
  doesn't double-charge.
- Kill the tab during a live free session → server sweeper ends it within ≤90 s.
- Paid pivot stamps `paid_extension_at` exactly once (no double-stamp on
  remount). See R10 for the no-server-cron-on-offers cousin.

Refs: [state-machines.md](state-machines.md) §paywall, [components/room-client.md](components/room-client.md).

---

## R4 — Queue→ring→accept matcher + bimodal ring latency  ⚠️ HIGH

**Why fragile:** the ring escalation is driven by TWO clocks that must agree: a
realtime INSERT push to the rung engineer (fast, ~0.5 s) AND a 30 s offer TTL
swept ONLY by the customer's 1.5 s poll on the matching page
(`MatchingClient.tsx` → `expire_stale_offers` → `advance_match_on_offer_close`
trigger). **No server cron sweeps offers.** If the customer closes the matching
tab, tier escalation STALLS — the next engineer is never rung.

**Depends on it:** every customer↔engineer connection; FIFO auto-ring in
`StaffShell` (30 s post-end `takeNext`); `EngineerIncomingMatch` (2 s poll
fallback + realtime).

**Blast radius:** touching offer TTLs, the `advance_match_on_offer_close`
trigger, the customer poll interval, or moving the sweep server-side changes the
~31 s slow-path and can either fix the bimodality or strand sessions. Removing
the customer-side poll without adding a server cron = silent matcher death when
tabs close.

**Regression checks:**
- Customer queues, tier-1 engineer ignores → next engineer rings within ~31 s.
- Customer queues then CLOSES the matching tab → does escalation still advance?
  (Today: NO. Any change here must not make it worse; ideally add server cron.)
- FIFO auto-ring fires 30 s after a session ends if engineer is present + queue
  non-empty.

Refs: [state-machines.md](state-machines.md) §queue→ring, ring-latency known
issue (cross-ref, not re-filed).

---

## R5 — Supabase realtime / presence / heartbeat wiring  ⚠️ HIGH

**Why fragile:** 47 `.channel()` sites; presence/heartbeat (`useEngineerHeartbeat`
interval RPC) marks engineers online and stale presence is reaped server-side.
The customer message sub is **INSERT-only with no catch-up refetch on websocket
reconnect** (CHAT-LOSS-1 mechanics) — a dropped socket silently loses messages.
Realtime UPDATE handler spreads `payload.new` over the prior row; without
`REPLICA IDENTITY FULL` on the table, absent columns can clobber good values.
**Phase 2 found realtime WS non-functional in the dev env (everything REST-polls)**
— so this whole layer is under-tested live.

**Depends on it:** chat delivery, presence/online state, ring offers, supervisor
alerts, session-row live updates.

**Blast radius:** changing a channel name, filter, or the merge logic → missed
messages, ghost-online engineers, or clobbered session rows across all live
sessions. Enabling realtime (currently polling) in prod could surface latent
bugs masked by polling.

**Regression checks:**
- Send chat both directions while toggling network offline/online → no message
  loss after reconnect (today: CHAT-LOSS-1 says there IS loss — don't regress
  further; ideally add reconnect refetch).
- Verify `REPLICA IDENTITY FULL` on `guest_calls` (and any table whose UPDATE is
  spread-merged) before trusting partial realtime updates.
- Engineer closes tab → presence flips offline within the heartbeat reap window.

Refs: [connections.md](connections.md) §1–2, [components/room-client.md](components/room-client.md) §realtime.

---

## R6 — `proxy.ts` 4-surface auth edge  ⚠️ HIGH

**Why fragile:** one edge file maps 4 login surfaces to their protected prefixes
and refreshes the Supabase JWT every request. The prefix lists are hand-maintained;
a missing prefix = an unprotected route (already true: `/staff/assistant` is NOT
in `STAFF_PREFIXES` → renders to anon, P1-1). The proxy is the FAST edge only —
real authz is server-side; a route that relies on the proxy alone is exposed.

**Depends on it:** every protected route's first-line redirect; theme cookie.

**Blast radius:** reorder/typo a prefix → either lock users out of a whole
surface or expose a protected one. Phase 2 verified the current mapping is exact
(/room→/login, /admin/v2→/staff, /enterprise→/business, /reseller→/partner) — keep
it that way.

**Regression checks:**
- Unauth GET each surface's protected prefix → 307 to the correct login.
- Each role logs in on its surface → lands correctly (the Phase-2 login matrix).
- Wrong-surface creds → 403 `wrong_login_surface` (server gate, not proxy).
- New protected page added → its prefix is in the right `*_PREFIXES` set AND it
  has a server-side guard (don't trust the proxy alone).

Refs: [00-ground-truth.md](00-ground-truth.md) §3, [walks/_live-confirmation.md](walks/_live-confirmation.md).

---

## R7 — `zoom-sdk-signature` unauthenticated credential mint  ⚠️ BLOCKER (security)

**Why fragile:** `verify_jwt=false`, no ownership check; **live-confirmed** that
the public anon key mints a host-role Meeting-SDK signature for any meeting
number. This is the legacy Meeting SDK path, still live in `config.toml`.

**Depends on it:** the legacy Meeting-SDK fallback call path.

**Blast radius:** as-is it is an open credential oracle. If someone "fixes" the
Video SDK default and assumes the Meeting path is dead, this stays exploitable.
Either gate it (verify caller owns the session) or remove the function + config
entry entirely. Do NOT ship to prod ungated.

**Regression checks:**
- Anon POST `zoom-sdk-signature` → must be 401/403 once fixed (today: 200).
- Confirm no UI path depends on the unauthenticated behavior before gating.

Refs: bug `AUDIT-ZOOM-SIG-1`, [api/edge-functions.md](api/edge-functions.md) P3-E1.

---

## R8 — Webhook fail-open + non-idempotent billing writes  ⚠️ HIGH (security/money)

**Why fragile:** both Zoom webhooks `return true` from signature verification when
the secret env is unset (fail-open). `zoom-video-webhook` `session.ended`
double-bills on Zoom redelivery (no billed-guard, unlike `zoom-webhook`).
`payments-webhook` guest-extension and `enterprise/wallet/topup` both lack
idempotency → double-credit races. `wallet/activate-plan` flips paid tier with NO
payment check.

**Depends on it:** all billing correctness.

**Blast radius:** a misconfigured secret turns webhooks into open endpoints; a
Zoom/Stripe redelivery (normal behavior) double-bills or double-credits. Touching
the webhook handlers without preserving the Stripe-style HMAC + 300 s window +
dedup reintroduces the holes.

**Regression checks:**
- Replay a webhook event twice → exactly one billing effect (dedup by event id).
- Unset the Zoom webhook secret in a test env → handler must REJECT (today:
  accepts).
- `wallet/activate-plan` without a verified paymentIntent → must 402/403.

Refs: [api/edge-functions.md](api/edge-functions.md) P3-E4/E5,
[api/api-routes-org.md](api/api-routes-org.md) P3-O06/O07.

---

## R9 — `SupervisorAlerts` over-subscription (deny-list role gate)  ⚠️ MEDIUM (latent)

**Why fragile:** `StaffShell` mounts `SupervisorAlerts` for any `!isEngineer`
role (deny-list), so reseller / enterprise_admin / dept_admin browsers attempt
global `guest_calls` + `session_escalations` realtime subscriptions. **Phase 2:
no live leak today** — RLS returns `[]` for reseller and realtime is non-functional
in dev. It is one RLS regression away from a live cross-tenant leak to a channel
partner.

**Depends on it:** supervisor escalation toasts/ringtone (the intended consumer).

**Blast radius:** if realtime is enabled in prod AND `guest_calls` RLS ever
loosens, channel partners + enterprise admins get a live feed of all platform
sessions. Changing the gate to `useIsSupervisor()` (allow-list) is the fix and
must not break supervisor alerts.

**Regression checks:**
- As reseller/enterprise_admin: inspect WS — no `guest_calls`/`session_escalations`
  subscription should be attempted (after fix).
- As supervisor: escalation toast + ringtone still fire.
- RLS probe: each non-supervisor role SELECT on `guest_calls` → `[]`.

Refs: bug `AUDIT-SUPALERTS-OVERSUB-1`, [connections.md](connections.md) C3-1.

---

## R10 — Non-atomic booking (double-book)  ⚠️ MEDIUM

**Why fragile:** supervisor bookings use count-then-insert with no unique index /
lock (`supervisor_scheduling.sql:182–205`) — fully racy. Engineer side is
half-fixed (partial unique index on identical `slot_start` only; overlapping
different-start slots still race).

**Depends on it:** `/calendar`, `/schedule`, `book_supervisor_slot`,
`launch_booked_session`.

**Blast radius:** two concurrent bookings of the same slot both succeed →
double-booked engineer/supervisor. Touching booking SQL must preserve (and ideally
extend) the unique constraint to cover overlap, not just exact start.

**Regression checks:**
- Two concurrent identical-slot bookings → exactly one succeeds (engineer side).
- Two concurrent OVERLAPPING-but-different-start bookings → today both succeed
  (known gap); don't regress, ideally fix with an exclusion constraint.

Refs: FUNC-BOOK-ATOMIC-1 (cross-ref), [state-machines.md](state-machines.md) §booking.

---

## R11 — Schema drift: `projects.completion_status` / `contract_type`  ⚠️ MEDIUM (silent)

**Why fragile:** **Phase 2 live**: the `projects` select incl.
`completion_status,completed_at` 400s on every `/room` poll, and the engineer
`/dashboard` KPI `guest_calls...projects(contract_type,completion_status)` 400s —
both SILENTLY fall back. The client queries columns the live Supabase schema
doesn't have (or renamed). Silent fallback hides it from users but the data is
wrong/missing.

**Depends on it:** dashboard KPI tiles, room project state.

**Blast radius:** any code that assumes those columns returns empty/zero; a
migration that adds them changes behavior silently. Whoever "fixes" the 400 must
verify the dependent UI was relying on the fallback.

**Regression checks:**
- `/room` + `/dashboard` network: no 400 on the `projects` selects.
- KPI tiles show real numbers, not silent zeros.

Refs: bug `AUDIT-DATA-400-1`, [walks/staff.md](walks/staff.md), [walks/customer.md](walks/customer.md).

---

## R12 — Giant shared-state files (`RoomClient.tsx` 14.5k lines)  ⚠️ MEDIUM (maintainability)

**Why fragile:** one client component holds ~80 state vars + 15 ref one-shot
guards + the pane state machine + call surface + chat + paywall + intake +
bookings. The ref guards (`supJoinedRef`, `prepHandedRef`, etc.) enforce
once-per-session semantics; a remount or a missed reset re-fires side effects.
PanelGroup `autoSaveId="relay-room-call-v4"` widths are load-bearing (prop churn
resets user drags). ~4 dead components still present (ReviewPanel,
ReadOnlyChatPane, ChatHistoryView, `recall()`).

**Depends on it:** the entire customer surface.

**Blast radius:** any refactor risks breaking a ref-guard invariant or the
effect dependency graph → double-fired RPCs, lost drafts, reset layouts. High
regression surface, low test coverage.

**Regression checks:**
- Full customer flow (queue → live → end → review) with no double-fired RPC
  (watch network for duplicate `mark_joined`/`end_session`).
- Resize panels, reload → widths persist.
- Don't reintroduce StrictMode (R1).

Refs: [components/room-client.md](components/room-client.md),
[components/engineer-session-client.md](components/engineer-session-client.md).

---

## R13 — CSP is Report-Only + unauthenticated AI proxies  ⚠️ MEDIUM

**Why fragile:** CSP is `Content-Security-Policy-Report-Only` with
`unsafe-inline`/`unsafe-eval` — it blocks NOTHING. A firing XSS is a Blocker
regardless. Separately, `/api/assistant` + `/api/intake/turn` are
**live-confirmed unauthenticated OpenAI proxies** (cost-abuse/DoS), and
`/api/online-engineers` leaks engineer PII to anon.

**Depends on it:** nothing depends on CSP blocking (it doesn't). The AI proxies
back the intake + assistant UX.

**Blast radius:** any reflected/stored user content rendered without escaping =
live XSS (CSP won't save you). The AI proxies can be drained for cost.

**Regression checks:**
- Inject `<script>`/`<img onerror>` in chat, project name, intake answers →
  must not execute when rendered to the other party.
- `/api/assistant` + `/api/intake/turn` → require auth + rate limit before prod.

Refs: bugs `AUDIT-ASSISTANT-OPEN-1`, `AUDIT-ONLINE-ENG-LEAK-1`, OQ-5.

---

## Cross-cutting: shared Supabase test state

All QA accounts share one Supabase project. Tests that create/claim/end sessions
collide → Playwright is `workers:1`. The QA customer already carries a stale LIVE
session (E2E-CLEANUP-1). Any automated flow MUST serialize and self-clean, or the
next run starts dirty. This is why the audit serialized all browser-mutating work.
