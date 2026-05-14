# Relay UI/UX Audit

Snapshot of UI/UX issues found in the web app (Next.js 16 + React 19, served via Electron desktop too). Observation-only — no fixes proposed. File references are anchors; line numbers may drift as code evolves.

Severity: 🔴 critical · 🟠 high · 🟡 medium · 🔵 low.

---

## 🔴 Accessibility (CRITICAL)

- **No ESC-to-close on any in-app modal** (ConfirmEndModal, ConnectingModal, EngineerAssignedModal, PaywallModal, EngineerIncomingRequest). All rely on the X button or backdrop click. `RoomClient.tsx:1034`, `:2237`, `:2376`, `EngineerSessionClient.tsx:721`, `PaywallModal.tsx:135`, `EngineerIncomingRequest.tsx:222`.
- **Modals lack `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby`.** Screen readers don't announce modal context.
- **Backdrop click does not dismiss modals** — the fixed `inset-0` overlay has no `onClick`. Combined with the missing ESC, keyboard users get stuck if they tab past the X.
- **No focus trap inside modals.** Tab cycles back to the underlying page; focus is not restored to the trigger on close.
- **Toast errors / success notices have no `role="alert"` / `aria-live`** — SRs never announce "Couldn't mint Zoom", "Payment received", auto-start failures. `RoomClient.tsx:2450/2463`, `EngineerSessionClient.tsx:1181/204-215`, `StaffShell.tsx:580`.
- **Placeholder is used as the only input label** everywhere — sidebar search `RoomClient.tsx:1417`, composer `:2000`, engineer composer `EngineerSessionClient.tsx:965`, project picker `:877`, inbox search `InboxClient.tsx:86`. No `<label>`, no `aria-label`.
- **No skip-link on authenticated app surfaces.** Only marketing has one.
- **"Notifications" Bell in StaffShell is a `<button>` with no handler** — looks interactive, does nothing. `StaffShell.tsx:511-528`.
- **Status communicated by color + pulse alone** — Live / Urgent / Critical / Connecting status dots have no `aria-label` and no text equivalent. Color-blind and SR users get nothing.
- **Engineer timer color carries urgency** (green/amber/red), but the actual time string has no semantic warning. `EngineerSessionClient.tsx:634-644`.

## 🟠 Accessibility (HIGH)

- **Heading hierarchy skips levels** — `h2` "How can we help today?" with no `h1` on `/room`; PostCallView jumps `h2`→`h3`; marketing mixes `h2`/`h3` per section.
- **Hover-discovered "+ inside project" button** in sidebar — `opacity-0 group-hover/proj:opacity-100`. Invisible to touch users (focus state ok). `RoomClient.tsx:1801-1810`.
- **No `aria-expanded` / `aria-haspopup` / `aria-controls`** on ProfileButton dropdown. `StaffShell.tsx:385-422`.
- **Tab pattern (Summary / Chat-history, inbox tabs) doesn't use ARIA `role="tablist"` / `aria-selected`.** `RoomClient.tsx:2082-2110`, `EngineerSessionClient.tsx:1064-1081`, `InboxClient.tsx:55-78`.
- **`--text-muted: #a6a29b` on `--surface: #1f1e1b`** measures ~4.3:1 — marginal AA fail at small sizes. Used heavily for body and metadata.
- **Brand green `#3f5c2e`** ~3.2:1 on cream — acknowledged below AA in `marketing.css:22-29` but still used for emphasis text, not just decoration.
- **Auth inputs missing `autoComplete`** — no `email`, no `one-time-code`. `SignInForm.tsx:128-141`, `:196-212`.

## 🟡 Accessibility (MEDIUM)

- **Pulse animations (`ping`, `relay-pulse`, `engineer-ring`) do not honor `prefers-reduced-motion`.** The reduce-motion CSS block in `globals.css:123-127` only covers `.skip-link`.
- **EngineerIncomingRequest plays a 660Hz oscillator ring with no mute affordance** and no gesture gate on `AudioContext`. `EngineerIncomingRequest.tsx:95-123`.

---

## 🔴 Touch & Interaction (CRITICAL)

- **Sidebar collapse, "New project" (h-5), "+ inside project" (h-6), modal-close X buttons, search clear (12px icon)** — all well under 44×44. `RoomClient.tsx:1391-1399`, `:1474`, `:1805`, `:737`, `:1426-1434`.
- **Composer Send button 36×36 (`h-9 w-9`)** on both customer and engineer sides.
- **Modal close X buttons ~24px target** across every modal.
- **MeetingChatEntry Join button `px-2.5 py-1 text-[11px]`** (~28px) — primary CTA for starting a Zoom call sized smaller than a tag.
- **EngineerSession End-session / Release buttons ~28-30px height.** `EngineerSessionClient.tsx:659-679`.

