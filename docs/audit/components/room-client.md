# Component map — `RoomClient.tsx`

**File:** `app/room/RoomClient.tsx` (14,519 lines, ~579 KB, `"use client"`)
**Entry:** `RoomClient()` — the customer engagement surface (claude.ai-style layout: left project sidebar, state-driven main pane, right chat-stub/summary rail). Mounted by `app/room/page.tsx` inside `<Suspense>` (required because `useSearchParams()` is read for `?newchat` / `?paywall` / legacy `?matching`).
**Header comment** (lines 3–23) documents the pane state machine: no session/cancelled/queued/assigned → ChatPane full width + ConnectingModal overlay while queued; live → ChatPane with inline `MeetingChatEntry` call cards (chat first, call second); ended → post-call review.

---

## 1. Components defined

| Component | Lines | Role |
| --- | --- | --- |
| `useFreeSessionLifecycle` (hook) | 203–296 | Free-cap/paid-balance watchdog: 1 s tick while status ∈ `ACTIVE_TIMER_STATES` (195–201); `computeSessionClock` decides pivot-to-paid (stamp `paid_extension_at`) or hard end (`end_session` RPC + fire-and-forget `summarize-guest-call` / `end-zoom-meeting`). Deliberately hoisted out of RoomClient so the per-second re-render stays local |
| `RoomClient` (exported) | 312–2533 | Top-level orchestrator: `useCustomerSession()`, drawers (<lg), call-surface panel split, center views, paywall, modals |
| `shouldShowIncomingCall` | 2536–2543 | engineer joined + zoom minted + customer not joined + status joining/live |
| `MainPane` (memo) | 2546–2826 | Center-pane priority switch: LegalPane → AccountPane → SessionPrepView → ProjectPickerPane → PastSessionReview → EndedSessionReview → BrandedLanding (inactive) → ChatPane (active) |
| `HeaderPill` / `HeaderHamburger` | 2842–2910 / 2916–2933 | Scheduled/Contracts pill with unseen-count badge + blink dot; <lg sidebar-drawer trigger |
| `CenterHeaderActions` | 2935–3102 | Top-right strip: Scheduled + Contracts pills (localStorage "seen" watermarks), `NotificationBell`, <lg chat-drawer icon |
| `SessionPrepView` | 3122–3653 | "Prepare a session" pane: textarea draft (localStorage via `lib/relay/sessionDrafts`), file/voice staging to IndexedDB, Save-for-later, Call engineer (mirrors draft to `customer_session_drafts` via `ensureDraftMirrored` then rings) |
| `BrandedLanding` | 3666–4212 | No-session landing: wordmark + tagline + collapsible "How Relay works" explainer + customer-level AI summary fetch + in-flow `ChatPanelStub` rail |
| `DraftAttachmentView` / `StubVoiceNote` | 4256–4316 / 4321–4400 | Draft-bubble renderers (IDB blob → object URL; WhatsApp-style voice player) |
| `DraftBubble` | 4483–4725 | Local draft bubble: kebab edit/delete menu, long-press, inline edit, edited badge, single tick |
| `ChatPanelStub` | 4727–6443 | Pre-session WhatsApp-style draft buffer (sessionStorage per scope) + IDB attachment staging + dictation (Web Speech keep-alive loop, voice connect-command regex 4408) + MediaRecorder voice notes + live voicegram + drag-resize + undo snackbar |
| `EndedSessionReview` / `PastSessionReview` | 6449–6482 / 6496–6566 | Post-call split: `SummaryPanel` (center) + read-only `ChatPanelStub` (right). Past variant fetches `guest_calls` + `guest_messages` itself |
| `ReadOnlyChatPane` | 6575–6694 | **DEAD CODE** — explicitly unused (`eslint-disable no-unused-vars`, comment 6569–6572), kept "in case we bring back an inline timeline" |
| `SummaryPanel` | 6699–6755 | Header + `SummaryView` wrapper for the review split |
| `ProjectPickerPane` | 6763–6979 | Center-pane project pick / create-new (legacy path; both confirm handlers now route to `/intake`) |
| `FloatingStatus` (memo) | 6984–7124 | Top header bar: session title, `LiveTimer`, `CompactStatus`, `CallHeaderActions`, red End-session button → `ConfirmEndModal` |
| `CallHeaderActions` | 7138–7228 | Green Video join button (enable logic §7), disabled Add-participant, inert More button |
| `LiveTimer` / `CompactStatus` / `ConfirmEndModal` / `pillConfig` | 7236–7295 / 7299–7332 / 7334–7379 / 7381–7453 | Timer text (free countdown / paid elapsed / appointment-free), ● status label, end confirm, status→pill mapping |
| `useResizableWidth` (hook) | 7511–7565 | Drag-resize with localStorage persistence (used by Sidebar + SessionSummaryTray) |
| `Sidebar` (memo) | 7567–9673 | 2,100-line left rail: connect orb, project accordions, search/group-by, pins/archive (localStorage), quote shortcuts, user pill + `UserMenu`, and OWNS `ConnectFlowModal` / `QuoteRequestModal` / `ScheduleEngineerModal` (portaled to body) |
| `ConnectFlowModal` + `WizardHeading` + `DetailsStep` + `FormPanel` / `FormSectionLabel` / `ChoiceChip` | 9841–10580 / 9775–9839 / 10862–11093 / 11100–11195 | 6-step connect wizard: choose → need (Q1) → existing → engineerPicker → details (Q2 stack) → name+urgency (Q3); `mode` = connect vs create-only |
| `mapProjectTypeToDeveloping` | 9716–9738 | Persona project types → the 4 values allowed by `client_intakes.developing` CHECK constraint |
| `bucketSessionsByDate` / `fmtSessionWhen` / `SessionRowFlat` | 10586–10711 | Flat session-view helpers (group-by date/none) |
| `EngineerPickerRow` | 10723–10844 | Engineer row: presence dot (live via `/api/match/presence` poll) + Connect / Request / Schedule actions |
| `formatEntitlement` / `WalletBalance` (memo) / `planLabel` / `EmployeeInfoBlock` (memo) | 11203–11384 | Wallet readout with its own 1 s burn-down tick; enterprise dept-pool block |
| `UserMenu` (memo) | 11387–11675 | Bottom-left dropdown: plan chip, Wallet + Recharge, Profile/Billing (in-pane), Privacy/Terms (in-pane LegalPane), Log out (`auth.signOut` → `/login`); guest (anonymous) users collapse to wallet-only |
| `humanState` / `fmtRelDate` | 11677–11715 | Status + relative-date labels |
| `ProjectAccordion` (memo) | 11718–12290 | One project group: header (select + expand), warm/cold phone button (green/black), kebab (pin/archive/rename/delete — portaled fixed menu), DRAFT rows (amber dashed), session rows |
| `ChatPane` (memo) | 12293–12568 | Live chat: message list with Zoom-card pairing (started/ended/summary/recording maps 12400–12433), supervisor-only filtering, `ChatComposer` footer; `handleSend` routes pre-session sends through `/intake` (12335–12388) |
| `isGenericSenderName` / `Message` (memo) | 12573–12659 | "Guest"/"Customer" never shown as label; system pill w/ attachments; guest/engineer bubbles |
| `ReviewPanel` / `PillTab` / `ChatHistoryView` | 12662–12735 / 12738–12764 / 13458–13473 | **DEAD CODE** — `ReviewPanel` is never mounted (the review path uses `SummaryPanel`); `ChatHistoryView` only referenced from inside `ReviewPanel` (12732) |
| `SummaryView` | 12766–13011 | `summary_state` machine renderer + 90 s client patience timeout (12842–12866) + `EditableSummary` + deduped Zoom Companion summaries with edit/delete RPCs + `SessionDownloads` |
| `SessionDownloads` / `DownloadButton` / `SessionAttachmentRow` | 13029–13456 | AI-summary + transcript .txt download (client-generated), files-exchanged list with signed URLs, 90-day retention copy, purge trash icon |
| `Resizer` | 13476–13507 | `PanelResizeHandle` grip for the call/chat split |
| `ProjectNameEditor` | 13510–13715 | Inline rename/switch project while ringing (inside ConnectingModal); writes `projects.name` + `guest_calls.project_name` / `project_id` |
| `ConnectingModal` | 13718–14068 | Ringing hero while queued: 90 s anchored timer (created_at/last_recall_at), `useRingtone`, minimize-to-pill (×/Esc/outside = minimize, NOT cancel), explicit Cancel-search, auto `onTimeout` once at 90 s |
| `AllEngineersBusyModal` | 14074–14158 | Terminal 90 s-timeout notice: Try again / Close |
| `FullScreenLoader` / `ErrorToast` / `SuccessToast` | 14161–14208 | Misc |
| `SessionSummaryTray` + `DetailRow` | 14230–14453 | Right rail for active sessions: intake summary + next steps + details; realtime channel `room-tray:*`; collapse persisted (`relay-room-summary-tray-open`), drag-resizable |
| `AsyncChatPane` | 14465–14518 | `?newchat=1` surface: `IntakeAssistant` bot chat, escalate-to-call button |

