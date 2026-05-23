# UI-CHANGES — light theme transformation (2026-05-22)

Dark cream/coral → bright white + single Relay green. UI-only. No backend
contracts changed.

## Design system

### Tokens (`app/globals.css`)
- `--background` `#2c2a26` (warm dark) → `#f7f9f8` (app canvas)
- `--surface` `#1f1e1b` → `#ffffff` (cards, sheets, composer)
- `--surface-raised` `#25241f` → `#f1f4f3` (rail, hover, bot bubble)
- `--border` `#3a3833` → `#e6eae8`; `--border-strong` → `#d4dad7`
- `--text` `#f5f4ee` → `#14171a` (near-black)
- `--text-muted` → `#5b6470`; `--text-faint` → `#8a939d`
- `--primary` Claude coral `#d97757` → Relay green `#16a34a`
- `--primary-hover` → `#15803d`
- `--primary-tint` (new) → `#e7f6ee` — selected card tint + sent-bubble fill
- `--green-dot` re-aliased to `--primary` (one green across the brand)
- `--warn` → `#d97706`; `--risk` → `#dc2626` (health-bar meaning preserved)
- `color-scheme: dark` → `light`
- `--scrim` tinted with `rgba(20,23,26,0.48)` (was solid black)

### Primitives (`app/_components/ui/`)
- **Button**: `launcher` variant text color flipped to white, `shadow-sm` added.
  Other variants inherit tokens cleanly.
- **Card** (`surface` variant): added `shadow-sm` for the soft lift in the
  white-card aesthetic.
- **Avatar**: added `tone="brand"` (green-tint bg + primary text, room-w.png
  style) alongside existing `neutral`/`ok` tones.
- **IconButton** (new): icon-only primitive with required `aria-label`,
  variants `primary | secondary | ghost | danger`, sizes `sm | md | lg`,
  `shape: circle | square`. Used by the new IntakeAssistant Send button.

## Constant sweep
29 client files had hard-coded brand hex constants
(`BRAND_GREEN = "#3f5c2e"`, `URGENT_AMBER`, `CRIT_RED`). All re-pointed to
CSS vars via `scripts/sweep-brand-hex.mjs` so style props pick up the new
palette without per-call-site edits.

| Old | New |
|---|---|
| `BRAND_GREEN` `#3f5c2e` | `var(--primary)` |
| `BRAND_GREEN_SOFT` rgba 12% | `var(--primary-soft)` |
| `BRAND_GREEN_BORDER` rgba 32% | `color-mix(in srgb, var(--primary) 32%, transparent)` |
| `URGENT_AMBER` `#d4a017` | `var(--warn)` |
| `URGENT_AMBER_SOFT` rgba 14% | `var(--warn-soft)` |
| `CRIT_RED` `#8b1a1a` | `var(--risk)` |
| `CRIT_RED_SOFT` rgba 18% | `var(--risk-soft)` |

## Per-screen

