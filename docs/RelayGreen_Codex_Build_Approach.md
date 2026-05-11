# Relay.green Build Approach

Version: 1.1  
Purpose: Operating document for using Claude Code to build the Relay.green platform end to end.

> **IMPORTANT — superseding document**: For any conflict between this build
> approach and `RelayGreen_Spec_Decisions_v1.md` (the closeout document from
> the 2026-05-09 brainstorm session), the closeout document is canonical. The
> closeout document records the unified hour-bucket commercial model, the
> claude.ai-mirror auth flow, the Anthropic-style design system, the Zoom Video
> SDK realtime stack, accent neutralization, and all C/I/O sub-decisions.

## 1. Build Principle

Relay.green will be built iteratively by Codex from a clear product spine:

1. Build the smallest complete working platform first.
2. Keep every module enterprise-ready even when the first implementation is simple.
3. Do not build throwaway prototypes that cannot evolve.
4. Separate customer, engineer, supervisor, enterprise, and internal admin concerns from day one.
5. Use clean contracts between frontend, backend, billing, matching, Zoom, AI, and memory modules.
6. Keep the system modular so browser extension, desktop launcher, mobile apps, and advanced AI can be added without rewriting the core.

The first build target is not the whole unicorn platform. It is the core operating loop:

> Customer clicks green dot -> AI triage -> engineer matching -> Zoom session -> billing -> memory -> admin visibility.

## 2. Source Documents

Claude Code should treat these as canonical inputs, in this priority order:

1. [RelayGreen_Spec_Decisions_v1.md](D:/TGCCORPCODEX/RelayGreen_Spec_Decisions_v1.md) — closeout document (highest priority)
2. [RelayGreen_Build_Ready_PRD_v1.md](D:/TGCCORPCODEX/RelayGreen_Build_Ready_PRD_v1.md) — PRD v1.1 (updated)
3. [RelayGreen_Technical_Architecture_v1.md](D:/TGCCORPCODEX/RelayGreen_Technical_Architecture_v1.md) — Architecture v1.1 (updated)
4. [RelayGreen_Implementation_Backlog_v1.md](D:/TGCCORPCODEX/RelayGreen_Implementation_Backlog_v1.md) — Backlog v1.1 (updated)
5. [RelayGreen_Product_Spec_Draft.md](D:/TGCCORPCODEX/RelayGreen_Product_Spec_Draft.md) — Spec Draft v0.2 (updated)

On conflict, the higher-priority document wins. The closeout document
(`RelayGreen_Spec_Decisions_v1.md`) is the canonical decision register and
overrides every other document.

## 3. Recommended Initial Tech Stack

This stack is optimized for speed, enterprise extensibility, and Codex productivity.

### 3.1 Application

- Next.js App Router.
- TypeScript.
- Tailwind CSS.
- shadcn/ui or equivalent component primitives.
- PostgreSQL.
- Prisma ORM.
- Redis-compatible queue/presence layer later.
- Stripe for billing abstraction.
- Zoom integration abstraction.
- AI provider abstraction.

### 3.2 Suggested Monorepo Shape

Initial repo can be a single Next.js app with strong module boundaries. Move to Turborepo only when necessary.

Recommended starting structure:

```text
relay-green/
  apps/
    web/
      app/
      components/
      features/
      lib/
      server/
      styles/
  packages/
    domain/
    database/
    auth/
    billing/
    matching/
    zoom/
    ai/
    memory/
    reporting/
    audit/
  docs/
  prisma/
  tests/
```

If we start inside a simpler single-app repo, keep equivalent folders:

```text
src/
  app/
  components/
  features/
  server/
  domain/
  integrations/
  lib/
```

## 4. Build Phases

### Phase 0: Foundation

Goal: create the skeleton that all later work uses.

Deliverables:

- App scaffold.
- Auth placeholder or real auth if selected.
- Role model.
- Tenant/organization model.
- Database schema v1.
- Audit log table.
- Seed data.
- Internal admin shell.
- Design system baseline.
- Environment variable structure.
- Basic test setup.

Definition of done:

- App runs locally.
- Database migrations run.
- Seed users exist for customer, engineer, supervisor, enterprise admin, and internal admin.
- Each role can reach its placeholder dashboard.

### Phase 1: Core Support Loop

Goal: make the green-dot session lifecycle work end to end without full production integrations.

Deliverables:

