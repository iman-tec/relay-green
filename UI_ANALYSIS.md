# UI_ANALYSIS.md — Relay UI Transformation, Phase 1

> Phase 1 deliverable per the transformation brief. Read-only mapping +
> proposed direction. **No code changes yet.** Stop here for review before
> any reform begins.
>
> Sibling docs already in the repo:
>
> - [`UI_UX_AUDIT.md`](UI_UX_AUDIT.md) — severity-tagged problem list (kept;
>   findings folded into §E below).
> - [`UIchanges.md`](UIchanges.md) — Superadmin-panel-only redesign spec
>   (different scope from this transformation; left untouched, will inform
>   admin-v2 styling consistency).

---

## Design direction (locked at top per §3 of brief)

**"Calm control room."** Dark-first, editorial, reassuring, fast. A quiet,
well-run operations desk where a calm expert is already on the way. Built
**from** the existing identity, not over it.

**Critical brand correction up front.** The transformation brief calls Relay
green "the single decisive accent." The actual brand in
[`app/globals.css`](app/globals.css:13-28) is **Claude coral primary
(`--primary: #d97757`)** with **green reserved for the launcher dot and
"healthy" status (`--green-dot: #3dcb7e`)**. Repo-level docs
([`CLAUDE.md`](CLAUDE.md:138-144), [`RelayGreen_Spec_Decisions_v1.md`])
confirm coral-primary, green-launcher. The current code base contradicts
its own tokens by hardcoding **`BRAND_GREEN = "#3f5c2e"` (a third, darker
olive green) in 15+ files** as the de-facto CTA color.

**Resolution proposed for this transformation:**

- **Primary CTA = coral** (`--primary`). One per screen.
- **Launcher (the green dot, the "Get an engineer now" button on the
  dashboard hero, the ringing-state living motion) = `--green-dot`.**
  Scarce enough that it always means "go."
- **Status = semantic, not branded** — `--ok` (green-dot derivative),
  `--warn` (amber), `--risk` (red/coral-red). Health bars use icon + label,
  not color alone.
- **Kill `BRAND_GREEN = "#3f5c2e"`.** It was a third green that never
  belonged. All 15+ hardcoded usages migrate to tokens.

The brief's "Relay green CTA" intent is honored *aesthetically* (the
launcher and the live "ringing" surface are visibly green and feel like the
brand), while the primary action color across the rest of the product is
coral — matching the codified spec and avoiding a fight between three
greens.

**Type:** keep Source Serif 4 (display) + Inter (UI) + JetBrains Mono (code)
wired in [`app/layout.tsx`](app/layout.tsx). Body ≥16px, line-height ~1.5,
deliberate scale. No font swap — repo already uses next/font with the
serif-grotesque pairing the brief asks for. The brief's suggestions
(Fraunces / Newsreader / General Sans) are valid but introducing a new font
load is a *separate* decision; flagged as a question for review (§G).

**Surfaces & motion:** layered dark via lightness on `--surface` /
`--background` / `--border` (already present). Hairline borders. Single
staggered reveal per route (already there at `main { animation:
relay-page-in }`, [`app/globals.css:147-149`](app/globals.css:147)). Tasteful
pulse for the ringing state and the launcher only. `prefers-reduced-motion`
already partially honored — needs to extend to the existing `ping`,
`relay-pulse`, `engineer-ring` keyframes per audit.

---

## A. Stack & tooling

| Layer | Reality on disk |
|---|---|
| Framework | **Next.js 16.2.6** App Router, edge `proxy.ts` (not `middleware.ts`). |
| React | **19.2.4**. `reactStrictMode: false` (Zoom SDK singleton). |
| TypeScript | 5.x, strict mode (`tsc --noEmit` via `npm run typecheck`). |
| Styling | **Tailwind v4** (`@tailwindcss/postcss`) + `@theme inline` block in [`app/globals.css`](app/globals.css:37-52) mapping CSS vars → utility colors. **Tokens-in-globals.css is the source of truth.** No `tailwind.config.{js,ts}`. |
| Token vars | [`app/globals.css:13-35`](app/globals.css:13). Dark-only (`color-scheme: dark`). `--background`, `--surface`, `--border`, `--text`, `--text-muted`, `--primary` (coral), `--primary-hover`, `--green-dot`, `--accent-red`. **No `--surface-raised`, `--text-faint`, semantic `--ok` / `--warn` / `--risk`.** |
| Component lib | **Custom + ad-hoc.** No shadcn, no Radix, no Headless UI. Some reusable primitives exist under `app/_components/admin-v2/` (Drawer, Sidebar, TabsHeader, DataTable, DetailCard, MinutesBar, UserChip) — built for the admin redesign in [`UIchanges.md`](UIchanges.md). Outside admin, ~everything is hand-rolled. |
| Icons | **`lucide-react ^1.14.0`** dependency present, but most surfaces use literal characters (`→`, emoji, custom SVGs inline). Lucide is **available**, **underused**. |
| Fonts | `@fontsource/source-serif-4` + `@fontsource/inter` (npm), JetBrains Mono via next/font. Wired in [`app/layout.tsx`](app/layout.tsx). |
| Animation | CSS keyframes only (`@keyframes ping`, `relay-pulse`, `engineer-ring`, `relay-page-in`, `relay-fade-in`, `relay-toast-in`). No Framer Motion. `aos ^2.3.4` is present but only for marketing. |
| Auth | Supabase `@supabase/ssr` + `@supabase/supabase-js`. Customer = magic link (`/login`). Staff = 8-digit OTP (`/staff/login`). Read-only `lib/auth.ts` is the **demo-cookie shim**, do not touch. |
| Data | **Supabase exclusively.** Prisma stub at [`lib/db.ts`](lib/db.ts) throws on call. `prisma/schema.prisma` is doc-only. Schema migrations live in [`supabase/migrations/`](supabase/migrations/). |
| Tests | Playwright (`tests/`), `workers: 1`, baseURL `https://10.0.1.207:3000` (stale — package.json dev binds to `10.0.2.62`; see [`CLAUDE.md`](CLAUDE.md) drift note). |