Brand constants 178–185; `ACTIVE_TIMER_STATES` 195–201; `EmployeeInfo` type 301–310; `PastSession`/`Project`/`ProjectGroup` types 7456–7506; wizard constants `NEW_PROJECT_TYPES`/`AI_TOOLS`/`BACKENDS`/`FRONTENDS` 9691–9770.

---

## 2. State inventory (grouped by concern)

### Identity / auth (RoomClient + hook)
- `state = useCustomerSession()` (314) — `auth` (loading/anonymous/authed{userId,email,isAnonymous}), `session`, `messages`, `entitlement`, `loading`, `error`, `customerName` (useCustomerSession.ts:106–722).
- `employment` (361) — `/api/customer/me-employment` probe; `isEmployee` (380) suppresses paywall + Contracts + quote shortcuts.
- `sidebarIsGuest` (1450) — `auth.isAnonymous` (Try-Relay funnel) → collapsed UserMenu.

### Session lifecycle
- `accepted` (541) — customer acknowledged the incoming call; latched by effect 927–939, reset 911–919; **now vestigial** (FloatingStatus `void accepted` 7027).
- `viewingPastId` (566) — past-session review target.
- `initialLoadDone` (1064) — gates the one-time `FullScreenLoader`.
- `homeNonce` (1842) — bumped by Home; MainPane's effect (2661–2664) uses it to dismiss `EndedSessionReview` (`reviewDismissedFor` 2653, keyed per session id).
- `now` inside `useFreeSessionLifecycle` (213) / `WalletBalance` (11266) / `ConnectingModal` (13762) — local 1 s clocks.

