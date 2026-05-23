# DESIGN_SYSTEM.md

> Phase 2 of the UI transformation. Gallery + rules for the new
> token-driven primitive layer at [`app/_components/ui/`](app/_components/ui/).
> Read this before touching screens in Phase 3+.

---

## Mood — "Calm control room"

Dark-first. Editorial. Reassuring. Fast. A quiet operations desk where
a calm expert is already on the way. Built **from** the existing identity,
not over it.

## Color discipline

| Token | Hex / Source | Meaning | Where it appears |
|---|---|---|---|
| `--background` | `#2c2a26` | Page canvas | `<body>` only. |
| `--surface` | `#1f1e1b` | First card layer | Cards, modals, panels. |
| `--surface-raised` | `#25241f` | Second card layer | Cards on top of cards (e.g. session card inside a Card). |
| `--border` | `#3a3833` | Hairline | All container borders. |
| `--border-strong` | `#4a4842` | Hover / focus hairline | Inputs on focus, hovered cards. |
| `--text` | `#f5f4ee` | Body text | Default. |
| `--text-muted` | `#a6a29b` | Secondary metadata | "X min ago", helper text, captions. |
| `--text-faint` | `#777268` | Tertiary / placeholders | Placeholder text, disabled labels. |
| `--primary` | `#d97757` (Claude coral) | **Primary CTA. One per screen.** | `Button variant="primary"`. |
| `--primary-hover` | `#c66645` | Hover/active for primary CTA | (auto in Button). |
| `--primary-soft` | 14% coral tint | Selected chip background, focus ring | `Chip` active, focus rings. |
| `--green-dot` | `#3dcb7e` | **Launcher dot + healthy/ok status.** Scarce. | `Button variant="launcher"`, focus outlines, `StatusBadge tone="ok"`, `HealthBar` healthy. |
| `--green-soft` | 14% green tint | Healthy backgrounds | `StatusBadge tone="ok"`. |
| `--ok` / `--ok-soft` | = green-dot family | Semantic ok | `StatusBadge`, `HealthBar`. |
| `--warn` / `--warn-soft` | `#d4a017` (amber) | Urgent / shaky | `StatusBadge tone="warn"`, `HealthBar` shaky. |
| `--risk` / `--risk-soft` | `#c84a3a` | Critical / at-risk / destructive | `StatusBadge tone="risk"`, `Button variant="danger"`, `HealthBar` at-risk. |
| `--scrim` | `rgba(0,0,0,.62)` | Modal backdrop | `Modal`. |
| `--accent` | alias → `--primary` | Generic "the brand action color" | Use only where coral is contextually correct. |

### Forbidden

- **No raw hex inside components.** Always reach a token. `color-mix()`
  is fine for tinting.
- **No new green.** The deprecated `BRAND_GREEN = "#3f5c2e"` is going
  away in subsequent phases. Use `--primary` for CTAs, `--green-dot` for
  launcher + healthy.
- **No emoji as icons.** Use Lucide (already a dep) or the built-in
  glyphs in `StatusBadge`.

## Typography

| Family | Token | Use |
|---|---|---|
| Source Serif 4 | `--font-serif` | Page titles, hero headlines, card titles. Editorial moments. |
| Inter | `--font-sans` | All UI text, body, buttons, inputs, labels. |
| JetBrains Mono | `--font-mono` | Code, OTP digits, IDs. |

Scale:

- Hero display: `text-4xl` / `text-5xl`, serif, leading-tight.
- Section title: `text-2xl` / `text-3xl`, serif.
- Card title: `text-xl`, serif.
- Body: `text-[15px]` / `text-base`, sans, line-height ≥1.5.
- Metadata: `text-sm` muted.
- Caption: `text-xs` muted; **never** below 12px in product surfaces.

## Motion

| Token | Duration | Use |
|---|---|---|
| `--motion-fast` | 150ms | Buttons, inputs, hovers. |
| `--motion-med` | 240ms | Modal entry, page reveals. |
| `--motion-slow` | 320ms | Hero/empty-state staggers. |

Living motion (`data-relay-pulse` / `relay-pulse-ok` keyframe) is reserved
for: the launcher CTA, the ringing-state surface, the live call status.
**Never decorative.**

`prefers-reduced-motion` kills every keyframe + clamps transitions to
0.01ms. Verified in `globals.css`.

---

## Primitives

### Button

```tsx
import { Button } from "@/app/_components/ui";

<Button>Start a session</Button>                          {/* primary, md */}
<Button variant="secondary">Cancel</Button>
<Button variant="ghost" size="sm">Refresh</Button>
<Button variant="danger">End session</Button>
<Button variant="launcher" size="xl">Get an engineer now</Button>
<Button loading>Submitting…</Button>
<Button iconLeft={<Plus />}>New project</Button>
<Button full>Sign in</Button>
```

Variants: `primary` (coral, default), `secondary`, `ghost`, `danger`,
`launcher` (green + pulse). Sizes: `sm` `md` (default, 44px) `lg` `xl`.
`md`+ meet the 44×44 touch target.