**Implication for the transformation:** we **work within Tailwind v4 + CSS
vars in `globals.css`**. The token system gets extended (semantic statuses,
elevation, faint text) but not replaced. shadcn is **not** introduced —
brief allows it but the repo has rejected that path; we keep one toolkit.

---

## B. Route & screen map

Generated from `app/**/page.tsx` + every `*Client.tsx`. **Bold** = primary
target of this transformation. *(legacy/Prisma-stub — see [`CLAUDE.md`](CLAUDE.md:64-73))*
= surfaces flagged by repo guidance as either dead, broken, or marketing.

### Customer + auth

| Brief screen | Route | Client | Notes |
|---|---|---|---|
| Login | `/login` | [`SignInForm.tsx`](app/login/SignInForm.tsx) | Email + password + OTP fallback. Multi-mode form. |
| First-time signup | (no dedicated route) | same `SignInForm.tsx` `purpose: "first-time"` branch | OTP code input is a single `<input>`, **not digit boxes** today. |
| Set password | `/set-password` | [`SetPasswordClient.tsx`](app/set-password/SetPasswordClient.tsx) | `mode=customer\|staff` query param. |
| Onboarding / Intake (4-step) | `/intake` | [`IntakeClient.tsx`](app/intake/IntakeClient.tsx) | Wizard. **Step 2 (AI tool) is single-select today** — see §G.intake. |
| Matching (ringing engineers) | `/intake/matching/[id]` | [`MatchingClient.tsx`](app/intake/matching/[id]/MatchingClient.tsx) | Live phase machine + countdown. Chat is **NOT** present here today. |
| Dashboard / empty | `/room` | [`RoomClient.tsx`](app/room/RoomClient.tsx) | **The big one — ~2500 lines.** Hosts: sidebar, dashboard empty state, chat thread, summary panel, every customer modal. Routes through internal state, not separate routes. |
| Chat + call room (live) | `/room` (same client, `session` state) | same | |
| Chat + call room (ended/read-only) | `/room?viewing=<id>` | same | `viewingPastId` internal state — **no history push** today. |
| Direct Zoom join page | `/call/[id]` | [`CallClient.tsx`](app/call/[id]/CallClient.tsx) | Standalone Zoom embed surface. |
| Embeddable widgets | `/widget/customer`, `/widget/engineer` | [`CustomerWidgetClient.tsx`](app/widget/customer/CustomerWidgetClient.tsx), [`EngineerWidgetClient.tsx`](app/widget/engineer/EngineerWidgetClient.tsx) | Iframe surfaces. **Treat as separate from main reform — restyle to match but verify iframe sizing constraints.** |

### Staff

