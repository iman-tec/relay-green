# Relay.green — Onboarding / KT for Claude Code

> Read this first, then `CLAUDE.md` and `AGENTS.md`. This is the A‑to‑Z context
> a new developer (and their Claude) needs to be productive and **not break
> production**. When this doc and the spec docs disagree, the spec closeout
> (`docs/RelayGreen_Spec_Decisions_v1.md`) wins for product behavior; this doc
> wins for "how the codebase actually works today."

---

## 1. What Relay.green is

An **on‑demand engineering support platform**. A customer describes a problem,
the system **matches** them to an available engineer, they chat and then jump on
a **Zoom call**; sessions are **timed and billed** (a free trial, then paid
credits / enterprise pools). **Supervisors** monitor live sessions and can
manually (re)assign engineers. There's a **marketing/landing site** in front of
the app, plus **enterprise / reseller / department** billing hierarchies.

Five role surfaces:

| Role | Primary route | Notes |
| --- | --- | --- |
| Customer | `/room` | live engagement surface (legacy: `/customer`) |
| Engineer | `/staff/session/[id]`, `/inbox`, `/dashboard` | session + queue |
| Supervisor | `/supervise` | live monitoring + manual assign |
| Enterprise / Department admin | `/enterprise`, `/department`, `*/v2` | org wallet, usage |
| Internal admin (super_admin) | `/admin/v2`, `/supervise` | cross‑tenant ops |

---

## 2. Tech stack & versions

- **Next.js 16.2.6** (App Router) — see §3 gotchas; conventions differ from
  older Next.
- **React 19.2.4**, **Tailwind v4**, **TypeScript**.
- **Supabase** = the real backend: Postgres + Auth + Realtime + Storage + **Edge
  Functions** (Deno). Accessed via `@supabase/supabase-js` + `@supabase/ssr`.
- **shadcn/ui** components; Prettier sorts Tailwind classes.
- **Stripe** for payments (server‑side lives only in edge functions).
- **Zoom Video/Meeting SDK** for calls.
- **OpenAI** (gpt‑4o‑mini) for session summaries + sentiment.
- **Prisma** is present but **NOT wired at runtime** — documentation only (§6).

Fonts: Source Serif 4 (display/body), Inter (UI), JetBrains Mono (code). Don't
reintroduce Fraunces / Instrument Sans.

---

## 3. The things that will bite you (read before coding)

1. **`npm run typecheck` is broken.** A bogus `tsc@2.0.4` shadows the real
   compiler. Use:
   ```bash
   node_modules/typescript/bin/tsc --noEmit
   ```
   `npm run verify` is affected too — typecheck manually.
2. **Supabase is the database, not Prisma.** `lib/db.ts` is a Proxy that
   *throws* `"Prisma is no longer wired in this app"` if any runtime code path
   calls it. If you see that error you're on a legacy page — rewrite against
   Supabase. `prisma/schema.prisma` is a **canonical data‑model document**, kept
   in sync with the architecture doc, but never executed at runtime.
3. **Next.js 16, not the one in your training data.** `proxy.ts` (repo root)
   **replaces** `middleware.ts`. Read `node_modules/next/dist/docs/` before
   touching routing/middleware/fonts/image/build config and heed deprecations.
4. **Dev server binds to a LAN IP**, not localhost: `https://10.0.1.207:3000`
   (set in `package.json`, with experimental HTTPS). Playwright's `baseURL` and
   `allowedDevOrigins` in `next.config.ts` match. **If your LAN IP differs you
   must update all three.**
5. **`reactStrictMode: false` on purpose** — the Zoom Video SDK uses singleton
   `window` state and breaks under StrictMode's double‑invoke. Don't flip it on.
6. **Migrations are applied out‑of‑band** (Management API / `supabase db push`),
   so the `supabase/migrations/` folder can drift from what's actually in the DB.
   See §11. (Known drift today: `20260523120000_faster_sequential_ring.sql` is
   committed but was **never applied**.)

