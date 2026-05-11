# Relay.green Specification Documents

Read in this priority order. The closeout document supersedes every other
document on any conflict.

| Order | Document | Purpose |
|---|---|---|
| 1 | [RelayGreen_Spec_Decisions_v1.md](./RelayGreen_Spec_Decisions_v1.md) | **Canonical closeout — read first.** All architectural, critical, important, and operational decisions. |
| 2 | [RelayGreen_Build_Ready_PRD_v1.md](./RelayGreen_Build_Ready_PRD_v1.md) | Product requirements |
| 3 | [RelayGreen_Technical_Architecture_v1.md](./RelayGreen_Technical_Architecture_v1.md) | Architecture, 28 entities, services, RBAC matrix |
| 4 | [RelayGreen_Implementation_Backlog_v1.md](./RelayGreen_Implementation_Backlog_v1.md) | Build tickets (RG-0001 onwards) |
| 5 | [RelayGreen_Product_Spec_Draft.md](./RelayGreen_Product_Spec_Draft.md) | Detailed flows, lifecycle, edge cases |
| 6 | [RelayGreen_Codex_Build_Approach.md](./RelayGreen_Codex_Build_Approach.md) | Phase-by-phase build approach |
| 7 | [RelayGreen_Start_Build_Checklist.md](./RelayGreen_Start_Build_Checklist.md) | Pre-build readiness checklist |

## Quick reference

### Five role surfaces

| Role | Route | Persona |
|---|---|---|
| Customer | `/customer` | Citizen builder using AI dev tools, gets stuck |
| Engineer | `/engineer` | Qualified Gateway-employed engineer, alias only |
| Supervisor | `/supervisor` | Manages pod of ~10 engineers, AI-assisted monitoring |
| Enterprise admin | `/enterprise` | Org owner, code/wallet/usage governance |
| Internal admin | `/admin` | Relay.green ops/leadership, cross-tenant |

### Three engagement contexts (one commercial primitive: hour buckets)

| Engagement | Buckets | Cadence |
|---|---|---|
| Get unstuck | 5 · 10 hrs | one-time, top-up |
| Get it live | 20 · 40 · 60 hrs | one-time per project |
| Keep it running | 50 / 100 / custom hrs/mo | monthly recurring |

### Pricing anchor

€39/hr at the no-discount 5-hour bucket; sliding to €24/hr at the largest
custom-Maintain bucket. Multi-currency rate cards in EUR/USD/GBP/INR per
Section C3 of the closeout document.

### Stack (locked)

Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind v4 · shadcn/ui ·
Prisma · PostgreSQL · Stripe (Multi-Currency + Tax) · Zoom Video SDK ·
Anthropic Claude (Haiku 4.5) · Twilio Verify · Resend.

## Update policy

These copies are kept in sync with the canonical versions at
`D:\TGCCORPCODEX\` until the project is moved into a single git repo.
On any divergence, the canonical version wins. After git migration, the
copies in this folder become the single source of truth.