| Brief screen | Route | Client | Notes |
|---|---|---|---|
| Staff login | `/staff/login` | [`StaffLoginForm.tsx`](app/staff/login/StaffLoginForm.tsx) | 8-digit OTP code. Today single text input. |
| Engineer onboarding | `/staff/onboarding` | [`EngineerOnboardingClient.tsx`](app/staff/onboarding/EngineerOnboardingClient.tsx) | Engineer profile setup. |
| Dashboard | `/dashboard` *(staff)* | [`DashboardClient.tsx`](app/(staff)/dashboard/DashboardClient.tsx) | Stats + take-next CTA. |
| Inbox (queue) | `/inbox` | [`InboxClient.tsx`](app/(staff)/inbox/InboxClient.tsx) | 3-col `grid-cols-[280px_1fr_320px]`, no responsive collapse. |
| Active engineer session | `/staff/session/[id]` | [`EngineerSessionClient.tsx`](app/staff/session/[id]/EngineerSessionClient.tsx) | Engineer-side mirror of `/room`. Auto-mints Zoom. |
| Supervisor session (read-only) | `/staff/session/[id]` (same client, `isSupervisor` branch) | same | Read-only banner, no end/mute. |
| Supervise board | `/supervise` | [`SuperviseClient.tsx`](app/(staff)/supervise/SuperviseClient.tsx) | All/Waiting/Live/Past tabs, health bars, pod-scoped. |
| Operations (pod) | `/operations` | [`OperationsClient.tsx`](app/(staff)/operations/OperationsClient.tsx) | The pod engineer table. **Pod-allocation seam home.** |
| Enterprise admin | `/enterprise` + `/enterprise/departments` + `/enterprise/supervise` + `/enterprise/wallet` + `/enterprise/v2` | `EnterpriseClient.tsx`, `DepartmentsClient.tsx`, `EnterpriseSuperviseClient.tsx`, `WalletClient.tsx`, `PanelClient.tsx` | Out of brief's §5 but reformed-by-osmosis through shared `StaffShell`. |
| Internal admin | `/admin` + `/admin/users` + `/admin/v2` | `AdminClient.tsx`, `UsersClient.tsx`, `PanelClient.tsx` | Same. [`UIchanges.md`](UIchanges.md) owns the v2 redesign — coordinate. |
| Department panel | `/department`, `/department/v2` | `DepartmentClient.tsx`, `PanelClient.tsx` | Same. |
| Reseller panel | `/reseller`, `/reseller/v2` | `ResellerClient.tsx`, `PanelClient.tsx` | Same. |
| Finance | `/finance` | `FinanceClient.tsx` | Same. |
| Settings (profile/account) | `/settings` | `app/(staff)/settings/page.tsx` | **Profile screen of §5.10.** Today: thin. |

### Legacy / out of scope

| Route | Status | Action |
|---|---|---|
| `/customer`, `/engineer`, `/supervisor` | **Legacy** per [`CLAUDE.md`](CLAUDE.md:71-73). Likely Prisma-stub throwers. | Do not restyle. Flag in `TRANSFORMATION_LOG.md`. |
| `/brand-guidelines`, `/explainer`, `/sitemap-and-content-plan` | Internal marketing aids. | Out of scope. |
| `/`, `/_marketing/*`, `/company/*`, `/for/*`, `/for-enterprise`, `/pricing`, `/product`, `/resources/*`, `/legal/*`, `/trust/*`, `/download` | **Marketing site.** | **Out of scope.** Brief is product UI only. |

### Routes the brief implies but the code does **not** currently expose

- "Ringing engineers" as a separate state with chat. **Today** the
  `MatchingModal` overlays the matching screen (`/intake/matching/[id]`)
  and chat does not exist until the customer lands on `/room` post-match.
  The brief's §5.4 ("chat enabled while ringing") is a **net-new UI shell**
  in this transformation.

---

## C. Shared component inventory (condensed; full table in §C-detail)

Reusable primitives **already shared** (good — keep + extend):

| Name | Path | Notes |
|---|---|---|
| `StaffShell` | [`app/_components/StaffShell.tsx`](app/_components/StaffShell.tsx) | Staff left-nav chrome, profile dropdown, 240↔60 collapse, role-gated nav, incoming-call gate. |
| `ChatComposer` | [`app/_components/ChatComposer.tsx`](app/_components/ChatComposer.tsx) | Textarea + file picker. Used by `RoomClient` and `EngineerSessionClient`. |
| `MeetingChatEntry` | [`app/_components/MeetingChatEntry.tsx`](app/_components/MeetingChatEntry.tsx) | Inline "Zoom call started/ended" chat card with Join button. |
| `MatchingModal` | [`app/_components/MatchingModal.tsx`](app/_components/MatchingModal.tsx) | 4 phases (loading/ringing/no_engineer/accepted). |
| `PaywallModal` | [`app/_components/PaywallModal.tsx`](app/_components/PaywallModal.tsx) | 627 lines, hardcodes its **own** palette (`#5d8a44` brighter green, `#0a0a0a` surface). Disjoint from rest of app per audit. |
| `EngineerIncomingMatch` | [`app/_components/EngineerIncomingMatch.tsx`](app/_components/EngineerIncomingMatch.tsx) | Engineer's "incoming call" full-screen. |
| `ConfirmDialog` | [`app/_components/ConfirmDialog.tsx`](app/_components/ConfirmDialog.tsx) | `useConfirmDialog()` hook. |
| `DataTable` | [`app/_components/DataTable.tsx`](app/_components/DataTable.tsx) | Sortable + paginated + filterable table. |
| `ChipGroup` | [`app/_components/wizard/ChipGroup.tsx`](app/_components/wizard/ChipGroup.tsx) | Single+multi-select chip group. **Already supports multi** — the multi-select fix in §5.2 is a state-cap change, not a new component. |
| `WizardShell` | [`app/_components/wizard/WizardShell.tsx`](app/_components/wizard/WizardShell.tsx) | Intake wizard chrome. |
| `MessageAttachments` | [`app/_components/MessageAttachments.tsx`](app/_components/MessageAttachments.tsx) | Renders message attachments. |
| `MeetingSummaryEntry` | [`app/_components/MeetingSummaryEntry.tsx`](app/_components/MeetingSummaryEntry.tsx) | Inline AI-summary chat card. |
| `PostCallView` | [`app/_components/PostCallView.tsx`](app/_components/PostCallView.tsx) | Engineer post-call summary. |
| admin-v2 primitives | [`app/_components/admin-v2/`](app/_components/admin-v2/) | `Breadcrumb`, `DetailCard`, `Drawer`, `EditNameDrawer`, `FilterTile`, `MinutesBar`, `Sidebar`, `SignOutButton`, `TabsHeader`, `UserChip`. **These are the closest thing to a design system in the repo.** Built per [`UIchanges.md`](UIchanges.md). Will lift the best ones to top-level. |

