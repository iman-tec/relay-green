# Relay.green

Real-time human engineering support for AI-native builders.

> Click the green dot. Get a qualified engineer in 90 seconds.

## What this is

Relay.green is the platform that catches every person building with AI dev
tools (Claude, Cursor, Lovable, Replit, Bolt, v0, Gemini, Copilot, ChatGPT)
at the three moments they need a real engineer: when they get stuck, when
they need to launch, and when they need someone to maintain what they've
built. Customers buy prepaid hour-buckets; same engineer follows them
across all three engagement contexts.

## Repo layout

```
relay-green/
├── app/                  Next.js App Router pages
│   ├── globals.css       Design tokens (claude.ai-aligned cream + coral)
│   ├── layout.tsx        Root layout (Source Serif 4 + Inter + JetBrains Mono)
│   └── page.tsx          Public landing page
├── docs/                 Linked spec documents (see Docs section)
├── public/               Static assets
├── eslint.config.mjs
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Local development

```bash
npm install
npm run dev          # starts dev server on http://localhost:3000
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

Requires Node 24 LTS and npm 10+.

## Tech stack (locked per spec)

| Layer             | Choice                                                         |
| ----------------- | -------------------------------------------------------------- |
| Framework         | Next.js 16 (App Router) + React 19                             |
| Language          | TypeScript 5                                                   |
| Styling           | Tailwind CSS v4 + design tokens in `app/globals.css`           |
| Component library | shadcn/ui (added later in RG-0001)                             |
| Fonts             | Source Serif 4 (headings), Inter (body), JetBrains Mono (code) |
| ORM               | Prisma (added in RG-0101)                                      |
| Database          | PostgreSQL (added in RG-0101)                                  |
| Realtime          | Zoom Video SDK (Phase 4)                                       |
| Payments          | Stripe Multi-Currency Pricing + Stripe Tax (Phase 4)           |
| AI                | Anthropic Claude API — Haiku 4.5 for risk-scoring + co-pilot   |
| Auth              | Demo auth (Phase 0) → claude.ai-mirror flow (Phase 1)          |

## Five role surfaces

| Role             | Route         | Purpose                                             |
| ---------------- | ------------- | --------------------------------------------------- |
| Customer         | `/customer`   | Click green dot, get matched, draw down hour-bucket |
| Engineer         | `/engineer`   | Take sessions, AI co-pilot, project memory          |
| Supervisor       | `/supervisor` | 10-card live-monitoring with AI risk scoring        |
| Enterprise admin | `/enterprise` | Org code, user invites, wallet, usage metadata      |
| Internal admin   | `/admin`      | Cross-tenant ops, billing, audit                    |

## Docs

Specification and decision documents (canonical source of truth):

| Doc                                       | Purpose                                  |
| ----------------------------------------- | ---------------------------------------- |
| `RelayGreen_Spec_Decisions_v1.md`         | **Canonical closeout — read this first** |
| `RelayGreen_Build_Ready_PRD_v1.md`        | Product requirements                     |
| `RelayGreen_Technical_Architecture_v1.md` | Architecture, entities, services         |
| `RelayGreen_Implementation_Backlog_v1.md` | Build tickets (RG-0001 onwards)          |
| `RelayGreen_Product_Spec_Draft.md`        | Detailed flows & lifecycle               |
| `RelayGreen_Codex_Build_Approach.md`      | Phase-by-phase build approach            |
| `RelayGreen_Start_Build_Checklist.md`     | Pre-build readiness                      |

These documents live one level up at `D:\TGCCORPCODEX\` and are linked into
`./docs/` (RG-0002).

## Phase status

| Phase                               | Status                                    |
| ----------------------------------- | ----------------------------------------- |
| Phase 0 — Foundation                | In progress (RG-0001 ✓ scaffold complete) |
| Phase 1 — Core Support Loop         | Pending                                   |
| Phase 2 — Supervisor Operations     | Pending                                   |
| Phase 3 — Enterprise Console        | Pending                                   |
| Phase 4 — Real Provider Integration | Pending                                   |
| Phase 5 — Native Mobile + Expansion | Pending                                   |

## License

© Relay.green. All rights reserved.
