# Component map — `EngineerSessionClient.tsx`

**File:** `app/staff/session/[id]/EngineerSessionClient.tsx` (3,123 lines, `"use client"`)
**Entry:** `EngineerSessionClient({ sessionId })` — the engineer/supervisor session room, mirroring the customer `/room` layout (header comment, lines 3–16).

---

## 1. Components defined

| Component | Lines | Role |
| --- | --- | --- |
| `EngineerSessionClient` (exported) | 92–669 | Top-level orchestrator: hooks, effects, layout switch (call open vs chat), error toasts |
| `MainPane` | 672–727 | Layout decider: ended → split chat + `ReviewPanel`; active → full-width `ChatPane` |
| `Sidebar` | 738–1212 | 260px (drag-resizable 220–460px) rail: customer card, current-session pill, past sessions, project memory, viewer chip, escalation flag/button |
| `ProjectChatSearch` | 1215–1332 | Supervisor-only project-wide chat search (G2) |
| `SessionEscalationFlag` | 1335–1422 | Latest escalation banner for this session (realtime-refreshed) (G3) |
| `EscalateButton` | 1434–1601 | Engineer "Escalate to supervisor" button + modal |
| `FloatingStatus` | 1604–1919 | Top-right HUD: timer, status pill, start-video, end-session, release |
| `StatusPill` / `pillConfig` | 1921–1946 / 1948–1997 | Status/urgency pill (Live / Joining call / On call / Reconnect… / Free expired / Critical / Urgent) |
| `ConfirmEndModal` | 1999–2080 | End-session confirmation dialog |
| `ChatPane` | 2083–2405 | Message list (Zoom-card pairing, date separators, supervisor-only filtering) + composer footer |
| `Message` | 2407–2496 | Single chat bubble (system pill w/ attachments, engineer/guest bubbles, time + tick) |
| `DateSeparator` | 2503–2533 | Today/Yesterday/date pill between days |
| `ReviewPanel` | 2539–2608 | Post-ended right rail: Summary header + transcript download + `SummaryView` |
| `SummaryView` | 2610–2808 | `summary_state` machine rendering + `EditableSummary` + Zoom AI Companion summaries |
| `Resizer` | 2811–2843 | `PanelResizeHandle` with grip dots |
| `ErrorToast` | 2845–2877 | Bottom-center error toast with dismiss |
| `ProjectMemorySection` | 2898–3047 | Collapsible "every session on this project" list (lazy fetch) |
| Helpers: `buildTranscript` | 3055–3100 | Plain-text transcript (filters Zoom machinery / AI summary system rows) |
| Helpers: `groupByDate` | 3102–3123 | Today / Yesterday / Previous 7 Days / Older bucketing |

Brand color constants at 83–89.

---

## 2. State inventory (grouped by concern)

### Identity / role (EngineerSessionClient)
- `meEmail` (102) — viewer email from `auth.getUser()`.
- `isSupervisor` (108) — via `useIsSupervisor()`; locks read-only monitor chrome.
- `joinIntent` (119–120) — `?join=1` search param; lifts supervisor read-only chat lock.
- `isAppointment` / `supervisorCanChat` (128–129) — appointment supervisors chat as "Moderator".

### Call surface
- `started` (179) — legacy Meeting-SDK embed mount flag; reset on ended/queued (203–210).
- `autoMinting` (180), `autoStartError` (181) — legacy auto-mint progress/error.
- `callOpen` (194) — mounts in-window `<CallSurface>`; `launchCall` (195–197) is `() => setCallOpen(true)` only when `isVideoSdkEnabled()`.

### One-shot guards (refs)
- `supJoinedRef` (135) — `mark_supervisor_joined` once per appointment session.
- `escJoinedRef` (155) — `supervisor_join_escalation` once per `?join=1` session.
- `prepHandedRef` (226) — customer-prep handoff once per session.
- `prevStatusRef` (375) — detects live→ended transition for the redirect.

### Misc
- `popupHint` (405) — pop-up-blocked hint after Accept tried to auto-open the assistant tab.
- `sess` (441) — local alias for the watchdog effect.

