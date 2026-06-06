# Connections — Relay.green (Phase 3 static map)

> Derived 2026-06-06 from the working tree at HEAD `6864c61`. Read-only audit:
> every claim cites `file:line`. This is the **live-connection inventory** —
> realtime channels, presence/heartbeat, queue/ring transport, Zoom lifecycle,
> Stripe, and AI edge functions. Builds on and links to:
> [state-machines.md](state-machines.md) (session lifecycle, queue→ring→accept
> incl. bimodal latency, Zoom call machine, paywall, booking),
> [components/room-client.md](components/room-client.md) (P1-6 string-protocol
> finding), and [00-ground-truth.md](00-ground-truth.md) (route/function
> inventory). Payload **values are redacted**; only shapes/keys are described.

---

## 1. Supabase realtime channels — complete inventory

**47 `.channel()` instantiation sites** across `app/` and `lib/` (every match
of `\.channel(` — one extra grep hit, `EngineerIncomingMatch.tsx:100`, is a
comment, not a call). All use `postgres_changes`; none use Supabase Presence or
Broadcast. The cross-cutting pattern (mechanically repeated in ~30 of them):
per-mount `crypto.randomUUID()`/`Date.now()` channel-name suffix to dodge
Supabase realtime-js's name-based dedupe ("cannot add postgres_changes after
subscribe()"), almost always paired with a polling/interval fallback because
the team does not trust realtime delivery.

### Table

Legend: **Filter** = server-side `filter:` clause on the subscription (✅ = row
scoped, ❌ = unfiltered, fires for every visible row under RLS). **Catch-up** =
does the channel re-fetch on reconnect/missed-event (poll fallback or focus
refetch counts).

