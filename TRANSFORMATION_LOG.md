# TRANSFORMATION_LOG.md

Running log of the Relay UI transformation. One entry per phase commit.
Records before→after deltas, components introduced, and the explicit
`TODO(api)` / `SEAM` markers left for backend.

Branch: `feat/ui-transformation`.

---

## Phase 1 — Analysis (e701ca6)

`UI_ANALYSIS.md` written. Branch created. No code changes. No backend
touched.

**Outcome:** all seven open questions in §G resolved (see Phase 2 below).

---

## Phase 2 — Design system layer (this commit)

**Goal:** stand up the token + primitive foundation so screens in Phase 3+
have one consistent library to lean on. Zero data contracts touched, zero
existing components removed.

### Decisions locked

| # | Decision | Reason |
|---|---|---|
| 1 | **Coral primary, green launcher + healthy** | Repo tokens + `CLAUDE.md` already codify this; deletes the 3-greens conflict (`--primary` coral vs `--green-dot` vs hardcoded `BRAND_GREEN`). |
| 2 | **Keep Source Serif 4 + Inter** | Already next/font-wired. No new font loads. |
| 3 | **Migrate `BRAND_GREEN = "#3f5c2e"` → `--primary` / `--green-dot`** | Will land per-screen in Phase 3+ as files are touched. |
| 4 | **Unify PaywallModal palette to tokens** | Conversion moment can't look like a different app. Lands in Phase 7. |
| 5 | **Intake AI-tool multi-select submit shape**: `aiTools.join(", ")` into existing `ai_tools_used` string column | Preserves DB contract; marked `TODO(api): widen column to text[]`. Lands in Phase 3. |
| 6 | **Pod presence**: derive online state from `lastCallAt ≤ 5min idle` | No new contract; SEAM comment for later real presence. Lands in Phase 9. |
| 7 | **Test churn**: fix in-place when CTA labels change in Playwright specs | No upfront sweep. |

### Added

**Tokens (extension only — no existing token altered)** —
[`app/globals.css`](app/globals.css):

- `--surface-raised`, `--border-strong`, `--text-faint`
- `--primary-soft`, `--green-soft`
- `--ok` / `--ok-soft`, `--warn` / `--warn-soft`, `--risk` / `--risk-soft`
- `--accent` / `--accent-strong` (alias to `--primary` family)
- `--scrim` (unified modal backdrop)
- `--motion-fast` / `--motion-med` / `--motion-slow`
- Mapped each into `@theme inline` so Tailwind v4 utilities pick them up.
- New keyframe `relay-pulse-ok` + `data-relay-pulse` attribute selector
  for the launcher CTA and ringing-state living motion.
- Extended `prefers-reduced-motion` block to kill `data-relay-pulse`,
  `animate-ping`, the legacy `relay-pulse` / `engineer-ring` keyframes
  (audit fix), and clamp transitions globally to 0.01ms.

**Primitives** —
[`app/_components/ui/`](app/_components/ui/):