### Sidebar
- `alias` (754) — engineer display alias (`engineer_profiles.display_alias`).
- `past` (778) — past sessions on this customer thread.
- `collapsed` (818) — 56px icon rail vs full panel.
- `sidebarWidth` (826) + localStorage `relay:eng-session-sidebar-width` (827–855); `sidebarDragging` (856) + `startSidebarDrag` (857–879).

### FloatingStatus
- `busyStart` (1616), `confirmEnd` (1617), `mintError` (1618), `minting` (1619), `[, force]` 1s tick during `expired_free` (1653–1658).
- Derived: `isPreLive`/`isLive`/`isEnded`/`isExpiredFree`/`isTimerActive`/`hasMeeting`/`inCall` (1621–1629); `zoomEnded`/`showStartMeetingButton` from last Zoom system message (1638–1650); `bufferRemainingLabel` (1660–1666).

### ChatPane
- `mintError` (2104) — from `handleCancelMeeting`. `scrollRef` (2100).
- Derived meeting-pairing maps: `meetingEnded`/`meetingSummary`/`meetingRecording` + suppressed-id sets (2179–2212).

### Others
- `ProjectChatSearch`: `q`, `results`, `busy` (1217–1228).
- `SessionEscalationFlag`: `esc` (1336–1341).
- `EscalateButton`: `open`, `reason`, `note`, `busy`, `done`, `err` (1435–1440).
- `ConfirmEndModal`: `busy` (2006).
- `ProjectMemorySection`: `open`, `rows` (2909–2910).

---

## 3. Hooks consumed

| Hook | Call site | Source |
| --- | --- | --- |
| `useEngineerSession(sessionId)` | 94 | `lib/relay/useEngineerSession.ts` — session row + messages + realtime + actions (`sendBundle`, `end`, `release`, `markJoined`, `refresh`, `isAssignedEngineer`, `viewerUserId`) |
| `useSessionTimer(assigned_at ?? joined_at, free_minutes ?? 10)` | 98–101 | `lib/relay/useSessionTimer.ts` — wrapper over `computeSessionClock`; staff mode counts up |
| `useIsSupervisor()` | 108, 1632 (FloatingStatus), 2098 (ChatPane) | `lib/relay/useIsSupervisor.ts` — `user_role_names` contains `supervisor`/`super_admin` |
| `useLaunchCall()` / `LaunchCallProvider` / `isVideoSdkEnabled()` | 1633 / 494 / 195, 308 | `lib/video/LaunchCallContext.tsx` — Video SDK is default; only `NEXT_PUBLIC_USE_VIDEO_SDK="false"` disables (LaunchCallContext.tsx:59–67) |
| `useSearchParams()` | 119 | `?join=1` supervisor join intent |
| `useOverlayDismiss` | 1442 (EscalateButton) | `lib/relay/useOverlayDismiss` |
| `useRouter()` | 93, 749, 1216 | navigation |
| `useSessionTimer` return also consumed by `Sidebar`/`FloatingStatus` via props | 525–530, 566–571 | — |

Indirect (children): `CallSurface` → `useZoomCall` (`lib/video/useZoomCall.ts`); `isSupervisorOnlyMessage` (2290) from `useIsSupervisor.ts:23`.

---

## 4. Effects (dependency → purpose)