### Queue / ring
- `queueTimedOut` (599) — 90 s no-pickup → `AllEngineersBusyModal`; reset on session-id change (615–617).
- `sessionStateRef` (602) — fresh state for timer callbacks.
- `connectRequest` (1491) — `{projectId, nonce}` relayed from chat-rail green dot into Sidebar's connect flow.
- ConnectingModal: `minimized` (13743), `timedOutRef` (13779, one-shot onTimeout).

### Call / Zoom
- `callOpen` (329) — mounts `<CallSurface>` in the left panel; auto-closed on `ended` (352–354). `launchCall` (348–350) non-null only when `isVideoSdkEnabled()`.
- `tilesTarget` (346, callback-ref div) + `shareActive` (347) — participant tiles portal while screen share is active.
- `callStarted` (549–562, useMemo) — open "📞 Zoom meeting started" without matching "ended" in `state.messages` → gates the customer's Join button (string-protocol; see Notes).

### Chat (live)
- Lives in the hook: `messages` + realtime INSERT append. ChatPane has only `scrollRef` (12317) + derived meeting-pairing maps (12400–12433).

### Chat (pre-session drafts — ChatPanelStub)
- `messages: LocalDraftMessage[]` (4830) — sessionStorage bucket `relay-chat-stub-draft-v1:{scope}` (load 4960–4970, persist 4989–5000 guarded by `loadedScopeRef` 4834).
- `draftText` (4835), `undoableId` + `undoTimerRef` (4843/4847, 5 s undo), `openMenuId` (4845), `editingId`/`editText` (4851–4852).
- `stubAttachments` (4859, IDB-backed metas) + `pendingAttachments` (5020, staged minus bubbled), `dragDepth` (5437).
- Voice: `voiceMode`/`voiceMsg` (4836–4837), `recState`/`recSecs`/`recDiscardRef` (4867–4874), `waveLevels` + audio-context refs (4889–4935), `recognitionRef`/`transcribeBaseRef`/`transcribeKeepAliveRef`/`onStartCallRef` (4937–4952).
- `panelWidth`/`isDragging` (5614/5636, localStorage `relay:chat-panel-width`), `projMenuOpen` (4814).

### Paywall / billing
- `paywallOpen` (755) — `null | "free_expired" | "no_credits" | "manual"`; opened by: status `expired_free` / ended-for-`free_session_expired|paid_balance_exhausted` with 0 balance (851–873), hook error `NO_ENTITLEMENT` (876–881), `?paywall=` param (814–825), entitlement pre-checks in `handleStartInProject`/`handleNewChat`/`handleNewSession`/ChatPane send, `handleWalletClick` ("manual"). All gated `!isEmployee`.
- `paidToast` (758) — Stripe `?relay_paid=` handshake (886–908) + picker toasts.
- `callBlockMsg` (828) + `blockNewCall` (829–850) — "already on a call" guard for every new-ring entry point.

### Intake / projects
- `projects` (976) + `refetchProjects` (980–1056, two-tier SELECT with retention-column fallback).
- `selectedProjectId` (572) — landing CTA context; persisted to `relay:lastProjectId` (1406–1413), restored one-shot via `restoredLastProjectRef` (1419–1435).
- `projectFormOpen` (972), `newChatModalOpen` (974), `pendingDraft` (975).
- `preparingProjectId`/`preparingDraftId` (786–789) — prep pane; `draftsTick` (798) + `pastRefreshTick` (808) invalidation counters; `deleteProjectTarget` (792).
- Sidebar wizard state (8083–8099): `newProjectType/-Other/AiTools/Backend/Frontend/Name/Submitting`, `newProjectUrgency` (9932), `connectFlow` step (9919), `connectFlowMode` (9956), `pickerProjectId` (9943), `pickerPresence` (9964), `quoteFlow`/`quoteInitialProjectId` (7759/9937), `scheduleTarget` (9947).

### Bookings / center views
- `centerView` (334) — `"projects" | "scheduled" | "contracts" | null` full-pane views; `centerChatCollapsed` (338).
- CenterHeaderActions: `scheduledCount`/`contractCount`/`seenTick` (2956–2958) with localStorage seen-watermarks `relay:scheduled-seen:{uid}` / `relay:contracts-seen:{uid}`.
- `asyncChatMode` (593) — `?newchat=1` async surface; auto-closed when status goes active (945–950).