- Customer dashboard.
- Project creation.
- Green-dot support request flow.
- AI triage placeholder.
- Engineer profile model.
- Matching service v1.
- Engineer console.
- Session states.
- Zoom meeting abstraction with mocked provider first.
- Billing calculation engine.
- First 10 free minutes rule.
- Hour-bucket ledger drawdown rule (per-minute drawdown from active bucket; no per-session minimum).
- Session memory v1.
- Internal admin session view.

Definition of done:

- Customer can create project and request help.
- Engineer can be matched.
- Session can move through lifecycle states.
- Billing can be calculated.
- Memory record is created.
- Internal admin can see the session.

### Phase 2: Supervisor Operations

Goal: build the quality and control layer.

Deliverables:

- Supervisor dashboard with engineer cards.
- Live status simulation or realtime updates.
- AI risk flag placeholder.
- Red-card state.
- Private supervisor-to-engineer message model.
- Supervisor join/takeover state.
- Customer credit workflow.
- Supervisor notes.

Definition of done:

- Supervisor can monitor assigned engineers.
- Risk card can turn red.
- Supervisor can create intervention events.
- Supervisor can credit session time.

### Phase 3: Enterprise Admin

Goal: build enterprise account governance and spend visibility.

Deliverables:

- Organization code model.
- Discount rule model.
- Enterprise user onboarding by organization code.
- Bulk Excel upload flow.
- Invite link generation.
- Enterprise wallet model.
- Individual-card versus wallet allocation.
- Spend limits.
- Usage dashboard.
- Report export v1.

Definition of done:

- Enterprise admin can invite users.
- Users can join under organization.
- Sessions are attributed to enterprise.
- Wallet and spend limits are visible.
- Enterprise admin sees metadata only.

### Phase 4: Real Integrations

Goal: replace mocks with production providers.

Deliverables:

- Real Zoom integration.
- Real Stripe integration.
- Real AI model integration.
- Email notification provider.
- Recording consent flow.
- Payment authorization flow.
- Webhook handling.

Definition of done:

- Live Zoom meetings are created.
- Payments can be authorized/captured in test mode.
- AI triage and copilot calls work through provider abstraction.
- Webhooks update local records.

### Phase 5: Expansion Surfaces

Goal: add product surfaces without disturbing the core.

Deliverables:

- Browser extension.
- Desktop launcher.
- Customer mobile app.
- Engineer mobile app.
- Advanced AI copilot.
- Pattern library.
- Launch project workflow.
- Maintenance retainer workflow.

## 5. Codex Working Method

Codex should work in small complete increments:

1. Read the PRD and this build approach.
2. Inspect current repo state.
3. Create or update a short implementation plan.
4. Build one milestone slice.
5. Run tests/build.
6. Start local dev server when frontend changes are made.
7. Verify in browser.
8. Update documentation and backlog.
9. Report changed files, verification, and next step.

## 6. Engineering Rules

- No feature should bypass RBAC.
- No enterprise admin should see session content.
- Engineer real identity must never be shown to customers.
- Billing rules must be centralized, not scattered through UI.
- Matching logic must be centralized behind a service interface.
- Zoom, Stripe, and AI providers must be behind abstractions so mocks can be used locally.
- Audit events must be generated for sensitive actions.
- Session state transitions must be explicit.
- Customer-visible notes and internal notes must be separate data objects.
- Supervisor notes are internal only by default.

## 7. First Build Slice

The first actual development slice should be:

1. Scaffold the app.
2. Create database schema.
3. Seed demo users and engineers.
4. Create role-based dashboard routing.
5. Build customer green-dot request screen.
6. Build engineer profile and matching mock.
7. Build session lifecycle model.
8. Show internal admin view of created sessions.

This gives us the platform skeleton and proves the core loop without waiting for Zoom, Stripe, or AI keys.

## 8. What Not To Build First

Do not start with:

- Desktop launcher.
- Mobile apps.
- Full AI voice/accent layer.
- Complex enterprise hierarchy.
- Full SCIM.
- Real-time production-grade video.
- Pattern library at scale.
- Marketplace-style engineer browsing.

These are important, but they should sit on top of the validated core loop.

## 9. Current Readiness

Ready to start:

- Product vision.
- Four-track requirements.
- MVP scope.
- Core modules.
- Initial build phases.

Still to decide during build:

- Exact auth provider.
- Exact cloud provider.
- Exact payment provider details.
- Exact Zoom account/API setup.
- Exact AI provider and model choices.
- Data retention durations.
- Legal copy and consent language.

The system should be built so these can be configured without deep rewrites.