### EngineerSessionClient
| Lines | Deps | Purpose |
| --- | --- | --- |
| 136–148 | `session.id`, `is_appointment`, `isSupervisor` | RPC `mark_supervisor_joined` once per appointment session (stops customer ring) |
| 156–171 | `session.id`, `status`, `isSupervisor`, `joinIntent` | RPC `supervisor_join_escalation` once when supervisor arrives via `?join=1` (skipped on ended) |
| 198–200 | `session.status` | Close `CallSurface` (`setCallOpen(false)`) when session ends |
| 203–210 | `session.id`, `status` | Reset `started` on ended/queued |
| 227–292 | `session.id/status`, `isAssignedEngineer`, `isSupervisor`, **whole `state` object** | Customer-prep handoff: RPC `engineer_fetch_customer_draft` → insert system prelude + guest message into `guest_messages` → `state.refresh()`. Once per session via `prepHandedRef`. Contains TEMP DIAGNOSTIC `console.warn` (230–239) |
| 303–351 | `session.id/status/zoom_meeting_id`, `started`, `autoMinting` | Legacy Meeting-SDK auto-start: invoke `mint-zoom-for-session` when pre-live; skipped entirely when `isVideoSdkEnabled()` / supervisor / not assigned (guards in body, not deps) |
| 353–367 | `[]` | `auth.getUser()` → `meEmail` |
| 376–401 | `status`, `project_id`, `router`, `isSupervisor`, `sessionId` | On live→ended transition: `broadcastAssistantEnd(sessionId)`, then 3s-delayed redirect to `/staff/project/{projectId}` (engineer) / `/inbox` (no project) / `/supervise` (supervisor) |
| 406–412 | `[]` | `consumePopupBlockedFlag()` → 7s `popupHint` |
| 419–433 | `session.status` | Desktop-shell bridge `window.relay.setSessionActive(active)` while non-terminal |
| 442–456 | `sess.status`, `free_expired_at`, `state`, `isSupervisor` | Payment-buffer watchdog: `state.end("payment_buffer_expired")` 10 min after `free_expired_at`; skipped for supervisors |

### Sidebar
| Lines | Deps | Purpose |
| --- | --- | --- |
| 755–773 | `isSupervisor` | Load own `engineer_profiles.display_alias` |
| 780–810 | `thread_id`, `session.id` | Load up to 20 ended `guest_calls` on the same thread (past sessions) |
| 827–844 / 845–855 | `[]` / `sidebarWidth` | Read/persist sidebar width in localStorage |

### Other components
| Lines | Component | Purpose |
| --- | --- | --- |
| 1342–1384 | SessionEscalationFlag | Load latest `session_escalations` row + realtime channel re-load |
| 1654–1658 | FloatingStatus | 1s re-render tick while `expired_free` (buffer countdown) |
| 2106–2111 | ChatPane | Smooth scroll-to-bottom on `messages.length` change |
| 2118–2144 | ChatPane | Supervisor with an **acked** escalation row → RPC `mark_escalation_joined` |
| 2912–2944 | ProjectMemorySection | Lazy fetch up to 40 `guest_calls` for the project when expanded |

---

## 5. Supabase realtime channels / subscriptions

| Channel | Where | Events |
| --- | --- | --- |
| `relay-eng-session:${sessionId}` | `lib/relay/useEngineerSession.ts:124–180` (consumed via hook at line 94) | `UPDATE public.guest_calls` (`id=eq.{sessionId}`) → merge into `session`; `INSERT public.guest_messages` (`guest_call_id=eq.{sessionId}`) → append + async hydrate `guest_message_attachments` |
| `session-escalation-${sessionId}` | EngineerSessionClient.tsx:1365–1379 (SessionEscalationFlag) | `*` on `public.session_escalations` (`session_id=eq.{sessionId}`) → re-load banner |

---

## 6. Network calls

### Supabase RPCs (browser client)
| RPC | Line | Trigger |
| --- | --- | --- |
| `mark_supervisor_joined` | 143 | appointment supervisor mount |
| `supervisor_join_escalation` | 166 | supervisor `?join=1` mount |
| `engineer_fetch_customer_draft` | 249 | prep-handoff effect (note: comment at 217–221 claims this was replaced by `/api/engineer/customer-draft`, but the code calls the RPC) |
| `engineer_escalate_session` | 1448 | EscalateButton submit |
| `mark_escalation_joined` | 2137 | supervisor opens session with acked escalation |
| `update_guest_call_summary` | 2647 | EditableSummary save |
| `update_guest_message_body` / `delete_guest_message` | 2783 / 2794 | Zoom Companion summary edit / delete |
| Via `useEngineerSession`: `end_session` (264), `release_session` (286), `mark_joined` (`_role:"engineer"`, 294) | useEngineerSession.ts | end / release / join actions |