| # | Channel name | File:line | Table(s) / event | Handler effect | Filter | Cleanup | Catch-up |
| - | ------------ | --------- | ---------------- | -------------- | ------ | ------- | -------- |
| 1 | `relay-session:${sessionId}` | [useCustomerSession.ts:398](../../lib/relay/useCustomerSession.ts) | `guest_calls` UPDATE (`id=eq`), `guest_messages` INSERT (`guest_call_id=eq`) | merge session row; dedup-append msg + hydrate attachments | ✅ | removeChannel on id change | ❌ INSERT-only, no refetch (CHAT-LOSS-1) |
| 2 | `room-tray:${session.id}` | [RoomClient.tsx:14269](../../app/room/RoomClient.tsx) | `client_intakes` UPDATE | refetch this session's intake | ❌ | removeChannel | n/a |
| 3 | `relay-eng-session:${sessionId}` | [useEngineerSession.ts:128](../../lib/relay/useEngineerSession.ts) | `guest_calls` UPDATE (`id=eq`), `guest_messages` INSERT (`guest_call_id=eq`) | merge row; append msg + attachments | ✅ | removeChannel | ❌ INSERT-only |
| 4 | `relay-queue` | [useEngineerQueue.ts:56](../../lib/relay/useEngineerQueue.ts) | `guest_calls` `*` | refetch `list_queue` RPC | ❌ | removeChannel | refetch-on-event (any change → full refetch) |
| 5 | `relay-engineer-workspace-${uuid}` | [useEngineerWorkspace.ts:162](../../lib/relay/useEngineerWorkspace.ts) | `guest_calls` `*` | refetch 3 lists | ❌ | removeChannel | refetch-on-event |
| 6 | `engineer-incoming-queue` | [EngineerIncomingRequest.tsx:86](../../app/_components/EngineerIncomingRequest.tsx) | `guest_calls` `*` | re-eval queue head via `list_queue` | ❌ | removeChannel | refetch-on-event |
| 7 | `match-offers:${uid}:${ts}` | [EngineerIncomingMatch.tsx:117](../../app/_components/EngineerIncomingMatch.tsx) | `engineer_match_offers` `*` (`engineer_user_id=eq`) | refetch offer → ring | ✅ | removeChannel | ✅ **2 s poll** (:131) |
| 8 | `match-offers-bridge:${uid}:${ts}` | [MatchOfferBridge.tsx:127](../../app/widget/engineer/MatchOfferBridge.tsx) | `engineer_match_offers` `*` (`engineer_user_id=eq`) | desktop-shell IPC ring | ✅ | removeChannel | ✅ **2 s poll** (:141) |
| 9 | `presence-ball-${uid}-${sfx}` | [EngineerPresenceBall.tsx:175](../../app/_components/EngineerPresenceBall.tsx) | `engineer_profiles` UPDATE (`user_id=eq`) | reflect presence dot | ✅ | removeChannel | initial fetch only |
| 10 | `presence-ball-offers-${uid}-${sfx}` | [EngineerPresenceBall.tsx:213](../../app/_components/EngineerPresenceBall.tsx) | `engineer_match_offers` `*` (`engineer_user_id=eq`) | ring on INSERT pending; clear on non-pending (notes REPLICA IDENTITY DEFAULT → `old` is PK-only) | ✅ | removeChannel | ✅ mount poll (:259) |
| 11 | `presence-auto-call-${uid}-${sfx}` | [EngineerPresenceBall.tsx:363](../../app/_components/EngineerPresenceBall.tsx) | `guest_calls` `*` (`claimed_by=eq`) | on-call → auto presence busy/online | ✅ | removeChannel | initial fetch |
| 12 | `presence-ball-callbacks-${uid}-${sfx}` | [EngineerPresenceBall.tsx:454](../../app/_components/EngineerPresenceBall.tsx) | `engineer_connect_requests` `*` (`engineer_user_id=eq`) | pending-callback list + 30 s auto-ring | ✅ | removeChannel | initial fetch |
| 13 | `presence-badge-${uid}-${sfx}` | [EngineerPresenceBadge.tsx:94](../../app/_components/EngineerPresenceBadge.tsx) | `engineer_profiles` UPDATE (`user_id=eq`) | mirror presence menu | ✅ | removeChannel | initial fetch |
| 14 | `engineer-alerts-${me}-${sfx}` | [EngineerAlerts.tsx:189](../../app/_components/EngineerAlerts.tsx) | `notifications` INSERT (`user_id=eq`) | bid/notification toast | ✅ | removeChannel | ✅ on-mount lookback fetch (:160) |
| 15 | `relay-supervise` | [SuperviseClient.tsx:464](../../app/(staff)/supervise/SuperviseClient.tsx) | `guest_calls` `*`, `session_health` INSERT, `sup_sentiment` INSERT | debounced (600 ms) pod-grid refetch | ❌ (comment :448 concedes pod filter not honoured — re-applied in refetch) | removeChannel + clearInterval | ✅ **5 s poll** |
| 16 | `relay-supervise-escalations` | [SuperviseClient.tsx:534](../../app/(staff)/supervise/SuperviseClient.tsx) | `session_escalations` `*` | refetch escalations | ❌ | removeChannel | ✅ **10 s poll** |
| 17 | `relay-roster` | [RosterPanel.tsx:114](../../app/(staff)/supervise/RosterPanel.tsx) | `engineer_profiles` `*`, `guest_calls` `*`, `session_health` INSERT | debounced roster refetch | ❌ | removeChannel | ✅ **5 s poll** |
| 18 | `relay-matching` | [MatchingPanel.tsx:85](../../app/(staff)/supervise/MatchingPanel.tsx) | `engineer_match_offers` `*`, `client_intakes` `*` | debounced (400 ms) refetch | ❌ | removeChannel | ✅ **5 s poll** |
| 19 | `supervise-live-appts-${uid}-${uuid}` | [AppointmentsPanel.tsx:412](../../app/(staff)/supervise/AppointmentsPanel.tsx) | `guest_calls` `*` (`supervisor_user_id=eq`) | tick refetch | ✅ | removeChannel | tick |
| 20 | `supervise-appts-tab-${uid}-${uuid}` | [AppointmentsPanel.tsx:502](../../app/(staff)/supervise/AppointmentsPanel.tsx) | `guest_calls` `*` (`supervisor_user_id=eq`) | tick refetch | ✅ | removeChannel | tick |
| 21 | `relay-act-now` | [ActNowRail.tsx:243](../../app/(staff)/supervise/ActNowRail.tsx) | `project_quote_requests` `*` | debounced refetch | ❌ | removeChannel + clearInterval | ✅ **5 s poll** |
| 22 | `relay-admin` | [AdminClient.tsx:92](../../app/(staff)/admin/AdminClient.tsx) | `guest_calls` `*`, `session_audit_log` INSERT | refetch dashboards | ❌ | removeChannel | ❌ (no poll) |
| 23 | `relay-admin-matching` | [admin/v2/MatchingInline.tsx:68](../../app/(staff)/admin/v2/MatchingInline.tsx) | `engineer_match_offers` `*`, `client_intakes` `*` | debounced refetch `/api/admin/matching` | ❌ | removeChannel | ✅ **5 s poll** |
| 24 | `relay-supervisor-schedule` | [ScheduleClient.tsx:118](../../app/(staff)/schedule/ScheduleClient.tsx) | `supervisor_bookings` `*` (`supervisor_user_id=eq`) | tick refetch | ✅ | removeChannel | ✅ **15 s poll** (table not in realtime publication) |
| 25 | `dash-requests-${me}-${sfx}` | [DashboardClient.tsx:325](../../app/(staff)/dashboard/DashboardClient.tsx) | `engineer_connect_requests` `*` (`engineer_user_id=eq`) | incremental list patch | ✅ | removeChannel | initial fetch |
| 26 | `dash-bookings-${me}-${sfx}` | [DashboardClient.tsx:368](../../app/(staff)/dashboard/DashboardClient.tsx) | `engineer_bookings` `*` (`engineer_user_id=eq`) | incremental list patch | ✅ | removeChannel | initial fetch |
| 27 | `relay-quote-inbox` | [QuoteRequestsInbox.tsx:182](../../app/(staff)/inbox/QuoteRequestsInbox.tsx) | `project_quote_requests` `*` | debounced refetch `/api/staff/quote-requests` | ❌ | removeChannel + clearInterval | ✅ **8 s poll** |
| 28 | `inbox-requests-${me}-${sfx}` | [InboxClient.tsx:186](../../app/(staff)/inbox/InboxClient.tsx) | `engineer_connect_requests` `*` (`engineer_user_id=eq`) | incremental list patch | ✅ | removeChannel | initial fetch |
| 29 | `supervisor-inbox-${sfx}` | [InboxClient.tsx:1127](../../app/(staff)/inbox/InboxClient.tsx) | `guest_calls` `*` | debounced (1.5 s) refetch | ❌ | removeChannel | refetch-on-event |
| 30 | `reseller-invitations-view` | [reseller/v2/InvitationsView.tsx:85](../../app/(staff)/reseller/v2/InvitationsView.tsx) | `invites` `*` | reload `/api/invite` | ❌ | removeChannel | reload-on-event |
| 31 | `enterprise-members-roster` | [enterprise/v2/MembersTab.tsx:56](../../app/(staff)/enterprise/v2/MembersTab.tsx) | `invites` `*` | reload roster (RLS note :49 — co-admin who didn't send invite misses event) | ❌ | removeChannel | reload-on-event |
| 32 | `invite-status-table` | [invite/InviteStatusTable.tsx:56](../../app/_components/invite/InviteStatusTable.tsx) | `invites` `*` | reload `/api/invite` | ❌ | removeChannel | reload-on-event |
| 33 | `intake:${intakeId}:${ts}` | [MatchingClient.tsx:283](../../app/intake/matching/[id]/MatchingClient.tsx) | `engineer_match_offers` `*` (`intake_id=eq`) | fetchLatest (drives ring) | ✅ | removeChannel | ✅ **1.5 s poll** (root cause of bimodal latency — see state-machines.md §2) |
| 34 | `intake-session:${intakeId}:${ts}` | [MatchingClient.tsx:298](../../app/intake/matching/[id]/MatchingClient.tsx) | `guest_calls` UPDATE | fetchLatest | ❌ | removeChannel | ✅ **1.5 s poll** |
| 35 | `appt-popup-${uid}-${uuid}` | [AppointmentPopup.tsx:152](../../app/_components/AppointmentPopup.tsx) | `engineer_bookings` `*` (`customer_user_id=eq`) | reload appts | ✅ | removeChannel | initial fetch |
| 36 | `upcoming-session-${uid}-${uuid}` | [UpcomingSessionBanner.tsx:117](../../app/_components/UpcomingSessionBanner.tsx) | `engineer_bookings` `*` (`customer_user_id=eq`) | reload banner | ✅ | removeChannel | initial fetch |
| 37 | `scheduled-center-${uid}-${uuid}` | [ScheduledCenterView.tsx:115](../../app/_components/ScheduledCenterView.tsx) | `supervisor_bookings` `*`, `engineer_bookings` `*` (both `customer_user_id=eq`) | tick refetch | ✅ | removeChannel | window-event refetch |
| 38 | `sidebar-bookings-${uid}-${uuid}` | [ScheduledCallsPill.tsx:167](../../app/_components/ScheduledCallsPill.tsx) | `engineer_bookings` `*` (`customer_user_id=eq`) | reload calls | ✅ | removeChannel | initial fetch |
| 39 | `notif-${uid}-${uuid}` | [NotificationBell.tsx:293](../../app/_components/NotificationBell.tsx) | 4 tables `*` (`engineer_bookings`/`supervisor_bookings`/`project_quote_requests`/`guest_calls`, all `customer_user_id=eq`) | reload feed | ✅ | removeChannel + window listeners | window-event refetch |
| 40 | `${channelKey}-notifications-bell` | [admin-v2/NotificationBell.tsx:118](../../app/_components/admin-v2/NotificationBell.tsx) | `notifications` `*` (`user_id=eq` **if uid resolved**, else **unfiltered**) | debounced reload | ⚠️ conditional (falls back to ❌ if `getSession` is slow) | removeChannel | ✅ visibilitychange refetch (:140) |
| 41 | `relay-supervisor-notif-bell` | [SupervisorNotificationBell.tsx:84](../../app/_components/SupervisorNotificationBell.tsx) | `notifications` `*` (`user_id=eq`) | tick refetch | ✅ | removeChannel | ✅ visibilitychange refetch |
| 42 | `relay-contracts` | [ContractManagement.tsx:134](../../app/_components/ContractManagement.tsx) | `project_quote_requests` `*` | reload quotes | ❌ | removeChannel | reload-on-event |
| 43 | `relay-contracts-center-${uuid}` | [ContractsCenterView.tsx:95](../../app/_components/ContractsCenterView.tsx) | `project_quote_requests` `*` | reload quotes | ❌ | removeChannel | reload-on-event |
| 44 | `session-review-msgs-${sessionId}-${sfx}` | [SessionReviewClient.tsx:197](../../app/session-review/[id]/SessionReviewClient.tsx) | `guest_messages` `*` (`guest_call_id=eq`) — handles INSERT/UPDATE/DELETE | live message tail | ✅ | removeChannel | initial fetch |
| 45 | `session-escalation-${sessionId}` | [EngineerSessionClient.tsx:1366](../../app/staff/session/[id]/EngineerSessionClient.tsx) | `session_escalations` `*` (`session_id=eq`) | reflect resolve | ✅ | removeChannel (no uuid suffix — fixed name, two tabs of same session collide) | initial fetch |
| 46 | `supervisor-alerts-shell-${sfx}` | [StaffShell.tsx:1292](../../app/_components/StaffShell.tsx) | `guest_calls` `*` | reassign + urgent-session toasts | ❌ | removeChannel | none |
| 47 | `supervisor-escalations-${sfx}` | [StaffShell.tsx:1361](../../app/_components/StaffShell.tsx) | `session_escalations` INSERT | escalation toast + ringtone | ❌ | removeChannel | none |

### Unfiltered subscriptions (flagged)

Channels **#2, 4, 5, 6, 15–18, 21, 22, 23, 27, 29, 30, 31, 32, 34, 42, 43, 46,
47** subscribe with **no `filter:` clause** — every change to the table that
RLS lets the user see fires the handler. Most are debounced refetches so the
blast-radius is a cheap re-query, but they lean entirely on RLS for data
isolation; if an RLS policy is broad (e.g. the super_admin/supervisor policies
referenced at MatchingPanel.tsx:71-73) these fan out across the whole platform.
`SuperviseClient.tsx:448-451` explicitly documents that `postgres_changes`
does not honour the client's `.eq("pod_id")` — out-of-pod events still wake the
channel (the pod filter is re-applied only in the refetch).

### ⚠️ FINDING C3-1 (verified) — SupervisorAlerts mounts for every non-engineer staffer, incl. resellers/enterprise/department admins

`StaffShell` renders `<SupervisorAlerts roles={roles} />` whenever the user is
**not** an engineer:
[StaffShell.tsx:499-500](../../app/_components/StaffShell.tsx) and again at
[:803](../../app/_components/StaffShell.tsx) (`{!engineer && <SupervisorAlerts
roles={roles} />}`). Inside the component the gate is
`const isSupervisor = !isEngineer(roles)`
([StaffShell.tsx:1241](../../app/_components/StaffShell.tsx)), and the two
realtime effects bail only on `if (!isSupervisor) return`
([:1280](../../app/_components/StaffShell.tsx),
[:1354](../../app/_components/StaffShell.tsx)). So **any staff role that is not
`engineer` — `reseller`, `enterprise_admin`, `department_admin`, `super_admin`,
`supervisor` — opens both an unfiltered `guest_calls` `*` subscription (#46) and
an unfiltered `session_escalations` INSERT subscription (#47)** and will hear
the escalation ringtone ([:1405](../../app/_components/StaffShell.tsx)). This is
StaffShell mounting platform-ops alert plumbing for the enterprise/reseller
hierarchy, who have no business seeing pod escalation traffic. Whether they
actually *receive* the rows depends on RLS on `guest_calls` /
`session_escalations`, but the subscription, the toast UI, and the audible
ring are all wired regardless of pod/role scoping. Note this differs from
`useIsSupervisor()` ([lib/relay/useIsSupervisor.ts:38-64](../../lib/relay/useIsSupervisor.ts))
which correctly checks for `supervisor`/`super_admin` membership — StaffShell
does **not** use that helper here, it uses `!isEngineer`. Confirmed candidate.

### Channels mounting for the wrong audience (secondary)

- `admin-v2/NotificationBell` (#40) falls back to an **unfiltered**
  `notifications` subscription when `auth.getSession()` hasn't resolved the uid
  yet ([admin-v2/NotificationBell.tsx:121-128](../../app/_components/admin-v2/NotificationBell.tsx)).
  Comment at :112-114 admits the unfiltered case "fans out into an
  auth-request storm" — it self-corrects once uid lands, but the first
  subscription window is platform-wide.

---

## 2. Presence & heartbeat

### Engineer heartbeat — `useEngineerHeartbeat`

[lib/relay/useEngineerHeartbeat.ts](../../lib/relay/useEngineerHeartbeat.ts).
Mounted from `StaffShell` with `useEngineerHeartbeat(engineer)`
([StaffShell.tsx:316](../../app/_components/StaffShell.tsx)) — enabled only when
the user holds the engineer role.

- **Interval:** 10 s (`HEARTBEAT_MS`, :29), plus an immediate ping on mount
  (:63), and pings on `visibilitychange`/`focus`/`blur` (:80-82).
- **RPC:** `engineer_heartbeat({ _focused: document.hasFocus() })` (:56). The
  comment (:6) ties it to the matcher preferring "hot" engineers (last_seen_at
  within 30 s AND focused).
- **Skips when `document.hidden`** (:48) — screen lock (Win+L), OS sleep, tab
  backgrounded, window minimised all set `hidden=true`, so the ping stops and
  the server-side `reap_idle_engineers()` reaper flips the engineer offline
  after the 30 s idle threshold (header doc :11-20). **Skips when signed out**
  (:54, local `getSession` read, no network) to avoid 400-spamming after a
  logout in another tab.
- **Tab close:** `pagehide` fires a best-effort final `engineer_heartbeat({
  _focused: false })` (:69-78) so the matcher de-prioritises immediately; the
  unload race is tolerated.
- **What marks an engineer offline:** (a) the server reaper
  `reap_idle_engineers()` on the 30 s silence window (referenced :16); (b)
  explicit `set_engineer_presence` writes from the presence ball (below). There
  is **no client-side idle auto-offline** anymore — explicitly removed
  ([EngineerPresenceBall.tsx:384-386](../../app/_components/EngineerPresenceBall.tsx)):
  presence is manual once set, except the two narrow auto-rules below.

### `engineer_profiles.presence_state` writers / readers

- **Writers:**
  - `set_engineer_presence(_state)` RPC — manual toggles + the two auto-rules in
    `EngineerPresenceBall.recompute`
    ([EngineerPresenceBall.tsx:302-330](../../app/_components/EngineerPresenceBall.tsx)):
    on a live claimed session → `busy` (always); call-end where *we* set busy
    and no manual override since → restore `online`. On-call detection is a
    realtime sub on `guest_calls` filtered `claimed_by=eq` (#11) plus an
    initial `claimed_by + status IN (assigned,joining,live,grace)` query
    (:338-356).
  - `engineer_heartbeat` RPC stamps `last_seen_at`/focus (separate freshness
    column the matcher prefers).
  - `reap_idle_engineers()` server reaper demotes to offline.
- **Readers:**
  - `EngineerPresenceBall` (#9) and `EngineerPresenceBadge` (#13) — realtime
    `engineer_profiles` UPDATE filtered `user_id=eq`, with a legacy fallback to
    the `is_available` boolean for pre-migration rows
    ([EngineerPresenceBall.tsx:164-165](../../app/_components/EngineerPresenceBall.tsx),
    [EngineerPresenceBadge.tsx:79-84](../../app/_components/EngineerPresenceBadge.tsx)).
  - `RosterPanel` (#17) — supervisor roster, realtime `engineer_profiles` `*`.
  - The matcher RPC `match_engineer` reads presence + heartbeat freshness
    server-side (state-machines.md §2).

### `supervisor_set_online` / supervisor presence

`supervisor_set_online` is **not invoked from any client file** in `app/`/`lib/`
(no grep hit among `functions.invoke`/`.rpc` call sites). Supervisor presence is
not maintained via a heartbeat; `ScheduleClient` and `AppointmentsPanel` poll
`supervisor_bookings`/`guest_calls` instead (the table is noted as not being in
the realtime publication, [ScheduleClient.tsx:108-109](../../app/(staff)/schedule/ScheduleClient.tsx)).

### Customer-side presence — `POST /api/match/presence`

There is **no customer heartbeat**. The only customer-driven presence traffic is
a **poll** of engineer presence from the connect/engineer-picker UI:
`POST /api/match/presence` with a body of engineer ids, fired immediately and
**every 12 s while the picker is open**
([RoomClient.tsx Sidebar effect 8048-8080](../../app/room/RoomClient.tsx),
invoke at :8060). It is server-side because RLS blocks customers from reading
`engineer_profiles.presence_state` directly (room-client.md §5). The
`EngineerPickerRow` presence dot rides on this poll
([room-client.md §1, EngineerPickerRow 10723-10844](../../app/room/RoomClient.tsx)).

### EngineerPresenceBall summary

The ball ([EngineerPresenceBall.tsx](../../app/_components/EngineerPresenceBall.tsx))
multiplexes **four** realtime channels (#9–#12): own presence, incoming
match-offers (ring), on-call auto-presence, and pending callbacks (30 s
auto-ring). It is the single richest presence consumer in the app and the only
place `set_engineer_presence` is auto-written.

---

## 3. Queue / ring transport — producer → consumer wiring

Full machine + transitions in [state-machines.md §2](state-machines.md). This
section adds the **producer→consumer wiring diagram** with every listener and
its transport (channel vs poll).

### Producers (who writes `guest_calls` / `engineer_match_offers`)

- **`guest_calls` INSERT** (`queued`): RPC `get_or_create_active_customer_session`
  (customer) — callers `useCustomerSession.startNewSession`/`sendOrStart`
  ([useCustomerSession.ts:268](../../lib/relay/useCustomerSession.ts)),
  `RoomClient.handleStartInProject`/`handleNewChat` (room-client.md §5); and
  `start-guest-call` edge fn for **anonymous guests** (service-role insert,
  [start-guest-call/index.ts:190-199](../../supabase/functions/start-guest-call/index.ts)).
- **`engineer_match_offers` INSERT** (`pending`, 30 s TTL): RPC `match_engineer`
  / `retry_broadcast_match` / `launch_booked_session` (server-side; invoked from
  IntakeClient, RoomClient, QuickReturnIntake, TryRelayFunnel, the advance
  trigger, and the booking launch — full list state-machines.md §2). No client
  inserts offers directly.
- **`guest_calls` UPDATE** (claim/join/end): RPCs `claim_session`,
  `accept_match`, `mark_joined`, `release_session`, `end_session` (engineer +
  customer hooks). `reassign_needed=true` set by `match_engineer` when zero
  candidates ([state-machines.md §2](state-machines.md)).

### Consumers (who listens, where, transport)

| Consumer | Surface | Transport | File:line |
| -------- | ------- | --------- | --------- |
| Customer matching wait | `/intake/matching/[id]` | realtime #33 (`engineer_match_offers` by `intake_id`) + #34 (`guest_calls`) **+ 1.5 s poll** + client-driven `expire_stale_offers` sweep | [MatchingClient.tsx:272-315](../../app/intake/matching/[id]/MatchingClient.tsx) |
| Engineer push-ring | StaffShell (all pages) | realtime #7 (`engineer_match_offers` by `engineer_user_id`) **+ 2 s poll** | [EngineerIncomingMatch.tsx:116-133](../../app/_components/EngineerIncomingMatch.tsx) |
| Engineer ring (presence ball) | StaffShell | realtime #10 (`engineer_match_offers`) + mount poll | [EngineerPresenceBall.tsx:206-276](../../app/_components/EngineerPresenceBall.tsx) |
| Engineer ring (desktop widget) | `/widget/engineer` | realtime #8 + 2 s poll | [MatchOfferBridge.tsx:126-143](../../app/widget/engineer/MatchOfferBridge.tsx) |
| Engineer pull-queue (fallback) | `/dashboard`, `/inbox` | realtime #4/#5/#6 (`guest_calls` `*`) → `list_queue` RPC | [useEngineerQueue.ts:53-70](../../lib/relay/useEngineerQueue.ts), [useEngineerWorkspace.ts:154-176](../../lib/relay/useEngineerWorkspace.ts), [EngineerIncomingRequest.tsx:84-94](../../app/_components/EngineerIncomingRequest.tsx) |
| FIFO auto-ring | StaffShell | watches `myActive` transition → 30 s delay → `takeNext()` | [StaffShell.tsx:1143-1218](../../app/_components/StaffShell.tsx) |
| Supervisor matching board | `/supervise`, `/admin/v2` | realtime #18/#23 + 5 s poll | MatchingPanel / MatchingInline |
| Supervisor session grid | `/supervise` | realtime #15 + 5 s poll | SuperviseClient |
| Customer session row | `/room` | realtime #1 (`guest_calls` by id) | useCustomerSession |

### Diagram

```
 CUSTOMER                          SERVER (RPCs/triggers)                ENGINEER
 ───────                           ──────────────────────                ────────
 get_or_create_session ─────────▶ guest_calls INSERT(queued)
 start-guest-call (guest) ───────▶ guest_calls INSERT(queued)
        │                                  │
        │  match_engineer / retry ─────────┤ engineer_match_offers INSERT(pending,30s)
        │                                  │            │ realtime push (filter engineer_user_id)
        ▼                                  ▼            ▼
 MatchingClient #33/#34          advance_match_on_     EngineerIncomingMatch #7 (+2s poll)
 (+1.5s poll, expire sweep)      offer_close trigger   EngineerPresenceBall #10
        │                                  ▲            MatchOfferBridge #8 (desktop)
        │ accept_match ────────────────────┘                 │ accept_match
        ▼                                                     ▼
 guest_calls UPDATE(assigned) ──realtime #1──▶ room        /staff/session/[id]
                              ──realtime #4/5/6──▶ queue refetch
 zero candidates → reassign_needed=true ──realtime #46──▶ SupervisorAlerts toast
```

The **bimodal ~0.5 s vs ~31 s ring latency** root cause (first-rung vs
second-rung engineer, gated by the 30 s offer TTL + the customer's 1.5 s sweep
cadence because **no server cron sweeps offers**) is fully derived in
[state-machines.md §2 "Bimodal ring latency"](state-machines.md) — not re-filed
here.

---

## 4. Zoom lifecycle wiring

Two parallel stacks share one DB table (`guest_calls`) and one chat
string-protocol but never the same id column: **Video SDK** (default, keys on
`guest_calls.id` via `video_topic`/`session_key`) and **Meeting SDK** (legacy,
keys on `zoom_meeting_id`). Surface gate `isVideoSdkEnabled()` default-ON
([state-machines.md §3](state-machines.md)).

### Edge functions — invoker, auth, DB writes

| Function | Invoked by (file:line) | Auth | Writes back to DB |
| -------- | ---------------------- | ---- | ----------------- |
| `zoom-video-sdk-token` | client `useZoomCall` join via `CallSurface` ([RoomClient.tsx:2160-2169](../../app/room/RoomClient.tsx), [useZoomCall.ts:211](../../lib/video/useZoomCall.ts)); engineer side ([EngineerSessionClient.tsx](../../app/staff/session/[id]/EngineerSessionClient.tsx)) | ✅ user JWT; caller must be `claimed_by` / `customer_user_id` / session-supervisor / acked-escalation supervisor, else 403 ([zoom-video-sdk-token/index.ts:93-133](../../supabase/functions/zoom-video-sdk-token/index.ts)) | idempotent `video_topic` stamp (:138-144); **posts "📞 Zoom meeting started" system message** (deduped vs latest started/ended, :152-173); `session_video_events` audit (:207) |
| `zoom-video-sdk-end` | client `useZoomCall.leave()` ([useZoomCall.ts:1051](../../lib/video/useZoomCall.ts)); `pagehide` beacon ([useZoomCall.ts:555-575](../../lib/video/useZoomCall.ts)) | ✅ user JWT; engineer/customer/supervisor (roles via `user_role_names`) ([zoom-video-sdk-end/index.ts:76-100](../../supabase/functions/zoom-video-sdk-end/index.ts)) | `video_ended_at` (engineer/supervisor only, :106-112); clears leaving party's `*_joined_at` (:119-124); **posts "📞 Zoom meeting ended"** (deduped, :131-163); chains `summarize-call` (not summarize-guest-call — comment :178-181 notes the prior bug); audit (:166) |
| `zoom-video-webhook` | **Zoom cloud** (session.started/ended/recording.completed) | ✅ HMAC `ZOOM_VIDEO_WEBHOOK_SECRET` (`v0:ts:body`, :53-63) — **but returns `true` (allow) when secret unset** (:57); CRC challenge (:320-327) | started: `video_started_at` + `call_sessions` upsert (:104-147); ended: `video_ended_at` + `call_sessions` complete + **`debit_credits` billing** (~16.67 credits/min, :149-218) + "📞 Zoom meeting ended · N min" msg; recording: `recording_play_url`/`password`/`duration_minutes` + **supervisor-visibility** "🎥 Recording available" msg (:255-304); audit each |
| `zoom-sdk-signature` | legacy Meeting SDK: `ZoomEmbed`/`ZoomCall` ([ZoomEmbed.tsx:642](../../app/_components/ZoomEmbed.tsx), [ZoomCall.tsx:193](../../app/_components/ZoomCall.tsx)) | ❌ **no Supabase auth check** — anyone with `meetingNumber` gets a signed Meeting-SDK JWT (+ password + host zak for role=1) ([zoom-sdk-signature/index.ts:114-204](../../supabase/functions/zoom-sdk-signature/index.ts)) | none (read-only: reads `guest_calls.zoom_start_url` for zak) |
| `create-zoom-meeting` | (no client invoke site found in `app/`/`lib/` — legacy) | ✅ user JWT (`getUser`, :55) | inserts/updates `guest_calls` Zoom columns via service role (:90+) |
| `mint-zoom-for-session` | engineer auto-mint when Video SDK **off** ([EngineerSessionClient.tsx:320, 1695, 1735](../../app/staff/session/[id]/EngineerSessionClient.tsx)) | ✅ user JWT; `claimed_by` or `customer_user_id`, requires `claimed_by` set ([mint-zoom-for-session/index.ts:244-277](../../supabase/functions/mint-zoom-for-session/index.ts)) | `zoom_meeting_id`/`join_url`/`start_url`; posts started message; idempotent reuse |
| `end-zoom-meeting` | both end paths fire-and-forget ([useCustomerSession.ts:500](../../lib/relay/useCustomerSession.ts), [useEngineerSession.ts:274](../../lib/relay/useEngineerSession.ts), [RoomClient.tsx:290](../../app/room/RoomClient.tsx), [EngineerSessionClient.tsx:2153](../../app/staff/session/[id]/EngineerSessionClient.tsx)) | ✅ user JWT; engineer **or** customer participant only (supervisors forbidden) ([end-zoom-meeting/index.ts:97-108](../../supabase/functions/end-zoom-meeting/index.ts)) | Zoom REST `PUT /status {action:end}` (3027 tolerated); posts "📞 Zoom meeting ended" (deduped); no-op success if no `zoom_meeting_id` (:109-117) |
| `start-guest-call` | (no client invoke site in `app/`/`lib/` — anonymous-guest path, likely legacy/desktop) | ❌ **NO auth check at all** — reads only a guest name from body ([start-guest-call/index.ts:64-87](../../supabase/functions/start-guest-call/index.ts)) | service-role inserts `guest_calls` + creates Zoom instant meeting; **calls `endAllLiveMeetings()` first (ends EVERY live Zoom on the account)** (:149) |
| `restart-guest-zoom` | (no client invoke site found) | ❌ **NO auth check** — reads `guest_call_id` from body ([restart-guest-zoom/index.ts:61-72](../../supabase/functions/restart-guest-zoom/index.ts)) | re-mints/reuses Zoom meeting on the session via service role |
| `zoom-webhook` | **Zoom cloud** (Meeting SDK meeting.started/ended) | ✅ HMAC `ZOOM_WEBHOOK_SECRET_TOKEN` — **allow when unset** (:40) | bills via `debit_credits` keyed on `request_messages.meeting_zoom_id` → `requests` (legacy request model, [zoom-webhook/index.ts:49-70](../../supabase/functions/zoom-webhook/index.ts)) |

### System-message string protocol (cross-ref room-client.md P1-6)

The two SDK stacks, both webhooks, and four edge functions all coordinate the
call UI purely through **chat-message body string literals** inserted into
`guest_messages`:

- `"📞 Zoom meeting started"` — posted by `zoom-video-sdk-token`
  ([:166](../../supabase/functions/zoom-video-sdk-token/index.ts)) and
  `mint-zoom-for-session`.
- `"📞 Zoom meeting ended"` — posted by `zoom-video-sdk-end`
  ([:159](../../supabase/functions/zoom-video-sdk-end/index.ts)),
  `zoom-video-webhook` ([:229](../../supabase/functions/zoom-video-webhook/index.ts),
  appends `· N min`), and `end-zoom-meeting`
  ([:181](../../supabase/functions/end-zoom-meeting/index.ts)).
- `"🎥 Recording available"` — `zoom-video-webhook` with
  `visibility:"supervisor"` ([:300](../../supabase/functions/zoom-video-webhook/index.ts)).

**Dedup is done by ilike-matching these strings** (`.or("body.ilike.%Zoom
meeting started%,body.ilike.%Zoom meeting ended%")`) and comparing timestamps of
the latest started/ended pair — in *every* producer. **UI gates that parse the
same strings:** `callStarted` memo ([RoomClient.tsx:549-562](../../app/room/RoomClient.tsx)),
the meeting-card pairing maps ([ChatPane 12400-12433](../../app/room/RoomClient.tsx)),
and the supervisor-only filter (`isSupervisorOnlyMessage` matches `"Recording
available"`, [useIsSupervisor.ts:23-30](../../lib/relay/useIsSupervisor.ts)). This
is **P1-6** in room-client.md §8: any copy change in any edge function silently
breaks join-gating and dedup across all surfaces. `CallHeaderActions` carries a
column-based fallback (`engineer_joined_at` / status) precisely because a
dropped realtime event used to dead-button the customer
([room-client.md §7, RoomClient.tsx:7163-7166](../../app/room/RoomClient.tsx)).

---

## 5. Stripe wiring

### Checkout / credit functions — caller, what each credits

| Function | Caller (file:line) | Auth | Credits / debits |
| -------- | ------------------ | ---- | ---------------- |
| `create-relay-checkout` | `PaywallModal` ([PaywallModal.tsx:101-106](../../app/_components/PaywallModal.tsx)) | ✅ user JWT (`getUser`, [create-relay-checkout/index.ts:56-67](../../supabase/functions/create-relay-checkout/index.ts)) | mints Stripe session/PI with `relay_user_id`/`relay_plan`/`relay_minutes` metadata (plans base/pro/max, [pricing.ts:28-71](../../lib/relay/pricing.ts)); credits applied later by webhook/`credit-relay-payment` |
| `credit-relay-payment` | `PaywallModal` belt-and-braces after Stripe return ([PaywallModal.tsx:694-698](../../app/_components/PaywallModal.tsx)) | ✅ user JWT; **verifies PI belongs to caller** (`piUserId !== u.user.id` → 403, [credit-relay-payment/index.ts:117](../../supabase/functions/credit-relay-payment/index.ts)) | re-retrieves PI from Stripe, requires `status==succeeded`; **idempotent by `credit_transactions.stripe_session_id`** (:130-150); credits `credit_wallets.balance` + `customer_entitlements.paid_minutes_remaining` |
| `create-guest-checkout` | (no client invoke site found) | — | guest extension (`meta.kind=guest_extension`) → webhook bumps `guest_calls.free_minutes` |
| `create-credits-checkout` | (no client invoke in core surfaces) | ✅ user JWT (:22-32) | legacy `credit_purchase` path → webhook `credit_credits` RPC |
| `create-enterprise-checkout` | enterprise wallet flow | ✅ user JWT (:51-61) | enterprise minute bundles |
| `payments-webhook` | **Stripe cloud** | ✅ HMAC via shared `verifyWebhook` (see below) | on `checkout.session.completed`/`transaction.completed`: relay-plan → wallet+ledger+entitlements (idempotent by session id, [payments-webhook/index.ts:36-45](../../supabase/functions/payments-webhook/index.ts)) **+ auto-resume newest `expired_free` session via `extend_session_paid_admin`** (:111-130); guest_extension → `free_minutes` bump (:135-167); credit_purchase → `credit_credits` RPC |
| `relay-stripe-webhook` | **Stripe cloud** (newer PI path) | ✅ HMAC, **own inline verifier** (see below) | `payment_intent.succeeded`/`checkout.session.completed` → wallet+ledger+entitlements, idempotent by object id ([relay-stripe-webhook/index.ts:119-128](../../supabase/functions/relay-stripe-webhook/index.ts)) |

### Webhook signature verification (verified in code)

Both webhook paths **do** verify the Stripe signature, hand-rolled (no Stripe
SDK `constructEvent`):

- Shared `verifyWebhook` ([_shared/stripe.ts:27-75](../../supabase/functions/_shared/stripe.ts)),
  used by `payments-webhook`: parses `stripe-signature` `t=`/`v1=`, **rejects
  age > 300 s** (:54-55), HMAC-SHA256 over `${t}.${body}`, constant-set
  membership check `v1Signatures.includes(expected)` (:71). Secret resolution
  prefers `STRIPE_WEBHOOK_SECRET` then env-specific sandbox/live secrets;
  throws if none. ✅
- `relay-stripe-webhook` has a **duplicate inline verifier**
  ([relay-stripe-webhook/index.ts:28-68](../../supabase/functions/relay-stripe-webhook/index.ts))
  with the same 300 s window and HMAC scheme. ✅
- ⚠️ **Timing note:** both use `v1.includes(expected)` (plain string equality,
  not constant-time). Low risk (HMAC), but not a constant-time compare.

### Idempotency

- Credit paths dedupe on `credit_transactions.stripe_session_id` (the column
  holds either a checkout-session id or a PI id) — `payments-webhook`,
  `relay-stripe-webhook`, and `credit-relay-payment` all check-then-insert
  against it. **Not transactional** — a check-then-insert race exists, but the
  unique slot makes a duplicate insert fail; net effect bounded.
- Enterprise wallet top-up ([/api/enterprise/wallet/topup](../../app/api/enterprise/wallet/topup/route.ts))
  uses a **weaker** idempotency: it reads the PI, checks
  `pi.metadata.relay_credited !== "1"`, credits `organizations.allocated/
  remaining_minutes`, then **stamps `relay_credited=1` on the PI as a
  best-effort POST** (:101-129). ⚠️ This is a non-atomic check-then-credit on a
  remote (Stripe) flag — two concurrent topup calls for the same PI can both
  pass the `!== "1"` check before either stamps → **double-credit risk**
  (FINDING C5-1). The customer wallet path's DB-row dedupe (above) is stronger.

### Paywall-resume path

Stripe success → redirect `?relay_paid=<plan>` ([RoomClient.tsx:886-908](../../app/room/RoomClient.tsx))
clears the paywall + delayed `state.refresh()`; **independently** the webhook
`extend_session_paid_admin` flips the newest `expired_free` session →
`live` server-side ([payments-webhook/index.ts:111-130](../../supabase/functions/payments-webhook/index.ts)),
and the realtime `guest_calls` UPDATE (#1) lands the customer back in the live
room ([useCustomerSession.ts:397-412](../../lib/relay/useCustomerSession.ts)).
`PaywallModal` also calls `credit-relay-payment` as a third, belt-and-braces
resume trigger. Full money-flow diagram in [state-machines.md §4](state-machines.md).

### Direct-from-Stripe API routes (Next.js, not edge fns)

`/api/billing/payment-methods` + `/setup-intent` call Stripe REST directly with
a per-customer `stripe_customer_id` (auth via `sb.auth.getUser()`,
[setup-intent/route.ts:74](../../app/api/billing/payment-methods/setup-intent/route.ts)).
`/api/enterprise/wallet/{checkout,topup,activate-plan}` use `requireEnterpriseAdmin`
+ `lib/stripe/server.stripeRequest`.

---

## 6. AI edge functions & routes

### ⚠️ FINDING C6-1 (verified) — "Anthropic Claude" is documentation fiction; everything runs on OpenAI + Groq

CLAUDE.md ("Anthropic Claude session-health scoring and summarization") and
[00-ground-truth.md §6](00-ground-truth.md) (which buckets these as "AI
(Anthropic)") are **wrong**. No AI surface in the repo calls Anthropic. Verified
endpoints/models:

| Function / route | Trigger | Model · endpoint | Reads / writes | Auth |
| ---------------- | ------- | ---------------- | -------------- | ---- |
| `score-session-health` | **pg_cron, 1/min** ([:3](../../supabase/functions/score-session-health/index.ts)) | `gpt-4o-mini` · `api.openai.com/v1/chat/completions` ([:240](../../supabase/functions/score-session-health/index.ts)) | reads live `guest_messages`; writes `session_health` (consumed by SuperviseClient #15/#17) | service role (cron) |
| `summarize-call` | session-end chain from `zoom-video-sdk-end` ([:183-189](../../supabase/functions/zoom-video-sdk-end/index.ts)) | `gpt-4o-mini` · OpenAI ([:156](../../supabase/functions/summarize-call/index.ts)) | call-only recap capsule into the room **without** flipping status | service role |
| `summarize-guest-call` | every session-end path (fire-and-forget) ([useCustomerSession.ts:503](../../lib/relay/useCustomerSession.ts), [useEngineerSession.ts:277](../../lib/relay/useEngineerSession.ts), [RoomClient.tsx:287](../../app/room/RoomClient.tsx)) + `zoom-video-webhook` ([:242](../../supabase/functions/zoom-video-webhook/index.ts)) | `gpt-4o-mini` · OpenAI ([:290, 481](../../supabase/functions/summarize-guest-call/index.ts)) | drives `summary_state` machine; writes `guest_calls.intake_summary`/summary + `duration_minutes`; a `tick_summary_watchdog` pg_cron backs it (:44) | service role |
| `summarize-customer` | (customer-level rollup) | `gpt-4o-mini` · OpenAI ([:112](../../supabase/functions/summarize-customer/index.ts)) | `customer_summaries` (read by BrandedLanding, room-client.md) | service role |
| `summarize-project` | session end ([RoomClient.tsx:7487](../../app/room/RoomClient.tsx) comment) | `gpt-4o-mini` · OpenAI ([:127](../../supabase/functions/summarize-project/index.ts)); self-chains via service-role fetch (:197) | project-level summary | service role |
| `summarize-intake` | `MatchingClient` on accept ([MatchingClient.tsx:324](../../app/intake/matching/[id]/MatchingClient.tsx)) | `gpt-4o-mini` · OpenAI ([:166](../../supabase/functions/summarize-intake/index.ts)) | `client_intakes.intake_summary` for the engineer tray | user JWT (invoke) |
| `regenerate-guest-brief` | (brief refresh) | **`llama-3.3-70b-versatile` · `api.groq.com`** ([:74-82](../../supabase/functions/regenerate-guest-brief/index.ts)) | guest brief | service role |
| `morning-brief` | **pg_cron `0 8 * * *`** ([:17-21](../../supabase/functions/morning-brief/index.ts)) | (composes + SendGrid email, no LLM call seen) | reads sessions; sends email via SendGrid | service role (cron, Bearer) |
| `transcribe-chunk` | live call, per-participant **every 30 s** ([useZoomCall.ts:725](../../lib/video/useZoomCall.ts)) | **`whisper-1` · `api.openai.com/v1/audio/transcriptions`** ([:99-104](../../supabase/functions/transcribe-chunk/index.ts)) | writes caption rows | service role |
| `POST /api/intake/turn` | customer intake bot turn | `gpt-4o-mini` · OpenAI, `response_format=json_object` ([intake/turn/route.ts:28-29](../../app/api/intake/turn/route.ts)) | intake transcript/state | session (route handler) |
| `POST /api/assistant` | in-room assistant | `OPENAI_MODEL ?? gpt-4o-mini` · OpenAI; heuristic fallback on no-key/error ([assistant/route.ts:140-163](../../app/api/assistant/route.ts)) | none persisted | session |
| `POST /api/engineer/ai-ask` | engineer assistant (streaming) | **`gpt-4o` · `@ai-sdk/openai` streamText** ([engineer/ai-ask/route.ts:28-39, 211](../../app/api/engineer/ai-ask/route.ts)) | RAG over session context; onFinish persists | engineer session |
| `POST /api/staff/project-qa` | staff project Q&A | `OPENAI_MODEL ?? gpt-4o-mini` · OpenAI; threadId persistence ([staff/project-qa/route.ts:439-447](../../app/api/staff/project-qa/route.ts)) | project context RAG | staff session |

So: **OpenAI `gpt-4o-mini`** is the workhorse (every summarizer + cron scorer +
intake/assistant), **`gpt-4o`** for the engineer streaming assistant,
**`whisper-1`** for transcription, and **Groq `llama-3.3-70b-versatile`** for
one brief regenerator. The `claude-api` skill / Anthropic SDK is not used
anywhere in the AI path. (This contradicts CLAUDE.md and ground-truth §6 —
flag for doc correction, not a code bug.)

---

## 7. Cross-cutting risks spotted (feed Phase 4)

Connection-level fragilities only:

1. **C3-1 — SupervisorAlerts mounts for resellers/enterprise/department/super
   admins** (verified §1). `StaffShell` gates on `!isEngineer` not on actual
   supervisor membership, so the whole non-engineer staff hierarchy opens two
   unfiltered platform-wide subscriptions (`guest_calls` `*`,
   `session_escalations` INSERT) and hears the escalation ringtone. RLS is the
   only thing scoping the data; the UI/audio plumbing is unconditional.
   [StaffShell.tsx:499-500, 803, 1240-1413](../../app/_components/StaffShell.tsx).

2. **C5-1 — Enterprise wallet top-up double-credit race**: non-atomic
   check-then-credit gated on a remote Stripe PI metadata flag
   (`relay_credited`), stamped best-effort *after* the DB credit
   ([wallet/topup/route.ts:101-129](../../app/api/enterprise/wallet/topup/route.ts)).
   Concurrent calls (or a webhook + client both firing) can double-add minutes
   to `organizations.allocated/remaining_minutes`. The customer wallet path's
   `credit_transactions` row-dedupe is stronger and should be the model.

3. **Unauthenticated, side-effecting Zoom edge functions**: `start-guest-call`
   ([:64-87](../../supabase/functions/start-guest-call/index.ts)) and
   `restart-guest-zoom` ([:61-72](../../supabase/functions/restart-guest-zoom/index.ts))
   take **no auth** and create/restart Zoom meetings + insert `guest_calls`
   rows under service role from an arbitrary POST body. `start-guest-call`
   additionally calls **`endAllLiveMeetings()` — ending EVERY live Zoom on the
   account** (:149) before creating its own; a single unauthenticated request
   could nuke all in-progress sessions' Zoom calls. No client invoke sites were
   found for either (likely legacy/desktop), so they may be dead — but if
   deployed they are open. `zoom-sdk-signature` likewise has **no Supabase auth**
   ([:114-204](../../supabase/functions/zoom-sdk-signature/index.ts)): a signed
   host JWT + meeting password + zak for any `meetingNumber`.

4. **Webhook secret "allow when unset"**: both `zoom-webhook` (:40) and
   `zoom-video-webhook` (:57) `return true` from signature verification when the
   secret env var is empty. A misconfigured/blank `ZOOM_*_WEBHOOK_SECRET` turns
   both billing-affecting webhooks (they call `debit_credits`) into unsigned
   open endpoints. Stripe webhooks do **not** have this hole (they throw).

5. **String-protocol coupling (P1-6, §4)**: 4 edge fns + 2 webhooks + 3 UI gates
   coordinate call state and dedup purely by ilike-matching the literals "📞
   Zoom meeting started/ended" and "🎥 Recording available". No shared constant;
   a copy change anywhere breaks join-gating + dedup everywhere.

6. **Realtime is trusted nowhere**: ~30 of 47 channels pair with a poll
   (1.5 s–15 s) or focus-refetch fallback, and several leave comments that
   Supabase "drops postgres_changes events." The customer session channel (#1)
   and engineer session channel (#3) are the notable exceptions — both are
   **INSERT-only with no catch-up refetch on reconnect** (CHAT-LOSS-1,
   room-client.md §8): messages inserted during a websocket gap are absent until
   a manual `refresh()`. The aggregate poll load (every supervisor view polling
   every 5 s, each poll re-validating auth through the proxy) is itself a load
   risk flagged in admin-v2/NotificationBell's own comments (:81-89).

7. **Unfiltered subscriptions lean entirely on RLS** (§1, 21 channels). Where an
   RLS policy is broad (super_admin/supervisor matching policies), an unfiltered
   `*` subscription fans the whole platform's change stream into a client. The
   `REPLICA IDENTITY DEFAULT` caveat is also live: `engineer_match_offers` `old`
   payloads carry only the PK, which already caused a stuck-ring bug
   ([EngineerPresenceBall.tsx:231-237](../../app/_components/EngineerPresenceBall.tsx))
   — the same caveat applies to every UPDATE handler that reads `payload.old`,
   and to the `guest_calls` UPDATE merge if the table lacks `REPLICA IDENTITY
   FULL` (room-client.md §8 note 8, still open for Phase 3 DB verification).
</content>
</invoke>
