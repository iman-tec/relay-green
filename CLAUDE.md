# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Optimizing or removing code? Read [docs/audit/CONTEXT.md](docs/audit/CONTEXT.md) first** — team do-not-break orientation (load-bearing paths, decommission landmines, open security findings). NOTE: the "Anthropic Claude" AI-stack claim below is inaccurate — the live AI stack is OpenAI + Groq (confirmed in code).

@AGENTS.md

## Critical: Next.js 16

This is Next.js **16** with React **19** and Tailwind **v4**. The conventions
differ from older Next.js versions in your training data. Before writing code
that touches routing, middleware, fonts, image, or build config, consult
`node_modules/next/dist/docs/` and heed any deprecation notices. Notable
divergences in this repo:

- **`proxy.ts` replaces `middleware.ts`** (deprecated in Next.js 16). Edge
  proxy lives at the repo root and handles Supabase JWT refresh + route
  protection. See [proxy.ts](proxy.ts).
- Turbopack `root` is pinned to `.` in [next.config.ts](next.config.ts) so
  worktree parent dirs with their own `package-lock.json` don't get picked
  up.
- `reactStrictMode: false` intentionally — the Zoom Video SDK uses singleton
  `window` state and rejects StrictMode's double-invoke.

## Commands

```bash
npm run dev          # https://10.0.2.129:3000  (LAN IP + experimental HTTPS, set in package.json)
npm run build        # production build
npm run lint
npm run typecheck    # tsc --noEmit
npm run format       # prettier --write
npm run verify       # lint + typecheck + format:check  (run before pushing)

# Local Postgres (docker) — used only by Prisma schema/migrations, NOT by the live app
npm run db:up        # docker compose up -d  (postgres:17-alpine on localhost:5433)
npm run db:down
npm run db:migrate   # prisma migrate dev
npm run db:seed      # tsx prisma/seed.ts

# Playwright (no npm script — invoke directly)
npx playwright test                       # all e2e tests, configured for https://10.0.2.129:3000
npx playwright test tests/customer.spec.ts  # single file
npx playwright test -g "session name"     # by test title
```