| File | What |
|---|---|
| `cn.ts` | Tiny classnames util (no `clsx` dep). |
| `Button.tsx` | 5 variants (`primary`/`secondary`/`ghost`/`danger`/`launcher`) × 4 sizes (`sm`/`md`/`lg`/`xl`). `md`+ meet WCAG 44px touch. `launcher` carries the green pulse halo. Loading state, icon slots, full-width. |
| `Input.tsx` | Real `<label>` (audit fix: kills placeholder-only labels), hint/error wiring, `aria-invalid`, prefix/suffix slots, ≥44px height. |
| `Textarea.tsx` | Same label/hint/error contract as Input. For forms (ChatComposer keeps its bespoke auto-grow). |
| `OtpDigitInput.tsx` | Discrete digit boxes for the 8-digit OTP. Auto-advance, backspace-retreat, paste fills, `autoComplete="one-time-code"`, `inputMode="numeric"`. |
| `Chip.tsx` + `ChipGroup` | Selection chips with `multi` support. Active state: coral-soft tint + coral border + coral dot before label. Drop-in for `wizard/ChipGroup.tsx`. |
| `StatusBadge.tsx` | 5 tones (`ok`/`warn`/`risk`/`info`/`neutral`). **Icon + label**, never color alone (audit fix). |
| `HealthBar.tsx` | 0–100 session-health bar with label (`Healthy` / `Shaky` / `At risk` / `No signal`). `role="progressbar"`. For Supervise board. |
| `Card.tsx` | `Card` + `CardHeader` + `CardBody` + `CardFooter`. 3 variants (`surface` / `raised` / `hollow`). `interactive` for clickable session cards. |
| `EmptyState.tsx` | Icon + serif title + body + action. Fills "dead pane" surfaces. |
| `SectionHeader.tsx` | Title + subtitle + right slot. Serif display by default. |
| `Avatar.tsx` | Initials fallback from name/email; 4 sizes; `tone="ok"` for online state. |
| `Modal.tsx` | **Single primitive solves all six modal a11y audit findings**: `role="dialog"`, `aria-modal`, focus-trap, ESC-close, scrim-click close, body-scroll lock, focus-restore. |
| `Toolbar.tsx` | Flex container with `.Group`, `.Spacer`, `.Divider` slots. |
| `Toast.tsx` | `role="alert"` / `aria-live` set by tone (audit fix: silent-toast). Inline; no global provider yet. |
| `index.ts` | Barrel. Use `import { Button, … } from "@/app/_components/ui"`. |

**Docs** — [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md):