### UI chrome
- `openDrawer` (665) — `null | "sidebar" | "chat"` off-canvas (<lg); `useOverlayDismiss` refs (674–681); `swipeStartX` (683); `chatSheetVV` (689, VisualViewport keyboard tracking).
- Sidebar: `collapsed` (7717), `expandedProjectKey` (7723, exclusive accordion), `userMenuOpen` (7755), `openSection` (7767), `searchQuery`/`searchOpen` (7778/7813), `groupBy`/`groupMenuOpen` (7798/7801), `pinnedIds` / `pinnedProjectIds` / `archivedProjectIds` (+localStorage 7815–7905), `archivedOpen` (7905), `leftResize` (7727).
- `SessionSummaryTray`: `open` (14233, localStorage `relay-room-summary-tray-open`), `intake` (14232), `rightResize` (14240).

### One-shot ref guards
- `flushedForSessionRef` (428) — draft auto-flush once per session id (failure does NOT reset → see Notes).
- `restoredLastProjectRef` (1419), `sessionAutoCollapsedRef` (7745, sidebar auto-collapse once per session), `lastConnectNonceRef` (7973), `timedOutRef` (13779), `prevStatus`-style latches absent — ended detection is by render branch, not transition.

---

## 3. Effects inventory

### useFreeSessionLifecycle (203–296)
| Lines | Deps | Purpose |
| --- | --- | --- |
| 234–238 | `isActive` | 1 s `setInterval` tick while status ∈ assigned/joining/live/grace/expired_free and not an appointment |
| 259–295 | `sessionId, shouldPivot, shouldEnd, endReason, paidExtensionAt` | Pivot → `guest_calls.update({paid_extension_at})`; hard end → `end_session` RPC + fire-and-forget `summarize-guest-call` + `end-zoom-meeting` (idempotent, both customer+engineer tabs may fire) |

### RoomClient
| Lines | Deps | Purpose |
| --- | --- | --- |
| 320–325 | `refreshSession` | `relay:appointment-started` window event → `state.refresh()` |
| 352–354 | `session.status` | Close CallSurface on ended |
| 362–379 | `[]` | Fetch `/api/customer/me-employment` once |
| 391–405 | `session.status` | Desktop-shell bridge `window.relay.setSessionActive` |
| 429–536 | `session.id/status`, **whole `state`** | **Draft auto-flush**: on first live-ish status per session id, read sessionStorage buckets (project scope + "general"), insert ordered `guest_messages` rows under the customer's name, clear buckets, then `flushStubAttachments` per scope (IDB → uploaded bubbles), `state.refresh()`. One-shot via `flushedForSessionRef`; failures warn + never retry for that session |
| 579–584 | `router` | Legacy `?matching=<id>` → `router.replace(/intake/matching/{id})` |
| 603–605 | (every render) | `sessionStateRef.current = state` |
| 615–617 | `queuedSessionId` | Reset `queueTimedOut` on new session |
| 622–648 | `queuedSession, queueTimedOut, asyncChatMode` | Arm precise 90 s timeout anchored to `created_at`/`last_recall_at` while queued (skips appointments + async mode) → `handleQueueTimeout` (cancel + busy modal) |
| 669–671 | `isDesktop` | Dissolve drawers crossing up to ≥lg |
| 693–713 | `openDrawer` | VisualViewport tracking for the chat drawer (iOS keyboard) |
| 714–723 | `newChatParam` | `?newchat=1` → `asyncChatMode`, strip param |
| 733–745 | `[]` | One-shot cleanup of legacy `relay-connecting-shown:*` localStorage flags |
| 815–825 | `paywallParam` | `?paywall=` → open paywall, strip param |
| 851–873 | status / ended_reason / paid balance / isEmployee | Auto-open paywall on `expired_free` or balance-exhausted end |
| 876–881 | `state.error, isEmployee` | `NO_ENTITLEMENT` → paywall |
| 886–908 | `[]` (deps suppressed) | Stripe `?relay_paid=` handshake: toast + delayed `state.refresh()` + URL cleanup |
| 911–919 / 927–939 | session id/status / call fields | Reset / latch `accepted` (deliberately does NOT `markJoined` — customer must click Join) |
| 945–950 | `session.status` | Close async pane once the session goes active |
| 953–961 | `session.status` | **Empty-body effect** (comment only — dead) |
| 963–965 | `auth.kind` | anonymous → `router.replace("/login")` |
| 1057–1059 | `refetchProjects, session.id/status` | Reload project list on auth/session changes |
| 1065–1069 | loading/auth | Set `initialLoadDone` |
| 1406–1413 / 1420–1435 | `selectedProjectId` / `projects` | Persist / restore `relay:lastProjectId` |

### MainPane
| Lines | Deps | Purpose |
| --- | --- | --- |
| 2661–2664 | `homeNonce, session id/status` | Home click dismisses EndedSessionReview |
| 2673–2678 | `preparingProjectId, projects` | Auto-close prep view if its project vanished (post-render, avoids setState-during-render) |

### CenterHeaderActions (2984–3033)
`customerUserId, seenKeys, seenTick` → head-count queries on `engineer_bookings` + `supervisor_bookings` (status=booked, created_at > seen) and `project_quote_requests` (responded_at > seen); re-run on window events `relay:appointments-changed` / `relay:scheduled-changed` / `relay:quotes-changed`.

### SessionPrepView
3172–3180 hydrate IDB tray per project; 3315–3325 mic teardown on unmount; 3331–3346 400 ms autosave debounce (saved drafts only).

