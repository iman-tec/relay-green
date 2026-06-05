# RESPONSIVE_HOME_PLAN — /room home dashboard

Scope: **one page** — the no-session home/dashboard rendered by
`app/room/RoomClient.tsx` (Sidebar · center hero `BrandedLanding` · right
`ChatPanelStub` · header strip `CenterHeaderActions`). Responsiveness-only;
desktop ≥1024px pixel-unchanged.

## What exploration found (current reality)

| Region                   | File / lines                                | Current behavior                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page shell               | `RoomClient.tsx` ~1984                      | `flex h-screen w-screen overflow-hidden`; Sidebar is a plain flex child **outside** the `PanelGroup`; center is `Panel id="room-main"`                                                                                                                                      |
| Sidebar                  | `Sidebar` (~7100+)                          | **Visible at every width** (squeezes the hero on phones). Has its own collapse-to-48px icon rail. ⚠️ History: a below-md hamburger drawer existed and was **removed** ("source of the click error") — the new drawer must reuse the proven overlay plumbing, not re-roll it |
| Chat rail                | `ChatPanelStub` aside                       | `hidden md:flex` on its own `<aside>`; on `<md` there's a FAB (bottom-right, `md:hidden`) + slide-up **bottom sheet** that force-mounts the stub via `[&>aside]:!flex`                                                                                                      |
| Header strip             | `CenterHeaderActions` (~2820)               | `absolute top-3 right-4` inside the hero: labeled pills (Scheduled/Contracts + count) + bell. No hamburger, no chat icon                                                                                                                                                    |
| Hero                     | `BrandedLanding`                            | Wordmark `size="xl"`, 24px tagline, HOW RELAY WORKS button. No fluid scaling                                                                                                                                                                                                |
| Call-button hover-reveal | `ProjectAccordion` row                      | `group-hover/projrow` + `opacity-0` — **width-agnostic but pointer-blind** (touch devices never reveal)                                                                                                                                                                     |
| Styling system           | Tailwind **v4** + CSS vars in `globals.css` | Default breakpoints (sm 640 / md 768 / lg 1024) — matches the spec's 640/1024 exactly. z-index tokens exist: `--z-drawer`, `--z-modal`, `--z-toast`                                                                                                                         |
| Reusable a11y overlay    | `lib/relay/useOverlayDismiss.ts`            | Body-scroll lock + focus trap + Esc + focus restore — exactly the drawer requirements                                                                                                                                                                                       |

## Implementation checklist

### 1. Breakpoint gate (no double-mount)

- [ ] Add a tiny `useIsDesktop()` hook (`matchMedia("(min-width:1024px)")`).
      JS-gated rendering (not CSS hiding) so the **stateful** Sidebar/Chat
      never mount twice (duplicate Supabase subscriptions/drafts otherwise).
      Safe from hydration mismatch: RoomClient already renders nothing until
      `initialLoadDone` (client-side), so the media query is resolved by
      first paint.

### 2. Sidebar → left drawer (<1024)

- [ ] ≥1024: unchanged inline render. <1024: same `<Sidebar …/>` element
      moves into an off-canvas panel: `fixed inset-y-0 left-0
    w-[min(85vw,320px)] z-[var(--z-drawer)]`, dimmed backdrop, slide-in
      (≈200ms; instant under `prefers-reduced-motion`).
- [ ] `role="dialog"` `aria-label="Projects"`, `useOverlayDismiss` for
      focus-trap/Esc/scroll-lock/restore; backdrop tap + × close;
      swipe-left close (pointer-delta, reusing the bottom-sheet's drag
      pattern).