### Edge function invokes
| Function | Lines | Trigger |
| --- | --- | --- |
| `mint-zoom-for-session` | 319 (auto-start), 1694 (`startVideo`), 1735 (`handleStartMeeting`) | legacy Meeting-SDK mint/restart |
| `end-zoom-meeting` | 2153 (`handleCancelMeeting`); useEngineerSession.ts:274 (fire-and-forget on `end`) | hang up Zoom |
| `summarize-guest-call` | useEngineerSession.ts:277 | fire-and-forget on `end` |
| `zoom-video-sdk-token`, `transcribe-chunk`, `zoom-video-sdk-end` | lib/video/useZoomCall.ts:211, 725, 1051 (via mounted `CallSurface`) | Video SDK join token / live transcription / end signal |

### Next.js API routes
| Route | Line | Trigger |
| --- | --- | --- |
| `GET /api/supervisor/chat-search?projectId&q` | 1234–1237 | ProjectChatSearch (supervisor sidebar) |
| `POST /api/engineer/ai-ask` | app/_components/EngineerAiAsk.tsx:196 (child, rendered at 2390) | inline project-AI question |

### Direct table reads/writes (this file)
- `guest_messages` insert ×2 (prep prelude + customer text) — 262–275.
- `engineer_profiles` select `display_alias` — 762–766.
- `guest_calls` select (past sessions 784–793; project memory 2917–2924).
- `session_escalations` select (1346–1352, 2127–2133).

---

## 7. Event handlers + enable/disable conditions

| Element | Handler | Visible / enabled when | Lines |
| --- | --- | --- | --- |
| Start-video round button (HUD) | `launchCall()` (Video SDK → `setCallOpen(true)`) else `startVideo()` (mint + open popup + `markJoined`) | visible: `showStartMeetingButton` (= `isAssignedEngineer && (!zoom_meeting_id \|\| zoomEnded)`) OR `isApptSupervisor && launchCall`; disabled: `busyStart` | 1854–1885 |
| End session | `setConfirmEnd(true)` → modal → `state.end()` | `isAssignedEngineer && (isLive \|\| isPreLive)` | 1886–1895, 1908–1916 |
| Release | `state.release()` (RPC `release_session`) | `isAssignedEngineer && isPreLive` | 1896–1906 |
| ConfirmEndModal Cancel / End | `onCancel` / `onConfirm` (await `state.end()`) | both `disabled={busy}` | 2049–2075 |
| ChatComposer send | `state.sendBundle({text, files, senderName: isSupervisor ? "Moderator" : undefined})` | rendered only when not ended and not readOnly; `disabled={isReadOnly}`; readOnly = `!(isAssignedEngineer \|\| supervisorCanChat)` (601, 726) | 2369–2381 |
| Inline meeting card "Join" | `state.markJoined()` | `!ended && !readOnly` (active meeting) | 2239–2241 |
| Inline meeting card "End meeting" | `handleCancelMeeting` → `end-zoom-meeting` | `!ended && !readOnly` | 2243, 2150–2163 |
| Escalate to supervisor | open modal; `submit` → RPC `engineer_escalate_session` | rendered only `!isSupervisor` (Sidebar 1208); submit disabled `busy` | 1469–1599 |
| Project chat search | `search()` → `/api/supervisor/chat-search` | rendered `isSupervisor && project_id` (1204–1206); button disabled `busy \|\| q.trim().length < 2` | 1230–1286 |
| Search result row | `router.push(/staff/session/{id})` | always | 1300–1325 |
| Transcript download | build blob from `buildTranscript` + anchor click | ended sessions (ReviewPanel only mounts on ended) | 2571–2599 |
| EditableSummary save | RPC `update_guest_call_summary` | `canEdit = currentUserId === customer_user_id \|\| === claimed_by` (2637–2640) | 2641–2654, 2760–2766 |
| Companion summary edit/delete | RPCs `update_guest_message_body` / `delete_guest_message` | `canEdit` (same gate) | 2776–2800 |
| Sidebar collapse / expand | `setCollapsed` | always | 891–897, 1001–1008 |
| Sidebar drag-resize | `startSidebarDrag` pointer handlers, clamped 220–460 | not collapsed | 857–879, 975–988 |
| Past-session row | `router.push(/staff/session/{id})` | `!isCurrent` | 1127–1135 |
| Project-memory header / row | `setOpen` toggle; `onOpen(id)` → push | row `disabled={isCurrent}` | 2951–2971, 2992–2998 |
| Back link | `/supervise` (supervisor) or `/inbox` | always | 900–907, 993–1000 |
| CallSurface `onClose` / `onJoined` | `setCallOpen(false)` / `state.markJoined()` | while `callOpen` | 584–585 |
| ErrorToast dismiss | `state.clearError` | `state.error` shown unless it contains `NOT_ASSIGNED_TO_YOU` / `NOT_AUTHORIZED` | 645–649 |

