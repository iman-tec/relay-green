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

### Notes for Phase 4 (Intake)

- `IntakeClient.tsx` — apply the **§5.2 multi-select fix**:
  - Lift the gate `aiTools.length === 1` →
    `aiTools.length >= 1`.
  - Submit shape: `ai_tools_used: aiTools.join(", ")` (preserves the
    existing `text` column). Add `// TODO(api): widen ai_tools_used to
    text[]` next to the submit.
  - Pass `multi` to the new `<ChipGroup>` for step 2 only.
- Restyle the wizard chrome (left editorial panel + right answers).
- Replace `wizard/ChipGroup.tsx` callers with `ui/ChipGroup`.