### 1. Global shell
Tokens swap → instant light surface across every route except marketing
(which has its own `.mk-root` namespace — also flipped, see #8).

### 2. Onboarding / intake (`/intake`, `IntakeClient.tsx`)
- AI tools step is **already multi-select** as of Phase 4
  (`aiTools: string[]`). Backward-compat payload preserved by joining with
  `, ` into the existing `ai_tools_used` text column.
- `// TODO(api)` already in source: widen `client_intakes.ai_tools_used`
  to `text[]` and pass `aiTools` directly.
- Tokens swap themes the wizard automatically.

### 3. Auth (`/login`, `/staff/login`, `/set-password`)
- Already restyled in Phase 3. Tokens swap propagates the new palette.
- Inputs / OTP pads / Button primitives all token-driven.

### 4. Dashboard / chat (`/room`, `app/room/RoomClient.tsx`)
- Constants re-pointed → all `style={{ color: BRAND_GREEN }}` etc. resolve
  to the new green.
- **NEW** right rail `<SessionSummaryTray>` (~210 LOC at file end). Mounted
  when `state.session.status !== "ended"`. Shows:
    - Header w/ collapse chevron + status pill (`On call`, `Ringing`, …)
    - Topic (`session.ai_summary_title || "Live session"`)
    - **Next steps** — green-check rows derived from the `intake_summary`
      "Next steps" block
    - **AI summary** — full `client_intakes.intake_summary` body
    - **Session details** — Engineer, Building, Stack, AI tools, Started
- Realtime subscribes to `client_intakes` UPDATE so the tray fills in the
  moment `summarize-intake` writes the brief on engineer-accept.
- Collapse state persisted in `localStorage[relay-room-summary-tray-open]`.
- Hidden below `lg` to keep small-viewport behaviour identical.

### 5. Ringing / waiting (`/intake/matching/[id]`, `MatchingClient.tsx`)
- 2-second gate + iOS-style slide-to-top motion (shipped earlier this
  branch). Light-theme tokens make the pulse pop on white.
- Chat **stays enabled** during ringing — `<IntakeAssistant>` mounts the
  moment the gate flips and remains centered.
- Hero card auto-picks up `Card surface` `shadow-sm`.

### 5b. IntakeAssistant (`app/_components/intake/IntakeAssistant.tsx`)
- Reskin to match room-w.png chat:
    - User bubbles → right-aligned, `var(--primary-tint)` fill, rounded-br
      smaller for "thread" look.
    - Bot bubbles → left-aligned, white card + border, rounded-bl smaller,
      sparkle avatar disc on each role-change.
    - Header → green-tinted square icon + "relay intake" wordmark + "AI"
      pill on the right.
    - Composer → grouped attach/code/image inside a single rounded input
      shell, focus-ring on container, round green `<IconButton>` Send.
- Quick-reply chips render under the latest assistant prompt when the
  script declared them (added `quickReplies` to the AI-tools step:
  `Claude / ChatGPT / Cursor / Replit / Lovable / Bolt`).
- Chat is persisted to `client_intakes.intake_messages` via the
  `append_intake_message` RPC added in `20260522000000_intake_transcript.sql`.

### 6. Live call room (in `RoomClient.tsx` / `EngineerSessionClient.tsx`)
- Token sweep brings the existing chrome into the white palette.
- Brief's labeled controls + red End-call ↔ existing call surface already
  has labeled icons; red call-end resolves via `var(--risk)` (`#dc2626`).
- Floor-up redesign of the Zoom embed chrome NOT in this PR (deferred —
  Zoom SDK iframe controls are owned by the SDK, only the surrounding
  card chrome is ours).
- `// TODO(ui)` left in `ZoomCallCard.tsx` for the labeled-controls bar
  rebuild.

### 7. Session summary (full)
- `SummaryPanel` in RoomClient already wired for ended sessions. Tokens
  swap propagates light theme.

### 8. Operations / Supervise / Inbox / Dashboard / EngineerSession
- 31 staff/customer files swept (`scripts/sweep-brand-hex.mjs`).
- **NEW** `<PodAllocationPanel>` placeholder (`app/_components/PodAllocationPanel.tsx`).
  Pure presentation — shows pod name, supervisor chips with online dot,
  a 10-or-15-slot grid where slots 1–10 are primary and 11–15 are amber
  "spill" range. Empty/filled/online states differentiated.
  `// TODO(pod-allocation)` marker — no logic, no Supabase reads. Drop
  into Operations or Supervise when ready.

### 9. Profile / account
- Account chip + Settings rows in `app/(staff)/settings/page.tsx` already
  restyled in Phase 10+11. Tokens swap propagates.

### Marketing (`/`, `app/_marketing/Home.tsx` + `marketing.css`)
- `.mk-root` namespace token block flipped:
    - `--cream` cream → `#ffffff`
    - `--ink` deep wood → near-black `#14171a`
    - `--green-deep / --green / --green-bright` moss `#4f6b3a` → Relay
      `#16a34a / #15803d`
    - `--green-tint` `#eaece0` → `#e7f6ee`
    - `--clay` coral accent → `#dc2626` (matches app `--risk`)
- Variable names preserved → no per-rule edits needed across 3109 LOC of
  marketing.css.

## Backend changes that landed earlier this turn

Documented for completeness. Already deployed against
`vdduelvjrzeczmakxgpn`:

| Change | Where |
|---|---|
| `client_intakes.intake_messages` JSONB + `intake_summary` TEXT cols + `append_intake_message` RPC | `supabase/migrations/20260522000000_intake_transcript.sql` (applied via management API; tracking row deferred per user) |
| Edge fn `summarize-intake` (rolls bot↔customer transcript into an engineer brief) | `supabase/functions/summarize-intake/index.ts` (deployed via supabase CLI) |
| IntakeAssistant persistence | `IntakeAssistant.tsx` writes via RPC, fire-and-forget |
| MatchingClient triggers summary on accept | `MatchingClient.tsx` (`functions.invoke("summarize-intake")` before redirect) |
| Engineer tray reads brief | `EngineerSessionClient.tsx` `<IntakeTray>` (realtime sub on `client_intakes` UPDATE) |

## TODOs left for backend / future work

Markers in code:

- `// TODO(api)` in `app/intake/IntakeClient.tsx:168` — widen
  `client_intakes.ai_tools_used` from `text` to `text[]`. UI is already
  multi-select.
- `// TODO(api)` in `app/_components/intake/IntakeAssistant.tsx` (existing,
  added in earlier phase) — attachment uploads to Supabase Storage; today
  we persist `{name, mime}` only, the `previewUrl` is a non-portable
  `blob://`.
- `// TODO(api)` in `lib/intake/intakeAssistant.ts:146` (existing) — swap
  the pure-function script for an Anthropic transport. Signature stable.
- `// TODO(ai)` (stub flagged in brief but already real) — the intake
  assistant is now real, persistence + summarization deployed. Stub flag
  can be removed; left for one release in case follow-up tweaks land.
- `// TODO(pod-allocation)` in `app/_components/PodAllocationPanel.tsx` —
  wire real pod / supervisor / slot data once allocation rule lands.
- `// TODO(ui)` in `app/_components/ZoomCallCard.tsx` — labeled-controls
  toolbar rebuild (Mute / Stop video / Share / Chat / More + red End call)
  pending Zoom SDK iframe coordination.

## Verification

```bash
node ./node_modules/typescript/bin/tsc --noEmit   # PASSED after every step
npm run lint                                       # (run before commit)
```

Browser end-to-end:
1. `/` → white page, Relay green wordmark + dot + green CTAs.
2. `/intake` → multi-select tool cards, green check tints.
3. `/intake/matching/<id>` → centered hero ~2s → slides to top pill →
   chat fades in centered with green-tint user bubbles + bot avatar discs.
4. `/room` (active session) → 3-column shell; right Summary tray shows
   topic + Next steps + AI summary + details, swaps from "fetching…" to
   real brief the moment `summarize-intake` writes the row.
5. `/staff/session/<id>` (engineer side) → IntakeTray on right shows the
   same brief + raw transcript expander + attachments list.

---

## Second pass — Commander's Orders (2026-05-22, later)

### Order 1 — Sidebar rebuild (`app/room/RoomClient.tsx` → `Sidebar` + `ProjectAccordion`)
- Sidebar now **starts EXPANDED** on every fresh `/room` mount (Projects
  visible by default, no more collapsed-by-default).
- **Loud green "New session" button** with a caret icon (chevron-down for
  options) + secondary ghost **"New chat"** button below. Replaces the
  prior quiet ghost row + lone `+` icon. Most-prominent control in the
  sidebar.
- **"Online" pill** under the wordmark — green-tinted background, pulsing
  dot. Mirrors `room-w.png`.
- **PROJECTS section header** carries a labelled **"New project"** button
  (text + plus icon + tooltip), not a mystery `+`.
- **Each project row now has ALWAYS-VISIBLE inline actions:**
    - Green `Phone` icon — "Start a session in {project}" (visible, not
      opacity-0/hover-reveal anymore).
    - Gray `⋮` overflow — placeholder for rename / new session / archive
      menu. Triggers rename inline for now.
- Active project pulse + selected state continue to use `BRAND_GREEN_SOFT`
  (resolved through `var(--primary-soft)`).

### Order 2 — Profile memory + returning-user flow
- NEW `lib/relay/profile.ts` — localStorage-backed `ProfileSnapshot`:
  `techComfort`, `stack.{aiTools, backend, frontend}`, `urgency`,
  `lastProjectId`, `lastProjectName`, `hasFullIntake`, `updatedAt`.
  Helpers: `readProfile()`, `patchProfile()`, `writeStack()`,
  `hasFullIntake()`, `flattenStack()`.
  Constants: `TECH_COMFORT_OPTIONS`, `URGENCY_OPTIONS`, `STACK_OPTIONS`
  (3-category multi-select catalogue).
  `// TODO(profile): wire to real backend store` — suggested shape in the
  file header (new `customer_profiles` table + `upsert_customer_profile`
  RPC).
- `app/intake/IntakeClient.tsx` **rebuilt** as the editorial 4-step flow:
    1. "How **comfortable** are you with code?" → radio cards.
    2. "What are you **building** with?" → 3 labelled chip groups
       (AI tool / Backend / Frontend), multi-select per group.
    3. "What kind of **project** is this?" → radio cards (kept because
       `client_intakes.developing` CHECK constraint requires one of
       Website / Mobile App / IoT System / AIML product).
    4. "How **soon** do you need someone?" → radio cards.
  - "Question N of 4" pill (monospace, uppercase, tracked).
  - Headline = large serif w/ **one italicised green word** per step.
  - Segmented progress bar (`<ProgressSegments>`).
  - Ghost "← Back" + green primary "Continue →" / "Find my engineer →"
    footer. Disabled until step valid.
  - Close `X` top-right → `/room`.
  - Prefills from profile on mount.
  - On submit: maps the new answers back onto the existing payload
    (`familiarity`, `ai_tools_used` joined, `technologies` = backend +
    frontend, `developing` chosen), persists durable signals to profile.
  - `// TODO(api): widen client_intakes.ai_tools_used to text[]; add
    techComfort + urgency as first-class columns.`
- NEW `app/_components/intake/QuickReturnIntake.tsx` — the lightweight
  returning-user screen. Shows ONLY:
    - "Welcome back" pill + "Picking up where you **left off**." headline.
    - Existing-project picker (default = `profile.lastProjectId`) OR new-
      project name input (tabs at top to switch).
    - Green "Find my engineer →".
    - Escape hatch: "Something has changed about my setup" link drops
      back to the full editorial intake.
  - Reuses identical submit pipeline (project mint, session mint, intake
    upsert from profile, `match_engineer`, hop to matching).
  - `developing` defaults to `"Website"` for return flow (CHECK
    constraint satisfied; engineer refines context in chat).
- `IntakeClient` chooses `QuickReturnIntake` when
  `hasFullIntake(profile)` returns true.
- `app/_components/intake/IntakeAssistant.tsx` — bootstrap branches on
  `profile.hasFullIntake`:
    - Returning user → opener "Welcome back — picking up where you left
      off." + stack-increment prompt "Last time you were using X, Y, Z.
      Anything new since?" with quick-replies: existing stack + "No,
      same setup".
    - Submitting any chip/text appends a new entry to
      `profile.stack.aiTools` via `patchProfile`. "No, same setup" is a
      no-op.
    - After increment answer, no further bot prompts — chat goes
      free-form while the engineer rings.
  - `// TODO(ai): wire the real Anthropic transport once available.`

### Order 3 — Chat header call button (`app/room/RoomClient.tsx` → `FloatingStatus`)
- The chat header now leads with the **session title** (left-aligned,
  serif), then timer + status pill, then the **prominent green circular
  call button** (`<IconButton variant="primary">` + `<Video>` icon),
  followed by **Add-participant** (`<UserPlus>`, disabled tooltip "coming
  soon") and **More** (`<MoreHorizontal>`) overflow. Right side: red End
  call (`var(--risk)`).
- Call button is enabled when `zoom_meeting_id` is set on the session +
  status is `assigned|joining|live|grace`. Disabled (with a tooltip
  explaining why) before the engineer mints the call.
- Click scrolls the user to the inline ZoomJoinCard via
  `[data-relay-zoom-card]` (added below in chat content).

### Order 4 — Per-screen status

| Screen | Status |
|---|---|
| Dashboard / chat shell | **Order 1 + 3 landed.** Right Summary tray was added in the first pass. Full RoomClient body restyle (composer chrome, every empty state) is partial — token sweep covers most, designed empty states deferred (see TODO below). |
| Intake / Find-an-Engineer | **Fully rebuilt** per Order 2 — editorial 4-step + QuickReturnIntake. |
| Ringing / waiting | Slide-to-top + chat-while-ringing shipped in pass 1; in-chat stack increment shipped in pass 2. |
| Call room | NOT rebuilt — Zoom embed chrome is owned by the SDK. **`// TODO(ui): rebuild labelled control bar around ZoomCallCard with Mute / Stop video / Share / Chat / More + red End call.`** Deferred. |
| Session summary (full) | NOT rebuilt as a new mini-nav surface. The right-rail `SessionSummaryTray` covers the inline case. **`// TODO(ui): full /room/session/[id] summary page with left mini-nav (Summary / Chat transcript / Shared files / Error logs / Session details).`** Deferred. |
| Operations / Supervise | Token sweep covers it; pod placeholder shipped. Deeper table rebuild deferred. |
| Auth / Profile | Token swap propagates. Profile chip surfacing comfort + stack as read-only chips is **`// TODO(ui): surface profile.techComfort + flattenStack(profile.stack) chips on /room user menu.`** Deferred. |

### Order 5 — Copy

This pass touched the high-signal copy:
- Intake headlines + sublines rewritten editorially.
- QuickReturnIntake copy: "Welcome back — picking up where you left off."
- IntakeAssistant opener for returning users.
- Sidebar pills labelled clearly.

Full sweep across every system message / error / button across the app
**not done.** `// TODO(copy): full warmth pass per Order 5 — every empty
state, every error, every waiting state.`

## New TODOs left

- `// TODO(profile)` in `lib/relay/profile.ts` — wire to real backend
  store (suggested shape in file header).
- `// TODO(api)` in `app/intake/IntakeClient.tsx` — widen
  `client_intakes.ai_tools_used` to `text[]`; add `tech_comfort` and
  `urgency` columns as first-class signals.
- `// TODO(ai)` in `app/_components/intake/IntakeAssistant.tsx` (existing
  + extended for the returning-user branch) — Anthropic transport for
  the bot.
- `// TODO(ui): rebuild labelled call-controls toolbar around
  ZoomCallCard.`
- `// TODO(ui): build full /room/session/[id] summary page with left
  mini-nav.`
- `// TODO(ui): surface profile.techComfort + stack chips on /room user
  menu.`
- `// TODO(copy): considerate warmth sweep across every empty state /
  error / waiting state.`
- `// TODO(pod-allocation)` (existing) — wire real allocation data into
  `<PodAllocationPanel>`.

## Files touched (second pass)

| File | Change |
|---|---|
| `lib/relay/profile.ts` | NEW — local profile-context store |
| `app/intake/IntakeClient.tsx` | Rebuilt — editorial 4-step + profile sync + return-user branch |
| `app/_components/intake/QuickReturnIntake.tsx` | NEW — "Is this for [Project]?" lightweight screen |
| `app/_components/intake/IntakeAssistant.tsx` | Bootstrap branches on `profile.hasFullIntake`; stack-increment path; persists to profile |
| `app/room/RoomClient.tsx` | Sidebar: expanded by default, loud green New session + ChevronDown caret + ghost New chat, labelled New project, always-visible green Phone icon + ⋮ per project row. FloatingStatus: title + green circular call IconButton (Video icon) + Add-participant + More. New `CallHeaderActions` component. |

---

## Third pass — Closable timer, auto names, selection highlight, resume (2026-05-22, later)

### FIX 1 — `ConnectingModal` is closable, minimizes to a top-center pill
- `app/room/RoomClient.tsx` → `ConnectingModal`:
    - Internal `minimized: boolean` state.
    - `×` IconButton top-right (`aria-label="Minimize — keep waiting"`) +
      `Esc` keydown + click-outside (backdrop) → all minimize. **None of
      these cancel the search.**
    - Minimized render: top-center floating pill, `fixed inset-x-0 top-4
      z-40`, pulsing green dot + "Calling engineer" + live `MM:SS`
      countdown + a small inline `PhoneOff` icon that *does* cancel.
      Tap the pill to re-expand.
    - Backdrop now uses `var(--scrim)` (was hard-coded `rgba(0,0,0,0.55)`).
    - Inside the expanded card: new "Cancel search" destructive-ghost
      button (the **only** control that stops ringing) + a helper line
      `Press Esc to minimize and keep waiting — the search continues in
      the background.`
    - `onCancel: () => Promise<void>` added to the prop API; wired to
      `state.cancel` from `RoomClient`.

### FIX 2 — Auto-named sessions
- `app/room/RoomClient.tsx` → Sidebar past-sessions mapper:
    - Priority: `ai_summary_title` → `${projectName} · ${friendlyDate},
      ${friendlyTime}` → `Session · ${friendlyDate}, ${friendlyTime}`.
    - Status (`ended | cancelled | abandoned`) is now a **small uppercase
      tracked badge** beside the meta line, never the session's name.
      Cancelled-CORS session reads "CORS error issues" with a "Cancelled"
      pill, not "Cancelled session" as a title.
    - `// TODO(ai): improve auto-naming` — placeholder for OpenAI-driven
      naming off the intake topic + first user message when the AI
      summary is missing.

### FIX 3 — Bigger call button + real selection border
- `ProjectAccordion` per-row green call icon → **filled green circle**
  (`size-8`, white phone glyph, shadow-sm). Hit target ~32px. Confident,
  always visible.
- Session card selection state: real `border-[var(--primary)]` +
  `bg-[var(--primary-tint)]` (was just a faint fill). Currently-live
  session gets the same treatment at 60% tint so it stands out from past
  selected. Pulsing green dot persists for live; static gray dot for
  inactive.

### FIX 4 — Continue this session / Start a follow-up
- `ReadOnlyChatPane` now takes `session: GuestCall`. The bare
  "Session ended — read-only" pill is replaced by a real action card:
    - Lock-icon "Session ended" eyebrow + warm copy
      "Pick up where you left off, or start fresh with the same context."
    - **Continue this session** — primary green CTA (`RefreshCw` icon).
      Stashes `relay-resume-context` in localStorage with the prior
      session's `{mode:"continue", fromSessionId, projectId, projectName,
      aiSummaryTitle, aiSummary, aiNextSteps, savedAt}`. Routes to
      `/intake` (which lands on `QuickReturnIntake` if the user has a
      profile, full intake otherwise).
    - **Start a follow-up session** — secondary outline (`Plus` icon).
      Same stash, `mode:"follow_up"`.
    - `// TODO(api): wire true in-place reopen that re-enables the
      existing session's composer rather than minting a fresh session in
      the same project.`
- `IntakeAssistant.tsx` reads `relay-resume-context` on bootstrap. If
  present:
    - Opener line picks topic from `aiSummaryTitle` or `projectName`.
    - First bot prompt is **context-aware** via local heuristics
      (`pickResumePrompt`):
        - deploy/build/CI signal → "Do you need more help getting this to
          production?"
        - auth/permissions/RLS signal → "Still on the auth flow?"
        - error/bug signal → "Is there a new error? Paste it or drop a
          screenshot."
        - topic-anchored fallback → "Want to keep going on '[topic]'?"
        - generic → "What's changed since last time?"
    - Quick-reply chips tailored per branch.
    - `// TODO(openai): generate context-aware resume prompts via OpenAI
      using prior session context.` Single seam — swap the heuristic
      block. No client key, no env var.
- Stash is cleared after consume + auto-expires after 30 min.

---

## Fourth pass — chat-mode split, autoscroll, demo content (2026-05-22, later)

### 1 — "New session" vs "New chat" entry modes
- `handleNewSession` (existing) — unchanged. Live engineer path: intake →
  ring → engineer joins via the existing pipeline.
- NEW `handleNewChat` — async support path. Routes to `/room?newchat=1`.
- `Sidebar` gains `onNewChat` prop. The ghost "New chat" button now wires
  to `handleNewChat` (was reusing `onNewSession`).
- `RoomClient` reads `?newchat=1` on mount, sets `asyncChatMode`, strips
  the query so reloads don't re-trigger.
- When `asyncChatMode`:
    - `ConnectingModal` **suppressed** (no calling overlay, ever).
    - Main pane swaps `<MainPane>` for the new `<AsyncChatPane>` — a
      light shell with `relay chat` header, a **prominent green
      circular Video IconButton** ("Start a live call") plus an X to
      close async mode, and an inline `<IntakeAssistant>` greeting:
      *"Hi! Describe what you need help with — drop a screenshot or
      paste an error if you have one. An engineer will pick this up;
      you can also tap the green call button up top to ring someone
      now."*
- `// TODO(api): introduce a real intake_mode column on guest_calls so
  the backend can distinguish "ring now" vs "async queue" requests.`
- `// TODO(openai): the bot greeting + follow-up prompts should call an
  OpenAI-backed server route seeded with profile + prior session
  summary.` Single seam — same place as the resume-prompt heuristic.

### 2 — Smart auto-scroll + image-onload + "↓ New messages" pill
- `IntakeAssistant`:
    - New state: `pinnedToBottom` (default true), `hasNewBelow`.
    - `isNearBottom` helper (within 80px of bottom).
    - `onThreadScroll` updates pin status; near-bottom resets the
      new-below flag.
    - On new messages: scroll if pinned, otherwise mark "↓ New messages".
    - `scrollToBottom(smooth)` respects `prefers-reduced-motion` —
      instant when reduce is set, smooth otherwise.
    - "↓ New messages" pill renders absolutely positioned at the bottom
      of the thread when scrolled up + content has landed; clicking
      jumps + clears.
- `Bubble` now takes `onImageLoaded` and fires it on the embedded
  image's `onLoad`. Parent re-evaluates `isNearBottom` and scrolls only
  if the user was already pinned — final bubble height is now known.
- Images render as **click-to-expand thumbnails**: max-height 224px,
  rounded border, hover scale-up; clicking opens a lightbox
  (`fixed inset-0 z-50 bg-[var(--scrim)]`) with the full-size image.

### 3 — Realistic demo content
- `lib/intake/intakeAssistant.ts` — every `INTAKE_SCRIPT` prompt body
  rewritten to natural 2-3 line copy. e.g. "Tell me what you're building.
  A sentence or two is plenty: the kind of product, who it's for, and
  how far along you are." instead of the prior single-line version.
- Bubble `max-width` widened to `min(640px, 72ch)` with
  `whitespace-pre-wrap break-words` so long messages wrap cleanly with
  comfortable line-height.

### 4 — Call-ended state polish — DEFERRED
- `// TODO(ui): polish call-ended sparkle card + thread pill to match
  room-w.png exactly. Today the existing MeetingChatEntry renders the
  ended call inline; the token swap brings it onto the white system but
  the bespoke "Zoom call ended · Nm Ns" card with sparkle + summary
  affordance per the mock is a focused follow-up.`

### 5 — Full session summary page — DEFERRED
- Right-rail `SessionSummaryTray` (pass 1) covers the inline case; the
  brief's full `/session/[id]` page with left mini-nav (Summary / Chat
  transcript / Shared files / Error logs / Session details) +
  Download report action is pending.
- `// TODO(ui): build the full session-summary page per theeme-w.png
  panel 4.`

## TODOs added this pass

- `// TODO(api): introduce real intake_mode column on guest_calls.`
- `// TODO(openai): bot greeting + follow-up prompts via server-side
  OpenAI route` (single seam shared with resume-prompt heuristic).
- `// TODO(ui): polish call-ended sparkle card per room-w.png.`
- `// TODO(ui): build full session-summary page per theeme-w.png panel 4.`