**Components that do NOT yet exist and need building** (the design-system
layer in §9 step 2):

- `Button` (primary/secondary/ghost/danger/icon) — currently inline `<button>` everywhere.
- `Input`, `Textarea`, `Select` — currently inline.
- `OtpDigitInput` — for staff login + customer first-time code.
- `StatusBadge` — Live/Urgent/Critical/Healthy/At-risk with icon + label.
- `HealthBar` — currently inline in `SuperviseClient`.
- `ChatBubble` (user/engineer/system/assistant) — currently inline in `RoomClient` + `EngineerSessionClient` (duplicated).
- `EmptyState` — currently ad-hoc.
- `SectionHeader`, `Avatar`, `Modal`, `Toolbar` — currently inline / ad-hoc.
- `IntakeAssistant` (§7) — net-new mocked shell.

**Dead / unimported components to delete during reform**:

[`ZoomEmbed.tsx`](app/_components/ZoomEmbed.tsx),
[`ZoomCallCard.tsx`](app/_components/ZoomCallCard.tsx),
[`PopOutContainer.tsx`](app/_components/PopOutContainer.tsx),
[`ZoomJoinCard.tsx`](app/_components/ZoomJoinCard.tsx) — all unimported per
audit. `ZoomEmbed.tsx` contains 11 `console.*` statements.

**Hardcoded-constant duplication to centralize** (audit confirmed):

| Constant | Files | Replace with |
|---|---|---|
| `BRAND_GREEN = "#3f5c2e"` | StaffShell, RoomClient, EngineerSessionClient, ChatComposer, MatchingModal, PaywallModal, ConfirmDialog, DataTable, MeetingChatEntry, EngineerIncomingRequest, EngineerIncomingMatch, ChipGroup, AdminClient, EnterpriseTab, PodsTab (**15+**) | **delete** — repo brand is coral, not olive green. Use `--primary` for CTAs, `--green-dot` for launcher/healthy. |
| `URGENT_AMBER = "#d4a017"` | 6+ files | new token `--warn` |
| `CRIT_RED = "#8b1a1a"` | 6+ files | new token `--risk` |
| PaywallModal palette (`#5d8a44`, `#0a0a0a`, `#141413`) | `PaywallModal.tsx` | unify to repo tokens |
| `rgba(0,0,0,0.55)` / `0.78` / various `color-mix` | many | new token `--scrim` |

---

## D. Data contracts — what must NOT break

