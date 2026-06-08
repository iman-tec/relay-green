# Partner login: headline wrap + espresso toggle — Phase 0 note

Two presentational fixes on `/partner`. No logic / money / schema.

## 1. Hero headline wraps badly — cause
- `app/partner/page.tsx:24-30` — the headline `<p>` carries **`max-w-[15ch]`**
  (15 characters) at `font-serif text-[25px]`. 15ch is far too narrow for the
  ~76-char line, so it's forced into 3–4-word ragged lines with an orphan
  ("margin."). No `text-wrap` control.
- **Fix:** widen the measure (`max-w-[24ch]`), add `text-balance`
  (`text-wrap: balance`) for even lines + no orphan, and keep the tail together
  with non-breaking spaces (`on&nbsp;your&nbsp;margin.`). Copy unchanged.
- Scope: the headline lives in the local `PartnerProof` component in
  `partner/page.tsx` — **not shared**. Other login surfaces (`/login`, `/staff`,
  `/business`) pass no `aside` to `SurfaceLoginPage`, so they have no such
  headline. Single-surface fix.

## 2. Espresso missing from the toggle — cause
- The bottom-right control is the global **`FloatingThemeToggle`**
  (`app/layout.tsx:166`), which renders the **2-state `ThemeToggle`**
  (`ThemeToggle.tsx` — `toggleTheme` flips light↔dark only). Espresso is never
  reachable from it.
- Espresso IS fully wired app-wide: `ThemeProvider` supports the `espresso`
  theme and `ThemeTriplet` (Sun/Moon/Coffee, `ThemeTriplet.tsx`) sets it; used
  in the room sidebar + account menus. The login surface uses the themed
  `var(--surface/background/text/...)` tokens (not the fixed marketing
  `.mk-root`), so espresso tokens DO apply to both the sign-in card and the
  aside — only the toggle was the gap.
- **Fix:** swap `ThemeToggle` → the shared `ThemeTriplet` inside
  `FloatingThemeToggle` so all three themes are reachable and it can't drift
  again. This is global — the floating toggle also appears on `/business`,
  `/account`, `/intake`, `/set-password` (it's hidden on staff, marketing,
  `/room`, `/login`, which have their own triplet/picker) — so those gain
  espresso too, consistently. Low-risk: `ThemeTriplet` is the established shared
  control.

## Regression
- Headline: balanced lines, no mid-phrase break, no orphan, across widths; copy
  identical.
- Toggle: light/dark/espresso all reachable + applied to both halves; matches
  the rest of the app.
- No change to sign-in, the video, or apply/contact links.
