# Relay.green Start Build Checklist

Purpose: Final checklist before Claude Code begins implementation.

> Updated 2026-05-09: hour-bucket commercial model, claude.ai-mirror auth,
> Zoom Video SDK, accent neutralization, design system, and 13 sub-decisions
> locked. See `RelayGreen_Spec_Decisions_v1.md`.

## Documents Ready (in priority order)

1. [RelayGreen_Spec_Decisions_v1.md](D:/TGCCORPCODEX/RelayGreen_Spec_Decisions_v1.md) — **canonical closeout (highest priority)**
2. [RelayGreen_Build_Ready_PRD_v1.md](D:/TGCCORPCODEX/RelayGreen_Build_Ready_PRD_v1.md) — PRD v1.1
3. [RelayGreen_Technical_Architecture_v1.md](D:/TGCCORPCODEX/RelayGreen_Technical_Architecture_v1.md) — Architecture v1.1
4. [RelayGreen_Implementation_Backlog_v1.md](D:/TGCCORPCODEX/RelayGreen_Implementation_Backlog_v1.md) — Backlog v1.1
5. [RelayGreen_Product_Spec_Draft.md](D:/TGCCORPCODEX/RelayGreen_Product_Spec_Draft.md) — Spec Draft v0.2
6. [RelayGreen_Codex_Build_Approach.md](D:/TGCCORPCODEX/RelayGreen_Codex_Build_Approach.md) — Build Approach v1.1

## Recommended Starting Decisions

These are the recommended defaults unless changed before build starts.

### App Stack

- Next.js App Router.
- TypeScript.
- Tailwind CSS.
- shadcn/ui style component primitives.
- Prisma ORM.
- PostgreSQL-ready schema.
- Demo auth first.
- Mock Zoom, Stripe, and AI providers first.

### Package Manager

Recommended: npm.

Reason: predictable, installed by default, good enough for first app scaffold.

### First App Location

Recommended:

```text
D:\TGCCORPCODEX\relay-green
```

### First Build Scope

Start with:

1. RG-0001 Scaffold Application.
2. RG-0002 Create Project Documentation Folder.
3. RG-0003 Configure Code Quality.
4. RG-0101 Add Prisma and Database Schema.
5. RG-0102 Seed Demo Data.
6. RG-0201 Demo Auth.
7. RG-0202 RBAC Guards.
8. RG-0203 Role Dashboards.

### First Demo Goal

The first demo should show:

- Login as each role.
- Customer dashboard.
- Engineer dashboard.
- Supervisor dashboard.
- Enterprise dashboard.
- Internal admin dashboard.
- Seeded data visible in the correct places.

No real Zoom, Stripe, or AI integration is required for the first demo.

## Open Confirmation Needed

Before Codex starts building, confirm:

1. Use `D:\TGCCORPCODEX\relay-green` as the app folder?
2. Use Next.js + TypeScript + Tailwind + Prisma?
3. Use npm?
4. Start with demo auth and mock providers?

If yes to all, Codex can begin implementation from RG-0001.