(Compiled per the brief's §1 rule "keep that exact data contract.")

### `SignInForm`

- Endpoints: `POST /api/auth/signin-password`, `/api/auth/prepare`,
  `/api/auth/send-otp`, `/api/auth/verify-otp`.
- State enums: `mode: "password" | "otp-email" | "otp-code"`,
  `purpose: "first-time" | "forgot"`.
- OTP code length = 8 chars.

### `StaffLoginForm`

- Same backend shape, staff endpoint. Code length = 8.

### `SetPasswordClient`

- `POST /api/auth/set-password { password, mode }`. `mode` from query
  param `?mode=customer|staff`. Continues to `?continue=` URL on success.

### `IntakeClient`

- Supabase: `auth.getUser()`,
  `client_intakes` (select/upsert/update),
  `rpc("create_project")`,
  `rpc("get_or_create_active_customer_session")`,
  `rpc("cancel_customer_session")`,
  `rpc("match_engineer")`,
  `guest_calls` (select/eq/in).
- **Critical state shape:** `aiTools: string[]` exists in state already
  ([`IntakeClient.tsx:49`](app/intake/IntakeClient.tsx:49)) **but the
  step's advance gate enforces `aiTools.length === 1`**
  ([`IntakeClient.tsx:100`](app/intake/IntakeClient.tsx:100)) and the
  submit writes `ai_tools_used: aiTools[0]` as a **single string** to
  `client_intakes`
  ([`IntakeClient.tsx:165`](app/intake/IntakeClient.tsx:165)). **The DB
  column is a single string** — multi-select fix has a real seam (§G.intake).
- Step-conditional flow: if `familiarity[0] === "Totally Unknown"`, the
  technologies step is skipped (`wantsTechStep` derived,
  [`IntakeClient.tsx:53-55`](app/intake/IntakeClient.tsx:53)).

### `MatchingClient` (`/intake/matching/[id]`)

- Realtime channels on `engineer_match_offers` + `guest_calls` + 1500ms
  polling backstop.
- Phase machine: `loading | ringing | no_engineer | cancelled | accepted`.
- Offer status enum: `pending | accepted | declined | expired`.
- 90-second offer window.
- Terminal state detection redirects to `/room`.
- **The chat composer + thread the brief's §5.4 requires here does not
  exist today** — backend will be untouched, this is new local-state UI.

### `RoomClient`

- Hooks: `useCustomerSession(sessionId)` (returns `{ session, messages,
  status, urgency, … }`), `useSessionTimer(startedAt, freeMinutes)`,
  `useIsSupervisor()`.
- Realtime: `guest_calls` (INSERT/UPDATE filtered by `session_id`),
  `guest_messages` (INSERT/UPDATE/DELETE).
- RPCs: `end_session(session_id, reason)`,
  `mark_joined(user_role)`, `invite_customer_to_zoom(session_id)`,
  edge function `summarize-guest-call`.
- `GuestCall` fields the UI reads: `status` (SessionStatus state machine),
  `assigned_at`, `joined_at`, `free_minutes`, `paid_extension_at`,
  `zoom_meeting_id`, `duration_minutes`, `urgency`.
- `GuestMessage[]` carries metadata for supervisor-only filtering.

### `EngineerSessionClient`

- Same `GuestCall` + `GuestMessage` model.
- Hook: `useEngineerSession(sessionId)` returns `{ session,
  isAssignedEngineer, messages, … }`.
- Edge function: `mint-zoom-for-session`. Auto-fires on engineer landing
  in `assigned|joining|grace` states, **not** for supervisors.
- `mark_joined("engineer")` fires only on Zoom embed `onJoined` callback.
- `isSupervisor` flag locks the chrome to read-only.

### `DashboardClient`

- Hooks: `useRequireEngineerProfile()`, `useEngineerWorkspace()` (returns
  `{ myActive, queue, recent, loading, error, takeNext, claim }`).
- Stats are **derived** in-component from those lists: don't restructure
  the derivation, only restyle the cards.
- Actions: `takeNext()` and `claim(sessionId)` → `router.push("/staff/session/{id}")`.

### `InboxClient`

- Same `useEngineerWorkspace()`.
- Derived: `peopleMap` deduped from `queue ∪ myActive ∪ recent`, sorted
  by latest session.
- Layout state: `peopleSearch`, `selectedKey`.

### `SuperviseClient`

- Realtime: `postgres_changes` on `guest_calls`, **pod-scoped** via
  `pod_id` filter when `useStaffGuard()` is not `super_admin`.
- Reads: `latest_session_health` view (DISTINCT ON session_id) — health
  scores merged onto GuestCall as `SessionWithHealth = GuestCall & {
  health?: HealthSnapshot }`.
- Tab filters use `LIVE_STATES`, `WAITING_STATES` constants.
- `MIN_MESSAGES_FOR_AI = 2` threshold for trusting AI health.
- `UNSCOPED_ROLES = ["super_admin"]` — these see all pods.

### `OperationsClient`

- `GET /api/supervisor/team` → `{ pod: { id, name }, engineers: Engineer[] }`.
- `Engineer = { userId, displayName, email, primaryRole, currentCustomer,
  lastCustomer, lastCallAt }`.
- One fetch on mount, client-side filter on `name | email | currentCustomer`.

### `StaffShell`

- `useStaffGuard()` returns `{ kind, roles[] }`.
- Sidebar collapse persisted at `localStorage["relay.staff.sidebar.collapsed"]`.
- `NAV[]` items are role-gated; `ENGINEER_ONLY_PATHS` triggers redirects;
  `homeHref` computed per role.
- The **buggy** `<ProfileChipInline email={guard.kind === "staff" ? "" : ""} />`
  at [`StaffShell.tsx:277`](app/_components/StaffShell.tsx:277) (both
  branches pass `""`) and the `guardEmail() → ""` helper get **fixed in
  passing** (this is UI-rendering, not data-contract).

---

## E. Per-screen UX problem list

(Folds in [`UI_UX_AUDIT.md`](UI_UX_AUDIT.md). Items below are net-new or
escalated for the transformation.)

### Login / signup (`/login`, `/staff/login`, `/set-password`)

- OTP code is a single `<input>` — the brief explicitly calls for
  **discrete digit boxes** (8 boxes for staff, 8 for first-time customer).
- Placeholder-only labels everywhere. `autoComplete` missing
  (`email`, `one-time-code`, `new-password`).
- No `aria-live` on inline error.
- No "We'll email you a code" helper text — users hit submit then wonder.

### Intake (`/intake`)

- **Required §5.2 fix:** Step 2 (AI tool) is single-select today; needs
  to permit multiple. See §G.intake — has a real seam.
- Left/right panel split is decent but copy is generic; reassuring
  subcopy missing.
- Progress dots exist but aren't "honest segmented" — proposed segments
  per brief.
- Long "Some Other" free-text option not present; out of scope.

### Matching screen (`/intake/matching/[id]`)

- **Modal-on-empty-screen pattern** (the audit calls this out). Brief
  §5.4 requires a **chat composer + thread + AI intake assistant** while
  the customer waits. Today: dead modal.
- Countdown is small + visually weak.
- Cancel is buried.

### Dashboard / empty (`/room` no-session state)

- Inside `RoomClient`. Hero ("Real engineers, ninety seconds away.")
  exists but the primary CTA is **not** dominant — sized like a regular
  button.
- Projects sidebar empty state is a blank list.
- "No summary yet" panel is a blank pane.
- "X min free available" footer block is technically present but
  text-`text-[10px]`-tiny, not reassuring.

### Chat + call room (`/room` live state)

- Call CTA buried — `MeetingChatEntry` Join button is `px-2.5 py-1
  text-[11px]` (~28px high, audit-flagged).
- Three-pane layout exists but proportions feel cramped.
- Chat bubbles user vs engineer styling is subtle — needs stronger
  attribution.
- 153 inline `style={{}}` objects in `RoomClient` (audit). Reform will
  cut these.

### Chat + call room (ended/read-only)

- Read-only banner is plain; needs distinct calm treatment per §5.5.
- "viewingPastId" no browser-history push (audit).

### Summary panel

- Wall-of-gray-text problem. `whitespace-pre-wrap` with no `max-w-prose`.
- "Next steps" rendered as plain text, not a checklist.
- "Zoom call summaries" not collapsible.

### Supervisor — Supervise (`/supervise`)

- Health communicated by color + pulse alone — no icon/label
  alternative. Color-blind + SR users get nothing.
- Tabs are functional but visual hierarchy is flat — counts not on the
  tab labels.
- "Join" CTA on each card not visually obvious.

### Supervisor — Operations (`/operations`)

- Table is a flat list — no zebra/hairline rhythm, search slow, status
  pills inconsistent shape.
- **The pod-allocation seam (§F) lives here.** Today: no per-engineer
  "assigned supervisor" column, no supervisor online/offline indicator,
  no 10-engineer capacity visualization.

### Read-only session view

- Banner is plain; same chrome as engineer-side. Needs the brief's calm
  distinct treatment.

### Profile / account / settings

- `/settings` page is **thin** — just basic profile fields, no plan or
  remaining-minutes section.
- Profile dropdown bug at [`StaffShell.tsx:277`](app/_components/StaffShell.tsx:277).

---

## F. Pod-allocation touchpoints (seam location)

**Current data model:**

- [`supabase/migrations/20260514120000_pods_staff_management.sql`](supabase/migrations/20260514120000_pods_staff_management.sql)
  defines `public.pod_members(user_id UNIQUE, pod_id, pod_role IN
  ('supervisor', 'engineer'))`. **One user → one pod.**
- [`supabase/migrations/20260519100000_guest_calls_pod_scope.sql`](supabase/migrations/20260519100000_guest_calls_pod_scope.sql)
  adds `guest_calls.pod_id`, stamped at `claim_session` RPC from the
  engineer's `pod_members` row.
- RLS policy: pod members can read other rows from their own pod.

**Current UI scoping** (where engineer→supervisor or pod→session is
expressed):

| Surface | File:line | What it does | Data fields read |
|---|---|---|---|
| Operations table | [`OperationsClient.tsx:35-37,108`](app/(staff)/operations/OperationsClient.tsx:35) | Fetches `/api/supervisor/team` → `{pod, engineers[]}`. Columns: name, email, **currentCustomer** ("Currently working with"), last-call. | `Engineer.currentCustomer`, `pod.name`. |
| Operations API | [`app/api/supervisor/team/route.ts:47-93,114-126`](app/api/supervisor/team/route.ts) | Resolves caller's pod (`pod_members.eq(user_id, supervisor).pod_role=supervisor`), lists all engineers in that pod, joins with current `guest_calls.claimed_by IN engineerIds AND status IN LIVE_STATES`. | `pod_members`, `guest_calls`. |
| Supervise board scope | [`SuperviseClient.tsx:131-133,171-172`](app/(staff)/supervise/SuperviseClient.tsx) | `pod_members.select('pod_id').eq('user_id', me)` → `guest_calls.eq('pod_id', podId)`. Super_admins skip the filter. | `pod_id`. |
| Supervise unscoping | [`SuperviseClient.tsx:94-95`](app/(staff)/supervise/SuperviseClient.tsx) | `UNSCOPED_ROLES = ["super_admin"]`. | role string. |
| Admin pods tab | [`app/(staff)/admin/users/PodsTab.tsx:43-44`](app/(staff)/admin/users/PodsTab.tsx) | Shows `supervisors: Member[]` + `engineers: Member[]` per pod — **already two role-sorted arrays** but no engineer→supervisor link. | `pod_role`. |
| Pod members admin | [`app/api/admin/pods/[id]/members/route.ts:46`](app/api/admin/pods/[id]/members/route.ts) | Insert `pod_members { pod_id, user_id, pod_role }`. UNIQUE(user_id). | — |

**Important fact:** the **engineer→supervisor mapping does not exist
today.** Every engineer in a pod is implicitly "the pod's
supervisor's" — and the pod may have multiple supervisors
(`pod_role='supervisor'` is not UNIQUE within a pod). Today's UI treats
the pod as flat. **The 10-threshold rule is genuinely net-new logic.**

**Seam plan (per §6 of brief):**

- Introduce `lib/allocation/podAllocation.ts` with the signatures the
  brief calls for: `getSupervisorForEngineer(engineer, pod, supervisors)`,
  `groupEngineersByPod(...)`.
- Initial impl: **identity / pass-through.** Returns the first supervisor
  in the pod (current behavior). Marked with the `// SEAM:` comment block
  the brief specifies, including the threshold spec.
- UI calls this module from `OperationsClient` and `SuperviseClient` so
  the *layout* already renders an "Assigned supervisor" column and
  groupings. With the pass-through, every engineer shows the same
  supervisor — which matches today's behavior — until the algorithm is
  swapped in later.
- Visual slots:
  - **Operations table** gets:
    - New column "Assigned supervisor" (with avatar + name).
    - Online/offline dot on the supervisor.
    - A subtle capacity meter at the top: `1–10 / 11–15` engineer line, indicating where the next engineer would fall.
  - **Supervise board** gets: a header "Showing sessions for engineers
    assigned to you" + a "(N of M pod engineers)" hint.
- **Source of online/offline state:** none exists today. Two options:
  (a) **mocked** for now (UI shows a "Last seen ≤ 5min = online" rule
  based on `lastCallAt` — already in the API response); (b) document a
  TODO(api) seam to expose `is_online` from a future presence channel.
  **Recommendation: option (a)** — derives from existing data, no new
  contract; if backend wires real presence later, the seam swap is in
  the same module.
- **No threshold math, no preference algorithm implemented** in Phase 2 — just the seam, the column, and the capacity meter.

---

## G. Transformation plan

### Order (per brief §9)

| # | Screen / phase | File(s) | New components introduced |
|---|---|---|---|
| 0 | Branch + report (this doc) | — | — |
| 1 | Design-system layer | `app/_components/ui/*`, extend `globals.css` tokens | `Button`, `Input`, `Textarea`, `Select`, `OtpDigitInput`, `Chip`, `ChipGroup` (refactor), `StatusBadge`, `HealthBar`, `Card`, `Modal`, `Toolbar`, `EmptyState`, `SectionHeader`, `Avatar`, `Tabs`, `Toast`, `Sidebar` (lift from admin-v2), `Drawer` (lift) |
| 2 | Login + signup | `SignInForm.tsx`, `StaffLoginForm.tsx`, `SetPasswordClient.tsx` | + `OtpDigitInput` |
| 3 | Intake | `IntakeClient.tsx`, `WizardShell.tsx`, `ChipGroup.tsx` | + multi-select fix |
| 4 | Dashboard / empty | `RoomClient.tsx` (no-session branch) | + dashboard hero, `EmptyState` |
| 5 | Ringing + chat-while-waiting | `MatchingClient.tsx`, `MatchingModal.tsx`, **new** `IntakeAssistant` shell | + `IntakeAssistant`, `ChatBubble`, `ChatComposer` reused |
| 6 | Chat/call room (live + ended) | `RoomClient.tsx`, `MeetingChatEntry.tsx`, `ChatComposer.tsx` | + giant call CTA, `ChatBubble`, in-call `IntakeAssistant` |
| 7 | Summary panel | `RoomClient.tsx` right rail, `MeetingSummaryEntry.tsx` | scannable summary card |
| 8 | Supervise board | `SuperviseClient.tsx` | + `HealthBar`, `StatusBadge` |
| 9 | Operations + pod-allocation seam | `OperationsClient.tsx`, **new** `lib/allocation/podAllocation.ts` | + supervisor column, capacity meter |
| 10 | Read-only session view | `EngineerSessionClient.tsx` (supervisor branch) | distinct calm read-only treatment |
| 11 | Profile / account / settings | `app/(staff)/settings/page.tsx`, `StaffShell.tsx` profile dropdown | clean layout + fix profile-chip bug |

### Mocked AI shells (§7)

- New file: `lib/intake/intakeAssistant.ts`. Pure data + scripted prompts.
- New component: `app/_components/intake/IntakeAssistant.tsx`. Local
  state only. Renders in two places: ringing screen (§5.4) and inside
  the live call view (§5.5). Same component, different mount points.
- New component: `app/_components/intake/ContextCard.tsx`. The
  "Context for your engineer" summary card.
- Boundary marker: `// TODO(api): replace stub with real assistant
  transport (Anthropic) — keep this interface identical so the UI does
  not change when wired.`

### Token system extension (proposed additions to `globals.css`)

```css
:root {
  /* existing tokens kept verbatim — see globals.css */
  /* additions: */
  --surface-raised: #25241f;       /* elevation above --surface */
  --text-faint:     #777268;       /* below --text-muted */
  --scrim:          rgba(0,0,0,.62); /* unified modal backdrop */

  /* Semantic status — divorced from brand */
  --ok:    var(--green-dot);
  --warn:  #d4a017;   /* lift from hardcoded URGENT_AMBER */
  --risk:  #c84a3a;   /* aligned to --accent-red family */

  /* Aliases the brief asks for */
  --accent:        var(--primary);          /* coral remains the CTA */
  --accent-strong: var(--primary-hover);

  /* Motion */
  --motion-fast: 150ms;
  --motion-med:  240ms;
  --motion-slow: 320ms;
}
```

The brief's `--accent: green` requirement is honored at the **CTA semantic
level** by keeping coral as the primary action color and reserving green
for the launcher + ok-status. This is the surfaced disagreement worth a
short conversation before code (see Open questions).

### Open questions (need answers before Phase 2)

1. **Coral vs green for the primary CTA across the product.** The brief
   says "Relay green as the single decisive accent." Repo says coral.
   I propose: **coral primary, green launcher + healthy.** Approve?
2. **Font swap.** Brief suggests Fraunces/Newsreader (display) + Geist/
   General Sans (UI). Repo already loads Source Serif 4 + Inter via
   next/font and uses them on purpose. Swap, keep, or A/B?
3. **`BRAND_GREEN = "#3f5c2e"` everywhere.** I want to delete it
   entirely and migrate to `--primary` (coral) for CTAs +
   `--green-dot` for launcher. Confirm.
4. **`PaywallModal` palette unification.** It currently runs its own
   `#5d8a44 / #0a0a0a / #141413`. Restyle to the repo tokens — yes/no?
   (This touches the conversion moment; want it explicit.)
5. **Intake AI-tool multi-select submit shape.** UI state already
   supports `string[]`. Three options for §5.2's submit-compat
   constraint:
   - (a) Send `aiTools[0]` as today, silently drop extras. Bad UX, no
     seam disclosure.
   - (b) Send `aiTools.join(", ")` as a single comma-joined string into
     `ai_tools_used`. Preserves DB column. Marked
     `// TODO(api): widen to text[]`.
   - (c) Send the full `string[]` and let the upsert fail loudly.
     Brittle.
   **Recommend (b).** Approve?
6. **Engineer presence for the pod-allocation seam.** Derive
   online/offline from existing `lastCallAt` (≤5min idle = online), or
   wait for a real presence channel? Recommend the derived heuristic
   with `// SEAM:` comment for later swap.
7. **Tests.** No tests reference UI strings today, but Playwright runs
   sequentially with `workers: 1` and shares Supabase state — if any
   spec asserts on a CTA label or modal title, the transformation will
   break it. Should I `grep` and fix in-place, or leave as a follow-up?

---

## C-detail. Component inventory (verbose)

(Trimmed from sub-agent output. The condensed list in §C is the working
set; the full breakdown is preserved here for reference.)

**Buttons** — all ad-hoc inline `<button>` with hardcoded `BRAND_GREEN`
or per-file palette. No shared primary/secondary/ghost/danger variants.
Pagination `PagerButton` exists *inside* `DataTable.tsx` and nowhere
else.

**Inputs** — inline `<input>`, `<textarea>`, `<select>`. Search inputs
duplicated across sidebar, DataTable, drawer forms (10+ files).
`ChatComposer` is the only consolidated textarea pattern.

**Chips** — `ChipGroup` (`app/_components/wizard/ChipGroup.tsx`) is
single+multi capable. Other "chips" (status pills, badge pills, staged
files, user chips) are ad-hoc or scoped to admin-v2.

**Cards** — `DetailCard` (admin-v2), `PlanCard` (inside PaywallModal),
`MeetingChatEntry` (inline Zoom card). Dashboard + finance + operations
cards are ad-hoc per page.

**Sidebars** — `StaffShell` (staff chrome), `Sidebar` (admin-v2 master
list), customer left-nav inside `RoomClient` (260px, manually written —
mirrors StaffShell pattern, duplicated).

**Tables** — `DataTable` is the only shared table. `OperationsClient`
uses an ad-hoc table.

**Modals** — `MatchingModal`, `PaywallModal`, `ConfirmDialog`,
`EngineerIncomingMatch`, `EngineerIncomingRequest` (TEMP-disabled),
`Drawer` (admin-v2). Each rolls its own backdrop + chrome. **None** of
them implement ESC, focus trap, or `role="dialog"` per the audit.

**Toasts** — `SupervisorAlerts` (inside `StaffShell`, the only stack);
inline error banners duplicated across DataTable, ChatComposer,
PaywallModal, PaymentForm.

**Pagination** — only inside `DataTable`. Customer sidebar past-session
list does **no** pagination and pulls 80 rows.

**Empty states** — ad-hoc centered text per page. No shared pattern.

**Tabs** — `TabsHeader` (admin-v2, URL-synced). `RoomClient` Summary /
Chat-history tabs are ad-hoc inline. `EngineerSessionClient` post-call
tabs are ad-hoc inline. `InboxClient` tabs are ad-hoc.

**Drawers** — `Drawer` (admin-v2) is the only one. Used by admin Add /
Edit forms.

---

## Stop point

This is the Phase 1 deliverable. **No code changes will be made
without a green light on §G open questions** — especially #1 (coral vs
green) and #5 (intake submit shape), which materially shape Phase 2.

Awaiting review.