### Input + Textarea

```tsx
<Input
  label="Email"
  type="email"
  autoComplete="email"
  required
  hint="We'll email you a code."
/>
<Input label="Password" type="password" error="At least 8 characters." />
<Textarea label="What are you building?" rows={4} />
```

`label` is **required** (or use `srLabel` for sr-only). Placeholder ≠
label. `autoComplete` is passed through.

### OtpDigitInput

```tsx
<OtpDigitInput
  length={8}
  value={code}
  onChange={setCode}
  onComplete={handleSubmit}
  hint="We sent an 8-digit code to your email."
  autoFocus
/>
```

Auto-advances on type, retreats on backspace, accepts paste of full
code, numeric keyboard on mobile, fires `onComplete` when full.

### Chip + ChipGroup

```tsx
<ChipGroup
  options={AI_TOOLS}
  value={aiTools}
  onChange={setAiTools}
  multi              // <-- step 2 multi-select fix lands by passing this
  label="AI tools you use"
/>
```

`multi` toggles checkbox semantics. Active state: 14% coral tint + coral
border + small coral dot before the label.

### StatusBadge

```tsx
<StatusBadge tone="ok">Live</StatusBadge>
<StatusBadge tone="warn">Urgent</StatusBadge>
<StatusBadge tone="risk">Critical</StatusBadge>
<StatusBadge tone="info" pulse>Ringing</StatusBadge>
<StatusBadge tone="neutral" compact>Ended</StatusBadge>
```

Every tone carries a glyph (●, ▲, ■, ◆, ○) so meaning is conveyed by
shape + text, not color alone.

### HealthBar

```tsx
<HealthBar score={82} />   {/* Healthy  */}
<HealthBar score={55} />   {/* Shaky    */}
<HealthBar score={28} />   {/* At risk  */}
<HealthBar score={null} /> {/* No signal — fewer than 2 msgs in session */}
```

Renders label + percentage + colored fill. Used on Supervise board cards.

### Card

```tsx
<Card>
  <CardHeader>
    <h3 className="font-serif text-lg">Project memory</h3>
    <Button variant="ghost" size="sm">Edit</Button>
  </CardHeader>
  <CardBody>…</CardBody>
  <CardFooter>
    <Button variant="secondary">Cancel</Button>
    <Button>Save</Button>
  </CardFooter>
</Card>

<Card variant="raised" interactive onClick={…}>{/* session card */}</Card>
<Card variant="hollow">{/* empty-state framing */}</Card>
```

### EmptyState

```tsx
<EmptyState
  icon={<Sparkles />}
  title="Real engineers, ninety seconds away."
  body="A real engineer joins your chat + Zoom in ~90 seconds."
  action={
    <Button variant="launcher" size="xl">Get an engineer now</Button>
  }
/>
```

Used for the dashboard hero, "no projects" sidebar, "no summary yet"
panel, Supervise tab empty states.

### SectionHeader

```tsx
<SectionHeader
  title="Pod GATEWAY-ANGULAR"
  subtitle="Engineers under your watch"
  right={<Button variant="ghost" size="sm">Export</Button>}
/>
```

Display serif on by default. Hairline underline.

### Avatar

```tsx
<Avatar name="Mira Patel" />              {/* "MP" initials */}
<Avatar email="leo@startup.io" size="lg" />
<Avatar name="Jordan" tone="ok" />        {/* online supervisor */}
<Avatar src="https://…/photo.png" name="…" />
```

### Modal

```tsx
const [open, setOpen] = useState(false);

<Modal
  open={open}
  onClose={() => setOpen(false)}
  title="End this session?"
  description="Your engineer will be notified."
  footer={
    <>
      <Button variant="secondary" onClick={() => setOpen(false)}>
        Keep going
      </Button>
      <Button variant="danger" onClick={confirm}>End session</Button>
    </>
  }
>
  Are you sure you want to end the session now?
</Modal>
```

`role="dialog"`, focus-trap, ESC, scrim-click close, body-scroll lock,
focus restored to trigger. **All six audit-flagged modal a11y bugs
solved by this one primitive.** Existing ad-hoc modals get migrated in
their respective phase commits.

### Toolbar

```tsx
<Toolbar>
  <Toolbar.Group>
    <h2 className="font-serif text-xl">Sessions</h2>
  </Toolbar.Group>
  <Toolbar.Spacer />
  <Toolbar.Group>
    <Button variant="ghost">Filter</Button>
    <Toolbar.Divider />
    <Button>New session</Button>
  </Toolbar.Group>
</Toolbar>
```

### Toast

```tsx
<Toast tone="risk" title="Couldn't mint Zoom">
  We'll retry automatically.
</Toast>
<Toast tone="ok" title="Payment received" onClose={() => setShown(false)} />
```

`role="alert"` + `aria-live` set by tone. Fixes the audit's silent-toast
finding.

---

## Patterns

### One primary action per screen

The CTA hierarchy is:

1. **Launcher / green** — for the dashboard hero and the in-room
   "Join Zoom call" button. **At most one per screen.**