- Mood + color discipline + typography + motion rules.
- Per-primitive usage gallery (copy-pasteable).
- CTA hierarchy + state matrix + a11y bar.
- Anti-patterns table (don't-vs-do).
- Phase 3+ migration checklist.

### What did NOT change

- **Zero data contracts touched.** No props, hooks, queries, RPCs, or
  Supabase channels reshaped.
- **Zero existing components removed.** All ad-hoc components still
  work; they migrate in their owning screen's phase commit.
- **No `BRAND_GREEN` deletions yet.** They land per-file in Phase 3+ as
  the screens that own them get restyled.
- **No new routes.** The dev preview is `DESIGN_SYSTEM.md`, not a
  shipped page (avoids polluting the build surface).

### Verification

- `node ./node_modules/typescript/bin/tsc --noEmit` → **clean** (no
  errors).
- `eslint app/_components/ui/` → **clean** (no errors, no warnings).
- `npm run build` → compiles + TypeScript pass. Prerender of `/room`
  fails only because `.env.local` Supabase keys are absent — confirmed
  **identical failure on baseline `main`** (env issue, not code).
- Project-wide `eslint .` baseline: 170 problems on `main`,
  still 170 with these changes (zero new lint issues introduced).

---

## Phase 3 — Login + signup (this commit)

**Files restyled:** `app/login/SignInForm.tsx`, `app/login/page.tsx`,
`app/staff/login/StaffLoginForm.tsx`, `app/staff/login/page.tsx`,
`app/set-password/SetPasswordClient.tsx`.

**Data contracts: untouched.** Same endpoints
(`/api/auth/signin-password`, `/api/auth/prepare`, `/api/auth/send-otp`,
`/api/auth/verify-otp`, `/api/auth/set-password`,
`/api/dev/sign-in-as`). Same Mode + Purpose enums. Same redirect
targets (`window.location.assign(body.next ?? …)`). Same `?mode` +
`?continue` query plumbing on set-password. Same 401-bounces login.

**Visual deltas (every screen):**

- Card chrome on a calm dark canvas with a quiet coral top-gradient
  (10% tint) for atmosphere — replaces the flat dark page.
- Hero copy uses the serif display face (`font-serif`).
- `100dvh` instead of `min-h-screen` so iOS Safari's bottom bar doesn't
  clip the chrome (audit issue).
- Real `<label>` on every field via `<Input>`. `autoComplete` confirmed
  (`email`, `current-password`, `new-password`, `one-time-code`).
- **Coral primary CTAs** via `<Button variant="primary" full>`. No
  more `BRAND_GREEN = "#3f5c2e"` inline in any of these files.
- **`<OtpDigitInput length={8}>`** replaces the single-input "12345678"
  text field on both `/login` (first-time + forgot OTP code mode) and
  `/staff/login` (forgot OTP code mode). Auto-advance, backspace
  retreat, paste fills all 8 boxes, `inputMode="numeric"`,
  `autoComplete="one-time-code"` for SMS / mail-app autofill.
- **Inline errors use `<Toast tone="risk">`** which carries
  `role="alert"` + `aria-live="assertive"` (audit fix: silent-toast).
- **Inline successes use `<Toast tone="ok">`** ("Code sent to …").
- Password-rule checklist on set-password uses `--ok` token, not
  hardcoded green.
- Show/hide password button moved into the new `Input` suffix slot
  with proper `aria-label`.
- Dev-mode shortcuts panel (engineer / supervisor / internal /
  enterprise) restyled to coral-soft icon tile, kept its `Briefcase /
  Eye / ShieldCheck / Building2` glyphs.

**Brand-green deletions:** all `BRAND_GREEN = "#3f5c2e"` constants
gone from these three components. Two callers down, 13+ to go.

**Verification:** `tsc --noEmit` clean. `eslint` clean on touched
files. `npm run build` previously verified at Phase 2; not re-run this
phase because no new dependencies or build-graph edges added (only
swapped JSX inside existing client components).

---

## Phase 4 — Intake wizard + multi-select fix (this commit)

**Files restyled:** `app/intake/IntakeClient.tsx`,
`app/_components/wizard/WizardShell.tsx`.

**Brief §5.2 fix delivered: AI-tool step is now multi-select.**

- Gate relaxed: `aiTools.length === 1` → `aiTools.length >= 1`
  ([`IntakeClient.tsx:104`](app/intake/IntakeClient.tsx:104)).
- Submit shape: `ai_tools_used: aiTools.join(", ")` (preserves the
  existing `client_intakes.ai_tools_used` text column on Supabase)
  ([`IntakeClient.tsx:172`](app/intake/IntakeClient.tsx:172)).
- **Seam left for backend:** `// TODO(api): widen
  client_intakes.ai_tools_used to text[]` immediately above the
  submit. No UI changes needed at that point.
- Step 2 passes `multi` to `<ChipGroup>`; the user toggles any
  combination of Claude / ChatGPT (Codex) / Deep Seek / Lovable /
  Replit / Some Other.
- Step 4 (technologies) was already multi; left untouched.

**Visual deltas:**

- `WizardShell` left panel: was a flat green gradient
  (`#2a3d1f → #3f5c2e`). Now: `--surface-raised` with a quiet coral
  radial top-left + a faint green halo bottom-right. Editorial,
  not loud. Matches the login canvas atmosphere.
- Serif display title on left panel and mobile.
- Progress bar uses tokens (`--text` filled, muted track) instead of
  `#f5f4ee` literals.
- Next button is the new `<Button size="lg">` (coral primary)
  with `loading` state. Old hardcoded `BRAND_GREEN` CTA gone.
- Inline error is now `<Toast tone="risk" role="alert">` (audit fix).
- `IntakeClient` now imports `ChipGroup` from `@/app/_components/ui`,
  not from `wizard/ChipGroup.tsx`. The wizard's ChipGroup is now
  unused; kept on disk until Phase 12 cleanup.
- "Find Engineer" label → "Find an engineer" (calmer voice).
- Step 2 subtitle now says "Pick every tool that's in your stack —
  we'll match the right engineer." — explicit cue that multi-select
  is supported.
- Loading state restyled (uses `100dvh` + tokens, not `min-h-screen`).

**Data contracts: untouched.** Same Supabase RPCs
(`create_project`, `get_or_create_active_customer_session`,
`cancel_customer_session`, `match_engineer`). Same `client_intakes`
upsert with `onConflict: "project_id,customer_user_id"`. Same
post-submit redirect `router.replace(/room?matching=…)`. Same legacy
project short-circuit. Same `ACTIVE_SESSION_STATES`. Same auth bounce
to `/login?next=/intake`.

**Verification:** `tsc --noEmit` clean. `eslint` clean on touched
paths.

---

## Phase 5 — Dashboard / empty state (this commit)

**File touched:** `app/room/RoomClient.tsx` — only the `BrandedLanding`
component (the empty-state landing) plus its summary right-rail. The
~3500-line `RoomClient` is otherwise untouched in this phase; live
chat + room come in Phase 7.

**Visual deltas:**

- Hero CTA promoted to **`<Button variant="launcher" size="xl">`** with
  the green pulse halo — "Get an engineer now." This is the single
  most obvious action on the screen, brief §5.3 satisfied.
- Hero copy strengthened: subcopy now sets expectations ("A qualified
  human joins your chat + Zoom call in ~90 seconds. Tap below to
  start."). Tiny faint reassurance below the CTA: "Chat + Zoom. No
  installs. Pay only for time you use."
- Atmospheric green radial top-glow framing the dashboard — matches
  the calm control-room mood. Subtle, not noisy.
- Headline switched from inline `style={{ fontFamily, color,
  letterSpacing, lineHeight }}` to `font-serif text-3xl … sm:text-4xl
  tracking-tight` utilities. Tokens for color.
- "Working in {project}" pill: BRAND_GREEN/SOFT/BORDER inline colors
  replaced with `--surface-raised` chrome + `--primary-soft` icon
  tile + `--primary` text + `--text-muted` eyebrow. Read more
  consistently with the rest of the new design.
- Project-scoped CTA also uses `launcher` variant.
- **Right-rail summary panel** restyled:
  - `Loader2` no longer hardcoded `BRAND_GREEN`.
  - Title uses `font-serif` utility.
  - Body wrapped in `max-w-prose` (audit-flagged readability — was
    700+ char lines on wide splits).
  - "Next steps" arrow upgraded from a plain `→` character to a
    `ChevronRight` Lucide icon (audit fix: text glyph-as-icon).
  - "No summary yet" → `<EmptyState compact>` (with passing through
    the existing `panelEmptyHint`).

**Data contracts: untouched.** Same `customer_summaries` query, same
`useState<CustomerSummary>`, same right-rail collapse state, same
`onStartNewSession` / `onStartInProject` / `onClearSelectedProject`
props.

**Brand-green deletions in BrandedLanding:** the JSX no longer
references `BRAND_GREEN`, `BRAND_GREEN_SOFT`, `BRAND_GREEN_BORDER`.
The constants remain at the top of `RoomClient.tsx` for the
not-yet-restyled live-session JSX. They go in Phase 7.

**Verification:** `tsc --noEmit` clean.

---

## Phase 6 — Ringing + chat-while-ringing + IntakeAssistant (this commit)

**Brief §5.4 + §7 delivered.** The "ringing engineers" screen is no
longer a dead modal: it now hosts an enabled chat composer + an AI
intake assistant + a "Context for your engineer" summary card.
**All shells are local-state only. No backend changes.**

### New files

| Path | Purpose |
|---|---|
| `lib/intake/intakeAssistant.ts` | Pure script + types. `INTAKE_SCRIPT` (4 questions: building, problem, stack, AI tools + wrap-up), `askNext(ctx)`, `captureAnswer(ctx, prompt, answer, attachment)`, `emptyContext()`, `contextIsUseful(ctx)`. Stable interface so backend can swap to a real Anthropic transport later without touching the UI. |
| `app/_components/intake/IntakeAssistant.tsx` | Chat-shell. Local-state messages + draft + staged file. Reads prompts from `INTAKE_SCRIPT`, captures answers into a running `IntakeContext`, emits the context up to the parent via `onContextChange`. Composer is a textarea + paperclip + ui/Button. Bubbles role-distinct (coral-soft for user, surface-raised for assistant). `role="log"` + `aria-live="polite"` on the thread. |
| `app/_components/intake/ContextCard.tsx` | "Context for your engineer" summary. Reads the `IntakeContext` and renders a tidy field list + attachment thumbnails. Empty-state placeholder when nothing has been captured yet. |

### `MatchingClient.tsx` restyle

- Layout: single centered card → **two-column grid on `lg`** with the
  pulse + context on the left, the chat on the right; **stacked on
  mobile**.
- `PulseDot` now uses `--green-dot` token (replaces `BRAND_GREEN`) +
  the new `data-relay-pulse` halo selector on the inner dot for the
  calm living motion.
- "Cancel" button via `<Button variant="secondary">` (was a hand-rolled
  bordered pill).
- "Try again" button on `no_engineer` via `<Button loading>` — proper
  loading state (was inline `Loader2` swap).
- "Engineer joined — taking you in…" spinner uses `--ok` token.
- Atmospheric green top-glow framing the canvas (matches dashboard).
- Wrap chrome via `Card` + `CardBody` primitives. No more
  `min-h-screen`; uses `100dvh`.
- `ContextCard` mounts under the pulse — the customer SEES their
  context building up as they answer. Reassuring.

### Seams left

- `lib/intake/intakeAssistant.ts` has a `TODO(api)` block at the
  bottom with the suggested Anthropic wire-up. UI interface stays.
- `IntakeAssistant.tsx` line in `handleFile`: `// TODO(api): upload
  to storage.` (today's preview URL is a local `blob://` ref).
- The pre-join transcript is intentionally NOT persisted to Supabase.
  When the engineer joins, the customer redirects to `/room` which
  has its own live chat. A future backend job ("persist intake
  context to the session row") would flip the IntakeAssistant to
  call out — UI is already shaped to accept that flip.

### Data contracts: untouched

- Same realtime channels (`engineer_match_offers`, `guest_calls`).
- Same `POLL_MS = 1500` belt-and-braces.
- Same phase machine (loading / ringing / no_engineer / cancelled
  / accepted).
- Same RPCs (`expire_stale_offers`, `match_engineer`,
  `cancel_customer_session`).
- Same `ACCEPTED_SESSION_STATES` + `TERMINAL_SESSION_STATES` sets.
- Same redirect to `/room` on accepted.

**Verification:** `tsc --noEmit` clean. `eslint` clean on touched paths.

### Notes for Phase 7 (Chat + call room)

- Restyle the live `/room` JSX in `RoomClient.tsx`:
  - Promote the Zoom-call CTA (`MeetingChatEntry` Join button +
    composer toolbar Phone button) to `<Button variant="launcher">`.
  - Chat bubble styling (user vs engineer vs system vs assistant).
  - Read-only/ended treatment in `PastSessionReview` calmer.
  - Sidebar customer-side cleanup (without touching the 80-row
    fetch — perf is a follow-up, not a UI phase task).
  - Migrate the inline modals (ConfirmEndModal, ConnectingModal,
    EngineerAssignedModal) to the new `ui/Modal` primitive — bundles
    ESC + focus-trap + scrim-click for free.
  - Also drop a second `IntakeAssistant` mount: in-room while a call
    is connecting (brief §5.5).
- Replace `MeetingChatEntry`'s `BRAND_GREEN` palette with tokens
  (Join CTA uses `launcher`; ended state uses `ok` tone).
- This phase will be **big** — commit per logical chunk if needed.