The dev server binds to `10.0.2.129` (the developer's LAN IP), not localhost.
Playwright's `baseURL` matches (override with `PLAYWRIGHT_BASE_URL`). If your
LAN IP differs, both will need updating, and `allowedDevOrigins` in
[next.config.ts](next.config.ts) too. The IP appears in `package.json` (`dev`
script `-H`), `playwright.config.ts`, and `next.config.ts` — grep all three.

Playwright is sequential (`workers: 1`, `fullyParallel: false`) because tests
share Supabase state.

## Persistence: Supabase is the database, not Prisma

This is the single most important architectural point and easy to get wrong.

- The live app uses **Supabase** (managed Postgres + auth + realtime) through
  `@supabase/supabase-js` and `@supabase/ssr`. Browser/server clients are in
  [lib/supabase/](lib/supabase/).
- [prisma/schema.prisma](prisma/schema.prisma) is the **canonical data-model
  document** (28 entities, kept in sync with
  `docs/RelayGreen_Technical_Architecture_v1.md`) but **Prisma is not wired
  at runtime**. [lib/db.ts](lib/db.ts) exports a Proxy that throws
  `"Prisma is no longer wired in this app"` if any code path actually calls
  it. The local docker Postgres exists only to apply Prisma migrations as a
  schema reference; real data lives in Supabase.
- Schema migrations applied to Supabase live in
  [supabase/migrations/](supabase/migrations/) — those are authoritative for
  the running system. The `prisma/` files are documentation.
- If you hit the Prisma-stub error at runtime, you're on a legacy page
  (likely under `/customer`, `/engineer`, `/supervisor` in [app/](app/)) —
  rewrite against Supabase or delete it. The live UX uses `/room`,
  `/dashboard`, `/inbox`, `/supervise`, `/staff/session/[id]`.

## Two auth surfaces

Login routes are split by audience and the proxy enforces the split:

- `/login` — customer magic-link flow. Protects `/room/*`
  (`CUSTOMER_PREFIXES`).
- `/staff/login` — staff 8-digit-OTP flow. Protects `/dashboard`, `/inbox`,
  `/triage`, `/supervise`, `/admin`, `/enterprise`, `/staff/session`
  (`STAFF_PREFIXES`).

An unauthed hit on a protected route bounces to the matching login surface
— don't lump them together. The list lives in [proxy.ts](proxy.ts:24-36).
Real authorization (role checks, RLS) is enforced server-side in route
handlers / RPCs and client-side via [`useStaffGuard`](lib/relay/useStaffGuard.ts);
the proxy is only the fast-edge layer.

[lib/auth.ts](lib/auth.ts) is a **demo-only** cookie-based auth scheme
(Phase 0 placeholder), not for production. Real auth goes through Supabase.

## Role surfaces

Five roles map to the routes in [app/](app/):

| Role             | Route                           | Notes                                         |
| ---------------- | ------------------------------- | --------------------------------------------- |
| Customer         | `/room`                         | Live engagement surface (legacy: `/customer`) |
| Engineer         | `/staff/session/[id]`, `/inbox` | Session + queue                               |
| Supervisor       | `/supervise`                    | Pod monitoring (legacy: `/supervisor`)        |
| Enterprise admin | `/enterprise`                   | Org code, wallet, usage                       |
| Internal admin   | `/admin`                        | Cross-tenant ops                              |

Staff routes are grouped under `app/(staff)/` and share
`app/(staff)/layout.tsx`.

## Where the live logic lives: `lib/`

Client-side feature logic and Supabase access is concentrated in `lib/`, not
scattered through components:

- [lib/relay/](lib/relay/) — the heart of the running app. React hooks
  (`use*`) and helpers for sessions, queue, heartbeat, presence, pricing,
  profiles, and the staff guard. New live-surface behavior belongs here, not
  inline in `app/` pages.
- [lib/supabase/](lib/supabase/) — `browser.ts` / `server.ts` clients +
  generated `types.ts`. Always go through these, never `createClient` ad hoc.
- Role/tenant authorization helpers are split per audience:
  `admin-auth.ts`, `enterprise-auth.ts`, `department-auth.ts`,
  `reseller-auth.ts`, plus `auth-ban.ts` / `password-policy.ts`. Match the
  helper to the surface.
- [lib/video/](lib/video/) — Zoom Video SDK client + noise silencing
  (paired with `reactStrictMode: false`).

## Edge functions

Long-lived operations (Stripe checkout/webhooks, Zoom SDK signature/meeting
lifecycle, Anthropic Claude session-health scoring and summarization) run as
Supabase edge functions in [supabase/functions/](supabase/functions/), not as
Next.js route handlers. Notable ones: `create-zoom-meeting`,
`zoom-sdk-signature`, `zoom-webhook`, `score-session-health`,
`summarize-customer`, `summarize-project`, `payments-webhook`,
`relay-stripe-webhook`.

Next.js `app/api/` exposes only the lighter-weight endpoints (auth, admin,
enterprise, dev/test helpers).

## Specification documents

The product/architecture spec lives in [docs/](docs/). Read in order:

1. `RelayGreen_Spec_Decisions_v1.md` — **canonical closeout, supersedes
   everything else on any conflict.**
2. `RelayGreen_Build_Ready_PRD_v1.md` — product requirements.
3. `RelayGreen_Technical_Architecture_v1.md` — entities, services, RBAC.
4. `RelayGreen_Implementation_Backlog_v1.md` — build tickets (RG-0001+).

When the schema or a behavior in code disagrees with these docs, the
closeout document wins. The `prisma/schema.prisma` header points at the
Architecture doc; both should be kept in sync.

## Brand and styling

- Design tokens in [app/globals.css](app/globals.css) (cream + coral,
  claude.ai-aligned).
- Fonts: Source Serif 4 (display/body), Inter (UI), JetBrains Mono (code) —
  wired in [app/layout.tsx](app/layout.tsx). Fraunces / Instrument Sans are
  retired sitewide; don't reintroduce them.
- shadcn/ui is the component library. Prettier sorts Tailwind classes
  (`prettier-plugin-tailwindcss`).