### BrandedLanding
3720–3731 first-visit explainer flag (`relay:explainer-seen`, write-on-open); 3744–3777 customer-level `customer_summaries` fetch when no project selected.

### ChatPanelStub
4817–4825 / 5162–5172 / 7802–7810-style outside-click closers (project menu, kebab, group menu — microtask-delayed listener); 4875–4882 recording seconds tick; 4960–4970 load per-scope drafts; 4975–4983 hydrate IDB tray; 4989–5000 persist drafts (scope-guarded); 5006–5013 near-bottom auto-scroll; 5175–5180 undo-timer cleanup; 5583–5603 unmount teardown (kill dictation keep-alive **before** abort, stop recorder/stream/rAF/AudioContext); 5615–5630 / 5671–5678 panel width localStorage.

### PastSessionReview (6510–6531)
`sessionId` → parallel fetch `guest_calls` row + `guest_messages` (no realtime — static snapshot).

### Sidebar
| Lines | Deps | Purpose |
| --- | --- | --- |
| 7746–7753 | `session` | Auto-collapse once per session when status hits assigned/joining/live |
| 7824–7833 / 7856–7865 / 7887–7896 | pin/archive sets | Persist to localStorage |
| 7974–7998 | `connectRequest` | External green-dot connect request → engineerPicker (warm) / direct ring (cold) / chooser (no project); nonce-deduped |
| 8048–8080 | `connectFlow, pickerEngineers` | **Poll** `/api/match/presence` (POST, engineer ids) immediately + every 12 s while picker open |
| 8101–8265 | `customerUserId, session.id/status, pastRefreshTick` | Load up to 80 `guest_calls` (FULL→SLIM column fallback) + `client_intakes.intake_summary` + first guest message per session → build `past` rows with derived topic names |

### Others
- `SummaryView` 12844–12862: 90 s patience timeout flips `waiting_for_transcript` → `transcript_unavailable` (presentation only).
- `SessionDownloads` 13051–13070: fetch project `completion_status` for retention copy.
- `ProjectNameEditor` 13530–13543: sync draft on realtime project_name patch; outside-click close.
- `ConnectingModal` 13743–13750 Esc→minimize; 13762–13766 1 s tick; 13780–13786 one-shot `onTimeout` at 90 s; 13813 `useRingtone(!minimized && !expired)`.
- `ConnectFlowModal` 9969–9975 Esc→close.
- `WalletBalance` 11267–11271: 1 s tick only while paid minutes are burning.
- `SessionSummaryTray` 14248–14252 persist open flag; 14254–14282 intake fetch + realtime (below).
- `DraftBubble` 4512–4521 focus textarea on edit; `DraftAttachmentView` 4258–4271 IDB blob → objectURL with revoke.

---

## 4. Supabase realtime channels

| Channel | Where | Events | Handler |
| --- | --- | --- | --- |
| `relay-session:${sessionId}` | `lib/relay/useCustomerSession.ts:397–445` (via hook at RoomClient.tsx:314) | `UPDATE public.guest_calls` (`id=eq.{id}`) → spread-merge into `session`; `INSERT public.guest_messages` (`guest_call_id=eq.{id}`) → dedup-append + async hydrate `guest_message_attachments` | Single channel per active session; torn down/re-created on `session?.id` change |
| `room-tray:${session.id}` | RoomClient.tsx:14268–14277 (SessionSummaryTray) | `UPDATE public.client_intakes` — **no filter**: fires on ANY intake update visible under RLS, then re-fetches this session's intake row | Refresh intake summary/next-steps |

No other `.channel(` in this file. (Engineer-side ring/presence channels live in StaffShell / lib/relay hooks, not here.)

---

## 5. External calls

### Supabase RPCs (browser client)
| RPC | Line(s) | Trigger |
| --- | --- | --- |
| `end_session` | 283 (free-cap watchdog); useCustomerSession.ts:490 (`state.end`) | Free/paid expiry; customer End button |
| `get_or_create_active_customer_session` | 1310 (`handleStartInProject`), 1572 (`handleNewChat`); hook 268 (`startNewSession`) | Session mint |
| `cancel_customer_session` | 1151, 1307, 1568 (lingering-session cleanup before new ring); hook 217 (stale-queued >90 s on mount), 480 (`state.cancel`) | Cancel/cleanup |
| `create_project` | 1098 (`startSessionInProject`), 1535 (`handleNewChat` "Chat" project), 1938 (`handleCreateProjectWithMetadata`) | Project creation |
| `match_engineer` | 1370, 1647 | Fire the ring after intake is pointed at the session |
| `mark_project_complete` | 1755 | Project kebab → starts 90-day retention clock (window.confirm gate) |
| `update_guest_call_summary` | 12805 | EditableSummary save (canEdit = customer or claimed engineer, 12793–12796) |
| `update_guest_message_body` / `delete_guest_message` | 12974 / 12985 | Zoom Companion summary edit/delete |
| `purge_guest_message_attachment` | 13373 | Files-exchanged trash icon |
| Via hook: `recall_engineer` (458 — **exposed but never called from RoomClient**), `mark_joined` (`_role:"customer"`, 513) | useCustomerSession.ts | recall is legacy; markJoined from Join button / CallSurface onJoined |