---

## 4. Getting started

```bash
npm install

# Dev (https://10.0.1.207:3000 — change the IP in package.json if yours differs)
npm run dev

npm run build          # production build (good full-repo sanity check)
npm run lint
node_modules/typescript/bin/tsc --noEmit   # typecheck (NOT `npm run typecheck`)
npm run format         # prettier --write

# Local docker Postgres — ONLY for applying Prisma migrations as a schema
# reference. NOT used by the running app.
npm run db:up / db:down / db:migrate / db:seed

# Playwright (no npm script)
npx playwright test
```

You need `.env.local` (see §12) with the Supabase URL + keys, and the Supabase
project must have the edge‑function secrets set in its dashboard. Ask the
handing‑over owner for these — they are **not** in the repo.

---

## 5. Repo layout

```
app/
  page.tsx, layout.tsx, globals.css   # root landing + app shell + design tokens
  _marketing/                         # marketing site components (Nav, Footer, Home, Shell, marketing.css)
  (staff)/                            # post-login staff app (admin, supervise, enterprise, reseller, department, dashboard, inbox, finance, operations)
  staff/                              # /staff/login, /staff/session/[id], /staff/onboarding
  room/                               # customer live session surface
  intake/                            # customer intake + matching screen
  account/                           # customer profile + wallet
  call/, set-password/, widget/, auth/
  login/                             # CUSTOMER magic-link login
  api/                               # only `me` and `whoami` — almost everything server-side is an edge fn
  pricing|product|company|trust|legal|for|for-enterprise|explainer|brand-guidelines|resources|...  # marketing pages
  _components/                       # shared UI (StaffShell, PaywallModal, ZoomCall, theme, etc.)
lib/
  supabase/   # browser + server clients, hand-rolled types.ts (mirror migrations)
  relay/      # session hooks (useCustomerSession, useEngineerSession, useSessionTimer),
              # sessionClock.ts (billing source of truth), roles, useStaffGuard, useIsSupervisor, pricing
  billing/, stripe/, seo/, auth*.ts
proxy.ts      # edge proxy: Supabase JWT refresh + route protection (replaces middleware.ts)
supabase/
  migrations/ # 101 SQL migrations — authoritative for the live DB
  functions/  # 20 Deno edge functions
prisma/       # schema.prisma = DOCUMENTATION ONLY (not wired)
docs/         # product + architecture specs (read order in §14)
scripts/      # wipe-and-seed-admin.sh (DANGER — see §16)
```

---

## 6. Persistence: Supabase, not Prisma (most important architectural point)

- The live app uses **Supabase**. Browser/server clients are in `lib/supabase/`.
  Server components use `lib/supabase/server.ts`; client components use
  `lib/supabase/browser.ts`.
- `lib/supabase/types.ts` is **hand‑rolled** to mirror the migrations. When you
  add a column, update this file too.
- Authoritative schema = `supabase/migrations/`. `prisma/schema.prisma` is a
  synced design doc; **do not** rely on Prisma at runtime.
- Most tables have **Row Level Security**. Notable: `guest_calls` SELECT is
  `USING (true)` (any authed/anon can read by id — the id is the unguessable
  token), and `can_access_chat_session()` grants supervisor‑tier full read. So
  pod/coverage scoping is enforced in **queries + RPCs**, not RLS, for sessions.

---

## 7. Auth, roles, and the proxy

Two **separate** login surfaces; `proxy.ts` enforces the split:

- **`/login`** — customer magic‑link. Protects `/room/*` (`CUSTOMER_PREFIXES`).
- **`/staff/login`** — staff 8‑digit OTP. Protects `/dashboard`, `/inbox`,
  `/triage`, `/supervise`, `/admin`, `/enterprise`, `/staff/session`
  (`STAFF_PREFIXES`).