## 🟠 Touch & Interaction (HIGH)

- **Adjacent actions in FloatingStatus** packed with `gap-2` (status pills next to End-session) — accidental tap risk on mobile, no confirmation.
- **`ProjectAccordion` "+ Start session" only on `group-hover/proj`** — impossible to discover on touch screens.
- **Marketing nav links** rely on `:hover` underline; no touch-feedback, no `:active`.
- **Buttons use `hover:opacity-90` only** — no `:active` / pressed state across both clients.

---

## 🟠 Performance (HIGH)

- **`console.warn` / `console.error` shipping to production** — `RoomClient.tsx:325/334/1191`, `EngineerSessionClient.tsx:110`, `PaywallModal.tsx:575/578`, plus 11 in the dead `ZoomEmbed.tsx`.
- **Multiple `setInterval(…, 1000)` ticks re-render heavy trees** — `ConnectingModal:2254`, engineer FloatingStatus buffer countdown (`EngineerSessionClient.tsx:522-527`), `WalletBalance` ticks unconditionally even when collapsed.
- **3 separate Supabase Realtime channels per staff page load** — `EngineerIncomingRequest`, `NotificationBell`, `SupervisorAlerts` all subscribed to `guest_calls`.
- **Sidebar past-sessions list pulls 80 rows and renders all of them** — not virtualized. Engineer side pulls 20. `RoomClient.tsx:1178-1218`, `EngineerSessionClient.tsx:280`.
- **Sidebar query re-runs on every status flip during a live session.** `RoomClient.tsx:1163-1220`.
- **`h-screen` / `w-screen` used instead of `dvh`** — composer disappears behind iOS keyboard, sticky chrome clipped on address-bar collapse. `RoomClient.tsx:443`, `EngineerSessionClient.tsx:183`, `CallClient.tsx:58`.

## 🟡 Performance (MEDIUM)

- **Stripe `loadStripe` runs at module import** — ~200KB JS pulled even before paywall opens.
- **153 inline `style={{}}` objects in RoomClient alone** — regenerate every render, no prop-equality memo wins.

---

## 🟠 Style consistency (HIGH)

- **Hardcoded hex constants duplicated across 8+ files** — `BRAND_GREEN = "#3f5c2e"` lives in RoomClient, EngineerSessionClient, MeetingChatEntry, EngineerIncomingRequest, StaffShell, PaywallModal, InboxClient, PostCallView. `globals.css` has no `--brand-green` token.
- **PaywallModal uses a completely different palette** — `#5d8a44` brighter green, `#0a0a0a` surface, `#141413` card. Visually disjoint from the rest of the app's `#1f1e1b`/`#3f5c2e` warmer dark. Hits at the moment of conversion.
- **Mixed backdrop opacities** — `rgba(0,0,0,0.55)`, `rgba(0,0,0,0.78)`, various `color-mix(...)`. No unified token.
- **Border-radius scale inconsistent** — `rounded-md`/`lg`/`xl`/`2xl`/`full` plus inline `borderRadius: 4|8|12|14`. Same button shape varies by surface.
- **Pill button shape inconsistent** — Send is `rounded-xl`, End/Cancel/Recharge are `rounded-full`, tabs `rounded-full`, MeetingChatEntry Join is `rounded-lg`.
- **System chat messages use emoji as icons** — "📞 Zoom meeting started" / "ended" emitted by Supabase edge functions. Renders inconsistently per platform, can't be themed.
- **PaywallModal hardcodes its own font stack** for Stripe Appearance instead of `var(--font-inter)`.

## 🟡 Style consistency (MEDIUM)

- **Plain `→` character used as icon** in summary next-steps, project chevrons, post-call view. Non-vector, vertical alignment drifts.
- **Visited-link styles never declared.** Footer/login links look identical before and after click.

---

## 🟠 Layout & Responsive (HIGH)

- **Sidebar fixed at `w-[260px]`** with no mobile drawer — chat squeezes on narrow viewports. Same for engineer sidebar (`w-14`/`w-[260px]`) and StaffShell (`SIDEBAR_OPEN_W = 240`).
- **InboxClient uses 3-column grid `grid-cols-[280px_1fr_320px]`** with no responsive collapse — unusable below ~900px.
- **PaywallModal `max-w-5xl` 3-card grid** very cramped at tablet width; mobile stacks but desktop padding still applied.
- **No safe-area-inset handling.** `pb-6` on composer ignores iOS bottom bar / home indicator. `viewport-fit=cover` missing in `app/layout.tsx:120-127` so `env(safe-area-inset-*)` wouldn't apply anyway.

---

## 🟡 Typography & Color (MEDIUM)