### Edge function invokes
| Function | Line(s) | Trigger |
| --- | --- | --- |
| `summarize-guest-call` | 287; hook 503 | Fire-and-forget on every end path |
| `end-zoom-meeting` | 290; hook 500 | Fire-and-forget on every end path (idempotent noop if no meeting) |
| `zoom-video-sdk-token` / `transcribe-chunk` / `zoom-video-sdk-end` | lib/video/useZoomCall.ts (via mounted `CallSurface`, 2160–2169) | Video SDK join / live transcription / end signal |

### Next.js API routes
| Route | Line(s) | Trigger |
| --- | --- | --- |
| `GET /api/customer/me-employment` | 366 | Mount probe (employee gating) |
| `POST /api/match/directed` | 1353 | Directed ring at a preferred engineer (falls back to `match_engineer` when `offered:0`) |
| `POST /api/match/presence` | 8060 | Engineer-picker presence poll (12 s) — server-side because RLS blocks customers reading presence |
| `/api/customer/notifications` | via `NotificationBell` child (3073) | Bell feed |

### Direct table reads/writes (this file)
- `guest_messages` insert (488 draft flush) + selects (8164 first-message topics; 6517 past review). Hook: insert (556, 592, 634) + select (225, 291).
- `guest_calls`: select active (1128, 1288, 1549), select past 80 (8115/8124), select one (6516), update `paid_extension_at` (269), update `project_name` (1859, 13574), update `project_id`+name (13588).
- `projects`: select (1000/1014 two-tier), update name (1855, 13569), delete (2446 — FK `ON DELETE SET NULL` orphans sessions to General).
- `client_intakes`: select (1237, 8148, 14258), upsert (1260 backfill, 1634, 2001), update `guest_call_id` + clear `declined_by` (1339).
- `customer_summaries` select (3750); `engineer_bookings`/`supervisor_bookings`/`project_quote_requests` head counts (2991–3016); `projects.completion_status` (13059).
- Hook: `customer_entitlements`, `credit_wallets`, `customer_profiles.display_name` (useCustomerSession.ts:320–389).

### Browser storage
- **localStorage**: `relay:lastProjectId`, `relay:explainer-seen`, `relay:chat-panel-width`, `relay:room-left-sidebar-width`, `relay:room-right-tray-width`, `relay-room-summary-tray-open`, `relay_pinned_session_ids`, `relay_pinned_project_ids`, `relay_archived_project_ids`, `relay:scheduled-seen:{uid}`, `relay:contracts-seen:{uid}`, legacy `relay-connecting-shown:*` (purged 733–745). Plus `lib/relay/profile` + `projectMetadata` + `sessionDrafts` stores.
- **sessionStorage**: `relay-chat-stub-draft-v1:{scope}` (draft chat), `relay:intake:draft` (12362, composer text carried into /intake).
- **IndexedDB**: `lib/relay/stubDraftAttachments` staging queue (files + voice notes pre-session).
- **Window events** consumed: `relay:appointment-started`, `relay:appointments-changed`, `relay:scheduled-changed`, `relay:quotes-changed`.

---

## 6. Hooks consumed