An unauthed hit on a protected route bounces to the matching login surface.
`proxy.ts` is only the **fast edge layer** — real authorization is server‑side
(role checks, RLS, SECURITY DEFINER RPCs) and client‑side via
`lib/relay/useStaffGuard.ts` / `useIsSupervisor.ts`.

**Roles** live in `user_roles.role_id` (FK to a `roles` lookup table) — there is
**no `role` text column** on `user_roles` (a common trap). Read role names via
the `user_role_names` view or the `has_role(uuid, text)` helper, which also
aliases legacy names (`pod_lead`→supervisor, `admin`→enterprise_admin,
`ops_manager`→department_admin). Roles: `customer`, `engineer`, `supervisor`,
`enterprise_admin`, `department_admin`, `reseller`, `super_admin` (+ legacy
aliases).

`lib/auth.ts` is a **demo‑only** placeholder cookie scheme — not for production.

---

## 8. Edge functions (`supabase/functions/`, Deno)

Long‑lived / secret‑bearing work runs here, **not** in `app/api/`. Deploy with
`supabase functions deploy <name> --project-ref <ref>` (CLI must be logged in).

| Function | Purpose |
| --- | --- |
| `start-guest-call` | create a guest session |
| `mint-zoom-for-session` | create a Zoom registration meeting; register engineer (alias), customer, and an anonymous **supervisor observer**; store join URLs on `guest_calls` |
| `create-zoom-meeting`, `restart-guest-zoom`, `end-zoom-meeting` | Zoom lifecycle |
| `zoom-sdk-signature` | mints the Meeting SDK JWT signature (+ zak for host) |
| `zoom-webhook` | Zoom events (recording/summary land here, post‑call) |
| `summarize-guest-call` | end‑of‑session OpenAI summary + sentiment (guards against empty/trivial sessions) |
| `summarize-intake`, `summarize-customer`, `summarize-project`, `regenerate-guest-brief` | rolling AI summaries up the hierarchy |
| `score-session-health` | per‑window sentiment for the supervise health bar |
| `create-guest-checkout`, `create-relay-checkout`, `create-credits-checkout`, `create-enterprise-checkout` | Stripe checkout (the app's purchase flow — **embedded**, auth‑gated; see `PaywallModal`) |
| `relay-stripe-webhook`, `payments-webhook`, `credit-relay-payment` | Stripe webhooks + wallet crediting |

> The Next `app/api/` has only `me` and `whoami`. There is **no** `/api/checkout`
> or `/api/contact` in this repo — purchases go through the edge functions +
> `PaywallModal`. (The marketing site's forms reflect this — see §13.)

---

## 9. Domain model — key tables

- **`guest_calls`** — the session/"call" row. Lifecycle `status`: `queued →
  assigned → joining → live → grace → ending → ended` (+ `abandoned`,
  `cancelled`, `expired_free`). Key timestamps: `created_at`, `assigned_at`
  (engineer accepted — **the billing anchor**), `engineer_joined_at` /
  `customer_joined_at` (Zoom joins), `paid_extension_at`, `ended_at`. Money:
  `free_minutes`, `free_minutes_used`, `duration_minutes`. Zoom:
  `zoom_meeting_id`, `zoom_join_url` (customer), `zoom_start_url` (engineer),
  `zoom_observer_url` (supervisor). Ownership: `claimed_by` (engineer),
  `pod_id`, `supervisor_user_id` (covering supervisor), `reassign_needed`.
  Customer‑facing engineer name = `agent_name` (the **alias**).
- **`engineer_match_offers`** — the push‑ring. One pending offer per engineer
  per intake; `status` pending/accepted/declined/expired; `expires_at`;
  `assigned_by` (set when a supervisor directs a manual ring).
- **`client_intakes`** — the customer's problem intake (technologies,
  `declined_by[]`, `guest_call_id`).
- **`engineer_profiles`** — skills, `is_available` (online toggle), `display_alias`.
- **`pods` / `pod_members`** — supervisor↔engineer grouping (one user per pod,
  `pod_role` supervisor|engineer). Pods scope supervisor visibility, NOT matching.
- **`supervisor_presence` / `supervisor_sessions` / `supervisor_status_changes`** —
  supervisor on/off‑duty toggle + audit (mirror of engineer presence).
- **`customer_entitlements`** (free quota / `free_session_consumed_at`),
  **`credit_wallets`** (paid balance), enterprise hierarchy
  (`organizations`/`departments`/`resellers` + `profiles.remaining_minutes`).
- **`guest_messages`** — chat + system messages. **`session_health`** /
  `latest_session_health` — sentiment.

`lib/supabase/types.ts` mirrors these — keep in sync.

---

## 10. Core flows (how the important things actually work)

**Matching / ring (sequential push‑ring):**
- `match_engineer(intake)` picks the single best available engineer (tech
  overlap + experience bonus, `random()` tiebreak; excludes busy, declined, and
  already‑offered) and inserts ONE pending `engineer_match_offers` row.
- The engineer sees a full‑screen popup (`EngineerIncomingMatch`, mounted
  app‑wide in `StaffShell` **and** in bare `/admin/v2` mode). **Accept** →
  `accept_match` (atomic claim, sets `assigned_at`, writes alias to
  `agent_name`). **Decline** → `decline_match`.
- `advance_match_on_offer_close` trigger rings the next engineer when an offer
  is declined/expired **and** the session is still queued **and** no other
  pending offer exists.

**Manual (supervisor/admin) assignment — `supervisor_assign_engineer`:**
- Creates a **directed** pending offer (a ring) to a specific engineer — it does
  NOT force‑claim. The engineer gets the same popup; billing starts only on
  accept. Manual assign **stops the auto‑matcher** (expires other pending
  offers; the advance trigger no‑ops while a pending offer exists).
- Any supervisor‑tier user can assign **any** engineer (not pod‑limited).
- If the directed engineer **declines**, the session is flagged
  `reassign_needed`, the auto‑matcher does **not** take over, and **all
  supervisors + super_admin** get a toast + a "reassign" control on the
  `/supervise` cards. (A directed offer that merely **times out** does fall back
  to auto‑matching so the customer isn't stranded.)

**Billing / time — single source of truth = `lib/relay/sessionClock.ts`:**
- The clock anchors on **`assigned_at`** (when the engineer accepts and chat
  starts) — **NOT** the Zoom join. Every surface (customer countdown, wallet
  chip, engineer room, supervise card) uses the same anchor so they agree.
- Free is **binary**: a customer's first claimed session is free for up to
  `free_minutes` (10). A **returning** customer is billed the whole session from
  `assigned_at`; a first‑timer who upgrades mid‑session bills from
  `paid_extension_at`.
- The server function **`end_session`** is the canonical biller (deducts
  `credit_wallets.balance` / dept pools). The client `useFreeSessionLifecycle`
  enforces both free‑cap expiry **and paid‑balance exhaustion** (ends at 0).
- ⚠️ Several timestamps look interchangeable (`assigned_at` vs `joined_at` vs
  `engineer_joined_at`). Billing/timer = **`assigned_at`**. Don't "fix" a timer
  by switching anchors without checking `end_session` first.

**Supervisor coverage failover:**
- `guest_calls.supervisor_user_id` is auto‑assigned at claim by a trigger
  (`pick_supervisor_for_session`): the pod's own supervisor if on‑duty, else the
  least‑loaded on‑duty supervisor. `supervisor_set_online(false)` re‑routes that
  supervisor's sessions; going online sweeps up uncovered ones. So no live
  session is left unsupervised when a pod's supervisor is offline.

**Engineer aliases (privacy):** customers never see staff real names. Each
engineer gets a stable **single first name** alias (`assign_engineer_alias`)
written into `agent_name` + Zoom registration. Staff surfaces (supervise cards,
admin matching) show `alias · real name` for mapping.

**Zoom:** `mint-zoom-for-session` makes a type‑2 registration meeting and
registers engineer (alias), customer, and an anonymous "Relay Supervisor"
observer; URLs land on `guest_calls`. The client embeds the Meeting SDK
(`app/_components/ZoomCall.tsx`) using `zoom-sdk-signature`.

**Summaries:** at end, `summarize-guest-call` builds a transcript (chat + Zoom AI
Companion blocks) and produces title/overview/next‑steps + sentiment. It
**guards** against trivial sessions (no real exchange + no Zoom → `no_conversation`,
no hallucinated summary).

---

## 11. Migrations & deploys (operational — important)

**The Supabase project ref is `vdduelvjrzeczmakxgpn`.** The Supabase CLI on the
handing‑over machine was logged in (`supabase projects list` worked).

**Apply a migration** (how it's been done this project — Management API):
```bash
# needs a Supabase Management token (sbp_...) in $SUPABASE_ACCESS_TOKEN
jq -Rs '{query: .}' supabase/migrations/<file>.sql \
 | curl -s -X POST "https://api.supabase.com/v1/projects/vdduelvjrzeczmakxgpn/database/query" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" --data @-
# success returns a JSON array; an error returns a JSON object {message,...}
```
Alternatively `supabase db push` (needs the DB password). **Either way, the
`supabase/migrations/` folder is the source of truth and can drift from the live
DB** — verify with a `SELECT` against `information_schema` / `pg_get_functiondef`
after applying. Migrations are timestamp‑named; keep them ordered and additive
(`IF NOT EXISTS`, `CREATE OR REPLACE`).

**Deploy an edge function:**
```bash
supabase functions deploy <name> --project-ref vdduelvjrzeczmakxgpn
```

**Migration ordering matters with deploys:** e.g. an edge function that reads a
new column must not be deployed before the column's migration is applied.

---

## 12. Environment variables

App (`.env.local`, gitignored — **never commit**). Names only; get values from
the owner:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY            # server-only; powers admin API routes + scripts
OPENAI_API_KEY                       # intake assistant (server)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
NEXT_PUBLIC_ZOOM_SDK_KEY
NEXT_PUBLIC_BRAND_NAME / _DOMAIN / _SUPPORT_EMAIL / _BILLING_EMAIL
```

Edge functions read their secrets from the **Supabase dashboard** (Project
Settings → Edge Functions / secrets), not `.env.local`. They include:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `STRIPE_SECRET_KEY`
(and Stripe webhook signing secret). Confirm these are set before testing
calls/payments.

---

## 13. Marketing / landing site

- The public marketing site (`/`, `pricing`, `product`, `company/*`, `trust/*`,
  `legal/*`, `for/*`, `explainer`, `brand-guidelines`, `resources/*`, etc.) was
  imported from a **sister repo** (`ngemawat/relay.green.claude`, where the
  marketing team iterates) onto branch **`landing-from-claude`** (not yet merged
  to `main` at time of writing — verify with `git branch`).
- **Branding is scoped**: the marketing identity (cream + coral) lives entirely
  under **`.mk-root`** in `app/_marketing/marketing.css`, applied by
  `app/_marketing/Shell.tsx`. The **post‑login app** uses its own white + green
  tokens in `app/globals.css` `:root` and is untouched by the marketing brand.
  Keep this separation — don't move marketing colors into `:root`.
- **No marketing APIs**: contact forms compose a `mailto:` (currently
  `hello@relay.green` — change if needed); the marketing "buy" button hands off
  to the existing authenticated purchase via `/login`. Don't add `/api/contact`
  or `/api/checkout`; wire to existing flows.
- `FloatingThemeToggle` hides on marketing routes (they're fixed cream).

---

## 14. Spec / product docs (`docs/`, read in order)

1. `RelayGreen_Spec_Decisions_v1.md` — **canonical closeout; supersedes
   everything on conflict.**
2. `RelayGreen_Build_Ready_PRD_v1.md` — product requirements.
3. `RelayGreen_Technical_Architecture_v1.md` — entities, services, RBAC.
4. `RelayGreen_Implementation_Backlog_v1.md` — build tickets (RG‑0001+).

When schema/behavior in code disagrees with these, the closeout doc wins for
*intended* behavior; this file + the code win for *current* behavior.

---

## 15. Recent work (context for what changed last)

The last development pass added/changed (all on `main` except the marketing
import on `landing-from-claude`):

- Supervisor **presence** (on/off‑duty toggle) + automatic **coverage
  failover** (`supervisor_user_id`).
- Manual assignment became a **directed ring** (popup + bill‑on‑accept) that
  **stops the auto‑matcher**; **decline → supervisor reassign** (toast + control
  for supervisor *and* super_admin; reassign to any engineer).
- **Centralized billing clock** (`lib/relay/sessionClock.ts`, anchor =
  `assigned_at`); enforce **paid‑balance exhaustion** (end at 0).
- Engineer aliases simplified to a **single first name**; staff surfaces show
  **alias ↔ real name**.
- Global `/supervise` + Matching tab for **super_admin**.
- Zoom **anonymous supervisor observer** join (`zoom_observer_url`).
- Summary **anti‑hallucination guard** for trivial sessions.
- Marketing/landing **frontend import** (branch `landing-from-claude`).

Migrations from this pass: `20260524100000`…`20260524180000`.

---

## 16. Security / footguns

- **`.env.local` is gitignored** — never commit secrets. Edge secrets live in
  the Supabase dashboard.
- Treat any token/key that appears in chat or a PR as **exposed → rotate it**
  (Supabase Management `sbp_` tokens, service‑role key, Stripe/Zoom/OpenAI keys).
- **`scripts/wipe-and-seed-admin.sh` is destructive** — it deletes ALL data +
  ALL auth users and reseeds a single super admin (`admin@relay.com` /
  `Password@12`). Requires `--yes-wipe-everything` and a Management token in env.
  Use only on a throwaway/dev project.
- The matcher/billing functions are `SECURITY DEFINER` and re‑check authority
  server‑side. Don't trust the client; keep authz in the RPCs.

---

## 17. Common tasks (recipes)

- **Add a DB column/table:** write a new timestamped migration in
  `supabase/migrations/` (additive, `IF NOT EXISTS`), apply via §11, update
  `lib/supabase/types.ts`, then update consuming code. Verify with a `SELECT`.
- **Change billing/timer behavior:** edit `end_session` (server, the truth) AND
  `lib/relay/sessionClock.ts` (client) together; anchor stays `assigned_at`.
- **Change matching:** `match_engineer` / `advance_match_on_offer_close` /
  `accept_match` / `decline_match` / `supervisor_assign_engineer` (all in
  migrations). The engineer popup is `app/_components/EngineerIncomingMatch.tsx`.
- **Touch Zoom:** `supabase/functions/mint-zoom-for-session` +
  `zoom-sdk-signature` + `app/_components/ZoomCall.tsx`.
- **Before pushing:** `npm run lint` + `node_modules/typescript/bin/tsc
  --noEmit` + `npm run build`. Pre‑existing lint debt exists (some `Date.now`
  purity + set‑state‑in‑effect warnings) — don't add new ones.

---

## 18. Quick reference

- Supabase project ref: `vdduelvjrzeczmakxgpn`
- Live URL pattern (dev): `https://10.0.1.207:3000`
- Typecheck: `node_modules/typescript/bin/tsc --noEmit`
- Apply migration: Management API `POST /v1/projects/<ref>/database/query`
- Deploy edge fn: `supabase functions deploy <name> --project-ref <ref>`
- Billing anchor: `guest_calls.assigned_at`
- Single source of truth for time: `lib/relay/sessionClock.ts`
- Customer login `/login`; staff login `/staff/login`
- Marketing brand scope: `.mk-root` in `app/_marketing/marketing.css`