2. **Primary / coral** — every other "go" action.
3. **Secondary** — back, cancel-from-here, alternate flow.
4. **Ghost** — toolbars, inline.
5. **Danger** — destructive only (end session, delete).

If two CTAs feel equally important, pick one. The other becomes
secondary.

### Empty / loading / error / default states

Every screen has four states. Designed, never accidental.

- **Default** — what most users see most of the time.
- **Loading** — `Card` skeletons or text shimmers; never spinners on a
  blank pane. Reserve layout space (no CLS).
- **Empty** — `EmptyState` with a helpful next-action.
- **Error** — calm `Toast tone="risk"` or a `Card` with retry; never
  silent.

### Touch / hit-area

- Buttons `md`+ are 44×44 minimum. `sm` (36px) is for dense table-row
  controls; not for primary CTAs.
- Icon-only buttons get an `aria-label`.
- Spacing between adjacent actions: ≥8px (`gap-2`).

### Focus + keyboard

- All focus outlines flow through `:focus-visible` → 2px green-dot
  ring + 2px offset. Globally defined in `globals.css`.
- Modal traps Tab; ESC closes.
- Form fields have real `<label>` (Input/Textarea) or `aria-label`
  (icon buttons).

---

## What lives where

```
app/_components/
├── ui/                     ← new primitive layer (this phase)
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Textarea.tsx
│   ├── OtpDigitInput.tsx
│   ├── Chip.tsx
│   ├── StatusBadge.tsx
│   ├── HealthBar.tsx
│   ├── Card.tsx
│   ├── EmptyState.tsx
│   ├── SectionHeader.tsx
│   ├── Avatar.tsx
│   ├── Modal.tsx
│   ├── Toolbar.tsx
│   ├── Toast.tsx
│   ├── cn.ts
│   └── index.ts
├── admin-v2/               ← admin-panel-specific (lives on)
├── wizard/                 ← intake wizard chrome (will switch to ui/Chip in Phase 3)
├── ChatComposer.tsx        ← keeps its auto-grow textarea; will use ui/Button
├── MeetingChatEntry.tsx    ← will use ui/StatusBadge + ui/Button
├── MatchingModal.tsx       ← will migrate to ui/Modal
├── PaywallModal.tsx        ← will migrate to ui/Modal + ui/Card + tokens
├── ConfirmDialog.tsx       ← will migrate to ui/Modal
├── StaffShell.tsx          ← will use ui/Avatar + ui/Button + ui/StatusBadge
└── …                       ← existing leaves
```

### Imports

```tsx
import {
  Button,
  Input,
  StatusBadge,
  EmptyState,
  Card,
  CardBody,
} from "@/app/_components/ui";
```

---

## Anti-patterns (do NOT do)

| Don't | Do |
|---|---|
| `style={{ background: "#3f5c2e" }}` | `<Button variant="primary">` |
| `<input placeholder="Email" />` | `<Input label="Email" type="email" autoComplete="email" />` |
| `<button className="rounded px-2 py-1 text-[11px] bg-green-700">Join</button>` | `<Button variant="launcher">Join Zoom call</Button>` |
| Color-only status (green dot, no text) | `<StatusBadge tone="ok">Live</StatusBadge>` |
| Ad-hoc modal with no ESC / focus trap | `<Modal open onClose=… title=… footer=…>` |
| `text-[10px]` body | `text-sm` minimum; ≥12px in product surfaces |
| Emoji icons | Lucide / `StatusBadge` glyphs |

---

## Migration checklist (Phase 3+ screens)

When restyling a screen, this is the order of operations:

1. **Identify the one primary action.** Promote to coral primary (or
   green launcher if it's the launcher).
2. **Replace ad-hoc buttons** with `<Button>` variants. Delete any
   `BRAND_GREEN`/`CRIT_RED`/`URGENT_AMBER` constants in that file.
3. **Add real `<label>`** to every input via `<Input>` / `<Textarea>`.
4. **Replace ad-hoc status pills** with `<StatusBadge>`.
5. **Restyle cards** via `<Card>` variants.
6. **Replace empty panes** with `<EmptyState>`.
7. **Migrate modals** to `<Modal>` (gets ESC + focus-trap + scrim for free).
8. **Verify** keyboard nav, focus rings, prefers-reduced-motion,
   responsive breakpoints, 44px touch targets.
9. Log the screen-level deltas in `TRANSFORMATION_LOG.md`.

---

## What this phase did NOT change

- **Zero data contracts touched.** No props, hooks, or queries reshaped.
- **Zero existing components removed.** All ad-hoc components still
  work; they will be migrated in their owning screen's phase commit.
- **No new routes** (the dev-preview is this markdown file, not a
  shipped page).
- **No `BRAND_GREEN` deletions yet** — Phase 3+ will remove them as the
  screens that own them get restyled.

Next phase: §9.2 — **Login + signup** screens (`SignInForm`,
`StaffLoginForm`, `SetPasswordClient`). First call-site for `Button`,
`Input`, `OtpDigitInput`, `Card`, `EmptyState`.