---

## 8. Zoom call wiring (accept / join / end)

- **Default path = Video SDK** (`isVideoSdkEnabled()`, LaunchCallContext.tsx:59–67). `launchCall` is non-null only then (195–197). Chat-first: `CallSurface` is **not** auto-mounted; either side starts via the green Video button → `launchCall()` → `setCallOpen(true)` → `<CallSurface>` mounts (580–589) → `zoom-video-sdk-token` edge fn posts the "📞 Zoom meeting started" system message → other side's `MeetingChatEntry` flips to "Join call" (comment 186–193).
- `CallSurface` props: `role="host"`, `userName` = "Moderator" (supervisor) or engineer email, `onJoined` → `mark_joined(_role:"engineer")` so the customer's ring fires only on genuine join (580–588; comment 173–178).
- **Legacy Meeting-SDK path** (flag explicitly "false"): auto-start effect mints (303–351); manual `startVideo` (1680–1724) opens `about:blank` popup synchronously then points it at `zoom_start_url`, then `markJoined`. `handleStartMeeting` (1730–1748) mints/restarts only.
- **Supervisor observer**: read-only viewers get `zoom_observer_url ?? zoom_join_url` on the chat card (2170–2172); appointment supervisors host the in-window call directly (`isApptSupervisor`, 1635).
- **End**: per-meeting "End meeting" → `end-zoom-meeting` (2150–2163); whole-session end → `end_session` RPC + fire-and-forget `end-zoom-meeting` + `summarize-guest-call` (useEngineerSession.ts:261–282); ended status closes the surface (198–200). `CallSurface`'s own leave path invokes `zoom-video-sdk-end` (useZoomCall.ts:1051).
- Chat timeline pairs "Zoom meeting started"/"ended" system rows into one `MeetingChatEntry` card, attaching the AI Companion summary and (supervisor-only) recording line (2179–2212, 2218–2261).

## 9. Session-end + summary flow

1. Engineer confirms End → `state.end()` → `end_session` RPC; on success fire-and-forget `end-zoom-meeting` + `summarize-guest-call` (useEngineerSession.ts:261–282). Watchdog variant: `end("payment_buffer_expired")` (442–456).
2. Realtime `guest_calls` UPDATE flips status to `ended` → effect 376–401 broadcasts assistant-tab end and, after a 3-second beat (summary head start), redirects: supervisor → `/supervise`; engineer → `/staff/project/{project_id}` or `/inbox`.
3. While still on the page, `MainPane` renders the ended split: locked `ChatPane` (left) + `ReviewPanel` (right) (699–718); HUD shows "Session ended · returning to inbox" (1750–1770); composer is replaced by the "Session ended — read-only" pill (2344–2354).
4. `SummaryView` drives off `session.summary_state` (migration `20260518200000_summary_state.sql`, comment 2673–2676): `generating_*`/`waiting_for_transcript` → spinner with stage label (2677–2707); `no_conversation` (2708), `transcript_unavailable` (2720), `summary_failed` (2734), no overview (2748) → empty states; else `EditableSummary` + deduped Zoom Companion summary cards with edit/delete (2756–2804).