| Hook | Call site | Source |
| --- | --- | --- |
| `useCustomerSession()` | 314 | `lib/relay/useCustomerSession.ts` — auth, session row + messages + realtime, entitlement, actions (`recall/cancel/end/markJoined/sendMessage/refresh/startNewSession/sendOrStart/sendBundle`) |
| `useFreeSessionLifecycle` | 385 (defined in-file 203) | free-cap + paid-exhaustion watchdog |
| `LaunchCallProvider` / `useLaunchCall` / `useLaunchCallShape` / `isVideoSdkEnabled` | 2143 / 7149 / 7150 / 348 | `lib/video/LaunchCallContext.tsx` — Video SDK default; only `NEXT_PUBLIC_USE_VIDEO_SDK="false"` disables |
| `useIsSupervisor` / `isSupervisorOnlyMessage` | 6582, 12316 / 6639, 12469 | supervisor-only message filtering when staff views the customer room |
| `useSessionTimer` | 7250 (LiveTimer) | `lib/relay/useSessionTimer.ts` |
| `computeSessionClock` | 246 | `lib/relay/sessionClock` — single source of free/paid enforcement |
| `useRingtone` | 13813 (ConnectingModal) | `lib/relay/useRingtone.ts` — shared synthesis with `/intake/matching` |
| `useIsDesktop` / `useOverlayDismiss` | 664 / 674, 678 | drawer plumbing |
| `useResizableWidth` | 7727 (Sidebar), 14240 (tray) | defined in-file 7511 |
| `useSearchParams` / `useRouter` | 591 / 313 + several | `?newchat`, `?paywall`, navigation |
| Indirect children | `CallSurface` → `useZoomCall`; `ChatComposer` (speech helpers); `IntakeAssistant`; `PaywallModal`; `AppointmentPopup`; `NotificationBell`; `QuoteRequestModal`; `ScheduleEngineerModal`; `DeleteProjectModal`; `GlobalNewChatModal`; `EditableSummary`; `Projects/Scheduled/ContractsCenterView` | app/_components/* |

---

## 7. Event handlers / user actions (major)

| Action | Handler | Effect | Lines |
| --- | --- | --- | --- |
| Ring engineer in a project (phone button / landing CTA / prep "Call engineer" / picker Connect) | `handleStartInProject(projectId, preferredEngineerId?)` | `blockNewCall()` guard → entitlement pre-check (paywall) → no project → `/intake`; else look up/backfill `client_intakes` (localStorage metadata backfill 1251–1279) → cancel lingering active session in another project → `get_or_create_active_customer_session` → point intake at session + clear `declined_by` → directed `/api/match/directed` or `match_engineer` → `router.replace(/intake/matching/{intakeId})` | 1201–1377 |
| "New session" (intake wizard path) | `handleNewSession` | guard + paywall check → `/intake` | 1466–1485 |
| "New chat" (async) | `handleNewChat` | paywall check → reuse/create "Chat" project → cancel lingering → mint session → upsert intake from profile/project metadata → `match_engineer` → `/room?newchat=1` (AsyncChatPane, no ConnectingModal) | 1513–1659 |
| Green connect orb / chat-rail green dot | orb onClick (8631–8644) / `handleConnectEngineer` (1495–1501) → Sidebar effect 7974 | Opens ConnectFlowModal (chooser, or Q1 for first-timers); warm projects → engineerPicker, cold → direct ring |
| ConnectFlow submit (Q3) | `onSubmitNewProject` (9568–9636) | create project + metadata + intake; route by urgency: now→picker/ring, this_week→picker+Schedule toast, planning→quote modal |
| Engineer picker row | `onEngineerConnect` (directed ring) / `onEngineerRequest` (toast + standard match — `customer_request_engineer` RPC **not yet shipped**, 9506–9531) / `onEngineerSchedule` (→ `ScheduleEngineerModal`) | 9494–9554 |
| Header green Video button | `CallHeaderActions` onClick: `markJoined()` (unless already on call) + `launchCall()` (Video SDK) or `window.open(zoom_join_url)` legacy | **enabled when** `engineerOnCall && (isLiveish ∥ apptReady)`; `engineerOnCall = callStarted ∥ engineer_joined_at ∥ status∈joining/live/grace` (belt-and-braces vs dropped realtime); stays enabled while on call | 7138–7228 |
| Inline meeting card Join | `state.markJoined()` + card joinUrl | only while `cardActive` (= no paired "ended" msg AND session not terminal — forced inactive on terminal status 12494–12498) | 12499–12515 |
| End session | FloatingStatus End → `ConfirmEndModal` → `state.end()` (RPC + 2 edge fns) | visible status ∈ assigned…expired_free | 7101–7121 |
| ChatComposer send (live) | `ChatPane.handleSend` → `state.sendBundle({text, files})`; **pre-session**: stash text in `relay:intake:draft` + stage files to IDB "general" → `router.push("/intake")` | composer `disabled={isReadOnly}` (status ended) | 12335–12388, 12555–12563 |
| Stub composer send (draft) | `handleSendDraft` — local bubble + 5 s undo; Enter sends | disabled when empty | 5028–5073, 6418–6433 |
| Stub dictation / record / attach / paste / drop | `startTranscribe` (keep-alive loop + voice connect-command), `startStubRecording`, `stageStubFiles` | 5187–5574 |
| ConnectingModal | ×/Esc/outside → minimize pill; "Cancel search" → `state.cancel()`; 90 s → `onTimeout` (auto-cancel + busy modal) | 13718–14068 |
| AllEngineersBusy | Try again → `startNewSession(samePid)`; Close | 650–657, 14074–14158 |
| Paywall | `PaywallModal` open per §2; Recharge (UserMenu) → `setPaywallOpen("manual")` | 2424–2428 |
| Project rename / delete / complete / pin / archive | `handleRenameProject` (1850–1865, mirrors to `guest_calls.project_name`); DeleteProjectModal onConfirm → `projects.delete` + local cleanup (2439–2455, 1771–1808); `handleMarkProjectComplete` (1741–1767); local pin/archive toggles | ProjectAccordion kebab 12049–12137 |
| Prep view | Save for later (localStorage row), Call engineer (`ensureDraftMirrored` → server `customer_session_drafts`, delete local row, ring), Delete draft | 3351–3412 |
| Past session row / current-session pill / Home | `handleViewPast(id)` / `onViewPast(null)` / `handleGoHome` (clears every side-track + bumps `homeNonce`) | 1452–1464, 1819–1842 |
| Account / Billing / Legal / Wallet | `handleOpenProfile`/`handleOpenBilling` (AccountPane in-pane), `handleOpenLegal` (LegalPane), `handleWalletClick` (paywall) | 1667–1700 |
| Scheduled / Contracts pills + bell | markSeen watermark + `setCenterView(...)`; bell `onOpenView` routes to the same | 3044–3078 |
| Log out | UserMenu → `auth.signOut()` → `/login` (hidden for anonymous guests) | 11431–11435 |
| Summary edit / Companion edit/delete / file purge / downloads | RPCs per §5; transcript + summary .txt generated client-side | 12797–12814, 12966–12991, 13362–13384, 13120–13195 |

---

## 8. Notes — dead code, guards, fragile patterns

1. **Dead code**: `ReadOnlyChatPane` (6575–6694, explicitly eslint-disabled), `ReviewPanel` + `PillTab` + `ChatHistoryView` (12662–12764, 13458–13473 — `ReviewPanel` is never mounted; the live review path is `SummaryPanel`+`SummaryView`). Hook action `recall()` (useCustomerSession.ts:455–475) has no caller in RoomClient — the recall UX was replaced by the 90 s timeout + Try again. Empty effect 953–961 (comment only). `accepted` is computed/latched but voided by its only consumer (7027). Session-pin props in `SessionRowFlat`/`ProjectAccordion` are `void`-ed (10654–10655, 12227–12228).
2. **CHAT-LOSS-1 (cross-ref, known issue — see INDEX.md §Phase 5)**: the pre-session draft pipeline is the loss surface. Drafts live only in `sessionStorage` (per-tab, lost on sign-out/device hop) + IDB; the auto-flush (429–536) is one-shot per session id via `flushedForSessionRef` and deliberately does NOT reset on failure ("don't loop on a failing flush"), so a failed insert strands the drafts for that session permanently. Additionally the live-message realtime sub is INSERT-only with no catch-up re-fetch on channel reconnect (useCustomerSession.ts:413–445) — messages inserted during a websocket gap are absent until a manual `refresh()`.
3. **CHAT-LOCK-1 (cross-ref, known issue)**: every "read-only / locked" chat state is purely client-side presentation — `ChatComposer disabled={isReadOnly}` (12556), the stub's "Session ended — read-only" pill (6078–6097), and `sendMessage`'s local `TERMINAL_STATES` check (hook 551). Nothing here proves the server rejects `guest_messages` inserts on ended sessions; the lock is UI-deep only.
4. **String-protocol call state**: `callStarted` (549–562), the meeting-card pairing (12400–12433), and `ReadOnlyChatPane`'s copy all parse system-message bodies for the literals `"Zoom meeting started"` / `"Zoom meeting ended"` / `"Recording available"`. Any copy change in the edge functions silently breaks join gating. `CallHeaderActions` adds a fallback on session columns (7163–7166) precisely because a dropped realtime event used to dead-button the customer.
5. **Client-side billing enforcement**: `useFreeSessionLifecycle` ends the session and stamps `paid_extension_at` from the customer's browser. Comments say `end_session` is idempotent and the engineer side has its own watchdog, but a customer who closes the tab mid-paid-session relies entirely on server-side sweepers.
6. **Zoom singleton interplay**: `CallSurface` mounts at most once (gated by `callOpen`, panel 2153–2171) inside `LaunchCallProvider`; tiles portal via callback-ref `setTilesTarget` only during screen share. This is the pattern that pairs with `reactStrictMode: false` — a StrictMode double-mount would double-init the Video SDK singleton. PanelGroup `autoSaveId="relay-room-call-v4"` with stable default/min sizes is load-bearing (comment 2175–2183): prop churn resets user-dragged widths.
7. **Whole-`state` dep**: the flush effect (536) and several `useCallback`s depend on the entire `useCustomerSession()` object; the hook memoizes its return but it busts on every message/entitlement change, so memoized children (`Sidebar`, `MainPane`, `ChatPane`) re-render on each realtime tick anyway — `memo` only saves the no-change case.
8. **Realtime UPDATE merge** spreads `payload.new` over the previous row (hook 407–411). If the table lacks `REPLICA IDENTITY FULL`, TOASTed/unchanged columns can arrive absent and get clobbered — worth verifying in Phase 3 against the Supabase config.
9. **`room-tray` channel has no server-side filter** (14270–14276): every `client_intakes` UPDATE visible under RLS re-fetches; harmless at current scale, noisy by design.
10. **Race-prone metadata bind**: `handleStartNewProject` writes per-project metadata via `setTimeout(…, 600)` + lookup-by-name after the refetch (1904–1919) — a slow refetch or duplicate names mis-binds.
11. **Duplicated 90 s queue timeout**: armed in RoomClient (622–648) AND inside ConnectingModal (13780–13786), both anchored the same way; double-fire is absorbed by `queueTimedOut` + `timedOutRef` but it's two clocks for one rule (mirroring the server's `abandon_stale_queued_sessions`).
12. **"Busy → Request" engineer flow is a stub**: `onEngineerRequest` (9506–9531) shows an optimistic toast then runs the standard match; `customer_request_engineer` RPC + `engineer_connect_requests` producer don't exist yet (also noted in routes/dashboard.md — engineer-side pending-requests queue is always empty).
13. **`handleNeedProject` creates a project literally named `"project"`** (2019–2026) for composer-send-before-session; mostly bypassed now since `ChatPane.handleSend` routes pre-session sends through `/intake`.
14. **Stale-queued ghost cleanup races**: hook mount cancels queued sessions older than 90 s (useCustomerSession.ts:213–221) — a customer who waited >90 s and reloads has their still-ringing session silently cancelled even if an engineer was about to accept.
15. Three near-identical "cancel lingering active session" blocks (1126–1156, 1288–1308, 1549–1569) — copy-paste triplication of the same guard.