- **Body text under 12px in many places** — `text-[10px]` (40+ occurrences in RoomClient), `text-[9px]` on count badges, `text-[11px]` on metadata. Mobile body should be ≥16px.
- **Interactive button text uses `var(--text-muted)`** (e.g. Decline button in EngineerIncomingRequest) — muted is for non-interactive metadata only.
- **No measure cap on long summaries** — `whitespace-pre-wrap` with no `max-w-prose`. Lines run 700+ chars at wide split.
- **Login form OTP toggles `borderColor` via JS `onFocus`/`onBlur`** — fights the `:focus-visible` CSS rule.
- **StaffShell profile avatar uses soft green, RoomClient uses solid green** — same idea, two different fills.

---

## 🟡 Animation (MEDIUM)

- **Pulse keyframes don't honor reduced-motion** — `ping`, `relay-pulse`, `engineer-ring`.
- **StaffShell sidebar animates `width`** — layout reflow every frame instead of using `transform`.
- **ChevronRight rotates but accordion height jumps** — no transition on open/close. `RoomClient.tsx:1779/1814`.

---

## 🟠 Forms & Feedback (HIGH)

- **Send button enabled while RPC is in flight** — rapid Enter could create duplicate sessions / messages. `RoomClient.tsx:1895-1914`, `EngineerSessionClient.tsx:790-795`.
- **No "unsaved changes" warning** when closing project picker mid-typing.
- **Login OTP** silently strips non-digits — no hint that pasting hyphens/spaces is OK.
- **Email validation falls through to browser native** — wrong format yields generic "Couldn't verify code".
- **Toast timeouts inconsistent** — 5s, 6s, 6s, and the generic ErrorToast never auto-dismisses.
- **PaywallModal click-spam across plan rows** interleaves multiple loaders; `setBusyPlan` only tracks one.

---

## 🟠 Navigation Patterns (HIGH)

- **No history integration on viewing past sessions** — `setViewingPastId(id)` doesn't push state. Browser back exits the app instead of closing the review pane.
- **No "Back" affordance from `/room` to marketing site** — Wordmark in sidebar is not a link. Yet `StaffShell` wordmark IS linked. Inconsistent.
- **Past-session sidebar scroll position lost** when navigating back from a session.
- **Engineer redirected to `/inbox` after 3s of `ended`** — can't review summary before being yanked away.
- **PaywallModal CTAs use `window.location.href = "mailto:…"`** — navigates the page, freezes some in-app browsers.
- **No keyboard shortcuts surface** (`?` for help, `Cmd+K` palette) despite the claude.ai-style layout.

---

## Charts & Data

No issues found. (No charts in the audited surfaces.)

---

## Cross-cutting

- **Dead code files** — `ZoomEmbed.tsx`, `ZoomCallCard.tsx`, `PopOutContainer.tsx`, `ZoomJoinCard.tsx` all unimported. ZoomEmbed contains 11 `console.*` statements.
- **Hardcoded LAN IP in dev script** — `"dev": "next dev --experimental-https -H 10.0.1.207"` in `package.json:7`.
- **"Test card 4242 4242 4242 4242" hint in production paywall HTML.** `PaywallModal.tsx:313-314`.
- **Stale comments** referencing removed `useConnectingModalGate`, `IncomingCallModal`, `ZoomEmbed` in RoomClient.
- **Likely bug** — `StaffShell.tsx:277` `<ProfileChipInline email={guard.kind === "staff" ? "" : ""} />` — both branches pass empty string; chip never renders.
- **`guardEmail()` always returns `""`** in StaffShell — dead helper.

---

## Top 10 most impactful fixes

1. **No ESC + no focus trap + no `role="dialog"` on any modal** — single highest-impact a11y problem; affects every modal across the app.
2. **All touch targets ≤36px** — composer Send, modal close, sidebar icons, MeetingChatEntry Join. Foundational ergonomics issue.
3. **Toast errors have no `aria-live` / `role="alert"`** — SR users never hear failures.
4. **PaywallModal is a visually disjoint dark island** (different green, different surface) at the moment of conversion.
5. **`h-screen`/`w-screen` instead of `dvh`** — composer hidden behind iOS keyboard; sticky chrome clipped.
6. **Status conveyed by color + pulse alone** — no text equivalent for color-blind / SR users.
7. **Hardcoded LAN IP in dev script + "Test card 4242…" hint shipping to production** — both signal "not production-ready" to anyone touching the codebase.
8. **Un-virtualized sidebar past-sessions + refetch on every status flip during a live session** — wasteful and laggy as accounts age.
9. **No browser-history on `viewingPastId`** — back button exits app instead of closing the review pane.
10. **Placeholder-only labels across every input** + no `autoComplete` attributes on auth — fails AA, breaks autofill on iOS/Android.