- [ ] Closes on project select / view-past / Home. **Stays open** when a
      Sidebar-owned modal opens (ConnectFlowModal, ScheduleEngineerModal
      mount inside Sidebar — closing the drawer would unmount them mid-flow;
      they're full-screen overlays anyway).
- [ ] Hamburger button top-left of the center column (<1024 only, ≥44×44,
      `aria-label="Open projects"`); focus returns to it on close.

### 3. Chat → right drawer (<1024)

- [ ] Replace the `<md` FAB + bottom sheet with a right drawer driven by a
      header **chat icon** (with the stub's unread/connect dot if present):
      `w-[min(95vw,420px)]` mobile, `sm:w-[380px]` tablet, `h-dvh`,
      `[&>aside]:!flex` force-mount (existing proven technique).
- [ ] Same overlay rules via `useOverlayDismiss`; swipe-right close.
- [ ] **One drawer at a time**: single `openDrawer: "sidebar" | "chat" | null`
      state.
- [ ] Composer: container `h-dvh` + `pb-[env(safe-area-inset-bottom)]`;
      textarea ≥16px font on mobile (prevents iOS zoom); keyboard-aware
      height (VisualViewport — port from the existing bottom sheet).

### 4. Header condense

- [ ] ≥1024: untouched (labeled pills + bell).
- [ ] 640–1023: pill labels hidden (`hidden lg:inline`) → icon + count
      badge, `aria-label`/`title` keep the names; hamburger left, chat icon
      right.
- [ ] <640: icon-only row — hamburger · Scheduled · Contracts · bell · chat;
      `flex-nowrap`, `min-w-0`, no wrap/h-scroll at 320px. All icons ≥44×44
      below lg.

### 5. Hero fluid sizing

- [ ] Tagline `text-lg sm:text-2xl`; Wordmark responsive size; paddings
      `px-4 sm:px-6`; HOW RELAY WORKS ≥44px tall; `overflow-wrap:anywhere`
      on the customer-summary block. Nothing removed or recolored.

### 6. Touch-capability call buttons

- [ ] `globals.css`: `@media (hover: none)` rule forcing the project-row
      action cluster visible (`opacity:1; pointer-events:auto`) — gated on
      pointer capability, **not width**; desktop hover-reveal untouched on
      fine pointers. Touch targets ≥44px via padding bump under the same
      media query.

### 7. Hygiene

- [ ] `min-w-0` on truncating flex children (project names, user chip, chat
      header) — audit, most already have it.
- [ ] `env(safe-area-inset-*)` on header strip + drawers + composer.
- [ ] z-order: backdrop/drawer (`--z-drawer`) > header > content; toasts at
      `--z-toast` (already above content, below modals).
- [ ] Drawer animations behind `prefers-reduced-motion`.
- [ ] Chat empty state + loading state reflow (they inherit the drawer
      width; verify no overflow).

## Explicitly out of scope

- Any other route/page; the in-session room layout (call open), supervise,
  inbox, marketing pages.
- Any color/copy/font/layout change at ≥1024px.
- New dependencies (drawers = existing `useOverlayDismiss` + Tailwind).

## Verification (evidence required)

- [x] Typecheck: `node ./node_modules/typescript/bin/tsc --noEmit` → **exit 0**.
- [x] Prettier: `npm run format` applied repo-wide.
- [x] Lint: `npx eslint app/room/RoomClient.tsx …` → 74 problems, **all
      pre-existing patterns** (`react-hooks/set-state-in-effect` etc. across
      the legacy file; repo-wide lint has 246 errors that predate this task
      — the repo has never been lint-clean). No new rule classes introduced.
- [x] `npm run build` → **exit 0** (all routes compiled).
- [ ] Widths 320 / 375 / 768 / 1024 / 1440 / 1920:
      Playwright screenshots if an authed storageState is available from
      `tests/`; otherwise DevTools screenshots, plus
      `document.documentElement.scrollWidth <= clientWidth` asserted at 320.
- [ ] Drawer matrix: open/close via button, backdrop, Esc, swipe; exclusivity;
      focus trap + restore; body scroll locked.
- [ ] ≥1024 diff check: before/after screenshots at 1440 — identical.

## Implementation status (2026-06-05)

All of sections 1–7 are implemented on `feature/sup-sentiment`:

| Piece | Where |
|---|---|
| `useIsDesktop()` | `lib/relay/useIsDesktop.ts` |
| Drawer state (closed by default, exclusive, desktop-reset) | `RoomClient` `openDrawer` |
| Sidebar left drawer + scrim + floating × + swipe-left + Esc/focus-trap | `RoomClient` sidebar wrapper + `useOverlayDismiss` |
| Chat right drawer (keyboard-aware VisualViewport, safe-area, swipe-right) | `RoomClient` (replaces FAB + bottom sheet) |
| Sidebar-owned modals portaled to `<body>` (work while drawer closed) | Quote / ConnectFlow / Schedule renders |
| Header condense: labels `hidden lg:inline`, ≥44px targets, hamburger + chat icon | `HeaderPill` / `HeaderHamburger` / `CenterHeaderActions` |
| Hero fluid tagline + ≥44px explainer button | `BrandedLanding` |
| Touch-visible row actions via `@media (hover: none)` | `globals.css` `.projrow-actions` |
| Drawer keyframes behind `motion-safe:` | `globals.css` |
| Composer ≥16px below lg (`lg:text-[13px]`) | `ChatPanelStub` textarea |

**Manual visual checks remaining** (the page is auth-gated, so automated
screenshots need your signed-in session — DevTools device toolbar):

1. At 320/375/768: hero centered, no h-scroll —
   `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
   in the console must be `true`.
2. Hamburger → sidebar drawer; chat icon → chat drawer; opening one closes
   the other; backdrop/Esc/swipe/× all dismiss; picking a project dismisses.
3. At 1024/1440/1920: three columns identical to before (pills labeled,
   no hamburger, no chat icon).
4. Focus a textarea in the chat drawer on a phone: composer stays above the
   keyboard; no zoom-on-focus on iOS.

## Open questions (answer before/while implementing)

1. The FAB + bottom sheet on `<md` gets **replaced** by the right drawer +
   header chat icon — confirm you're OK retiring the bottom-sheet UX.
2. On `<640`, if 5 header icons + wordmark are still tight at 320px, the
   spec allows moving Scheduled+Contracts into an overflow "⋯" — I'll do
   that only if measurement shows wrap at 320px.
