# Relay.green Implementation Backlog v1

Version: 1.1  
Purpose: Claude Code-executable backlog for building Relay.green from foundation to MVP.

> **IMPORTANT — superseding document**: For any conflict between this backlog
> and `RelayGreen_Spec_Decisions_v1.md` (the closeout document from the
> 2026-05-09 brainstorm session), the closeout document is canonical.
> Milestone 6 (Billing v1) below has been revised to implement the unified
> hour-bucket ledger model.

## Backlog Rules

- Work top-down unless the user reprioritizes.
- Each ticket should end with build/test verification.
- Each ticket should preserve module boundaries from the architecture document.
- Do not add real provider dependencies until the mock abstraction works.
- Do not expose engineer real identity to customers.
- Do not expose enterprise session content to enterprise admins.

## Milestone 0: Repository Foundation

### RG-0001: Scaffold Application

Goal: Create initial web application.

Acceptance criteria:

- Next.js TypeScript app exists.
- App runs locally.
- Basic layout loads.
- Tailwind/design system configured.
- README has local run instructions.

### RG-0002: Create Project Documentation Folder

Goal: Move and maintain docs in a project docs folder once repo exists.

Acceptance criteria:

- docs/ contains PRD, architecture, build approach, backlog.
- Root README links to core docs.

### RG-0003: Configure Code Quality

Goal: Add formatting, linting, and typecheck.

Acceptance criteria:

- lint command works.
- typecheck command works.
- build command works.

## Milestone 1: Data Foundation

### RG-0101: Add Prisma and Database Schema

Goal: Implement first data model from architecture.

Acceptance criteria:

- Prisma installed/configured.
- Schema includes core tables.
- Migration runs.
- Prisma client generated.

### RG-0102: Seed Demo Data

Goal: Provide demo users and test data.

Acceptance criteria:

- Seed customer, engineer, supervisor, enterprise admin, internal admin.
- Seed organization and organization code.
- Seed engineer profiles and skills.
- Seed sample project.

### RG-0103: Add Audit Logging Module

Goal: Central audit logging utility.

Acceptance criteria:

- auditLog function exists.
- Sensitive actions can call it.
- Audit logs are visible to internal admin later.

## Milestone 2: Auth and Role Shell

### RG-0201: Demo Auth

Goal: Enable role switching/login for local development.

Acceptance criteria:

- Login screen lists seeded demo users or accepts demo credentials.
- Session stores selected user.
- Logout works.

### RG-0202: RBAC Guards

Goal: Protect dashboards by role.

Acceptance criteria:

- Customer cannot access engineer dashboard.
- Enterprise admin cannot access session content routes.
- Internal admin can access admin shell.

### RG-0203: Role Dashboards

Goal: Create placeholder dashboards.

Acceptance criteria:

- /customer.
- /engineer.
- /supervisor.
- /enterprise.
- /admin.
- Each route has correct role layout.

## Milestone 3: Customer Green-Dot Flow

### RG-0301: Customer Project UI

Goal: Customer can create and view projects.

Acceptance criteria:

- Create project form.
- Project list.
- Project detail page.
- Fields include name, description, AI tool, product type.

### RG-0302: Green-Dot Support Request UI

Goal: Customer starts support request.

Acceptance criteria:

- Green-dot button prominent in customer UI.
- Opens request flow.
- Collects AI tool, product type, issue type, expertise needed, urgency, language.
- Creates support session in TRIAGE/MATCHING state.

### RG-0303: Waiting Room AI Triage Placeholder

Goal: Simulate AI asking questions while customer waits.

Acceptance criteria:

- Customer sees 90-second style waiting UI.
- Triage questions can be answered.
- Answers stored as TriageResponse.

## Milestone 4: Engineer Profile and Matching

### RG-0401: Engineer Profile Admin

Goal: Internal admin can manage engineer alias profiles and skills.

Acceptance criteria:

- List engineer profiles.
- View/edit alias, avatar, status, supervisor.
- Add skills by type.
- Real identity not shown in customer-facing components.

### RG-0402: Matching Service v1

Goal: Match session to engineer.

Acceptance criteria:

- Matching function uses same engineer, AI tool, product type, expertise, language, availability.
- Returns best engineer.
- Creates assignment event.
- Updates session state.

### RG-0403: Customer Assigned Engineer UI

Goal: Customer sees matched engineer alias.

Acceptance criteria:

- Shows alias, avatar, skill summary.
- Shows joining state.
- Does not show real name/email.
- Customer can request another engineer.

## Milestone 5: Session Lifecycle

### RG-0501: Session State Machine

Goal: Centralize valid session transitions.

Acceptance criteria:

- Session state enum exists.
- Transition helper validates movement.
- Audit log emitted for state changes.

### RG-0502: Engineer Session Console

Goal: Engineer can see assigned session.

Acceptance criteria:

- Engineer dashboard lists assigned sessions.
- Session detail shows customer/project context, triage, artifacts.
- Engineer can mark joined/live/closed.

### RG-0503: Mock Zoom Provider

Goal: Add Zoom abstraction before real API.

Acceptance criteria:

- createMeeting(sessionId) returns mock join URLs.
- Meeting record stored.
- Customer and engineer can click mock join URL.
- Recording consent fields exist.

## Milestone 6: Billing v1 (hour-bucket ledger)

> Original RG-0601/0602/0603 (per-minute hourly billing with 20-min minimum)
> are obsolete. Replaced by the hour-bucket ledger tickets below.

### RG-0601 (REVISED): Hour-Bucket Ledger Engine

Goal: Implement the unified prepaid hour-bucket model.

Acceptance criteria:

- HourBucket entity created (engagementType, bucketSize, pricePaid, currency,
  effectiveRatePerHour, hoursRemaining, expiresAt, status, refundEligibility).
- HourLedgerEntry entity created (hourBucketId, sessionId, minutesDrawn,
  ratePerHour, amountDrawn, entryType).
- Drawdown service:
  - Per-second internal granularity, per-minute customer/engineer display.
  - On every minute of live session, decrement bucket.hoursRemaining and
    create HourLedgerEntry of type DRAWDOWN.
  - On bucket exhaustion, prompt customer to purchase top-up.
- Free-trial special case: first 10 minutes per customer-lifetime use entryType
  FREE_TRIAL; no bucket required.
- Bucket expiration job (daily): Stuck >12mo, Launch >6mo, Maintain >end-of-next-month.
- Unit tests cover: free-trial-then-paid flow; mid-session bucket exhaustion;
  cross-currency bucket purchase; rollover for Maintain bucket; Launch
  10%-variance absorbed; Launch >10% variance request flow.

### RG-0602 (REVISED): Bucket Purchase UI + Stripe Multi-Currency

Goal: Customer can buy any of the 8 standard buckets in their locked currency.

Acceptance criteria:

- 8 buckets visible in customer console (5/10/20/40/60/50-mo/100-mo plus
  custom-quote request).
- Prices display in customer's locked currency per C3 rate cards
  (EUR/USD/GBP/INR).
- Stripe Multi-Currency Pricing wired; checkout charges in customer's currency.
- Stripe Tax wired: VAT/GST/sales tax computed and added at checkout.
- Apple Pay + Google Pay + PayPal enabled as alternate methods (per C5.d).
- On successful payment: HourBucket created with hoursRemaining = bucketSize,
  expiresAt set per type, status = ACTIVE.
- Stripe webhook handlers for: payment_intent.succeeded, charge.refunded,
  invoice.payment_failed (Maintain recurring).

### RG-0603 (REVISED): Drawdown BillingRecord + Internal Admin View

Goal: Per-session billing reconciliation tied to bucket drawdown.

Acceptance criteria:

- On session close: BillingRecord created referencing all HourLedgerEntry rows
  generated during the session.
- BillingRecord includes hourBucketId, billableMinutes (sum of drawdowns),
  total (in customer's currency), tax breakdown.
- Internal admin can view: full BillingRecord history per customer/session,
  HourBucket lifecycle (purchases, drawdowns, refunds, expirations),
  reconciliation dashboard (hours sold vs. hours delivered vs. hours expired).
- Customer can view: their bucket balances, drawdown history per session,
  receipt for each bucket purchase, current month's Maintain rollover status.
- Engineer can view: customer's available buckets and current drawdown rate
  for each active session.

### RG-0604 (NEW): Launch Estimate + 10%-Variance Engine

Goal: Implement engineer-driven Launch project estimation and the variance rule.

Acceptance criteria:

- LaunchEstimate entity: engineer (with AI co-pilot draft) submits
  estimatedHours, system recommends nearest standard bucket size (20/40/60).
- Custom hours outside standard buckets require supervisor approval flag.
- During Launch execution, system tracks actualHoursUsed against estimate.
- If actualHours <= 1.10 * estimatedHours: no customer prompt; engineer absorbs.
- If actualHours > 1.10 * estimatedHours: engineer must submit
  LaunchVarianceRequest with required text justification.
- Customer sees variance request in their session window: Accept (buys delta
  hours via top-up bucket), Revert (use whatever hours remain in current
  bucket), Cancel (project ends; refund per Section 4.5).

### RG-0605 (NEW): "Pass the Baton" Bucket Recommendation Card

Goal: Implement the Stuck → Launch upsell mechanic.

Acceptance criteria:

- Engineer console action: "Recommend Launch" — opens AI co-pilot draft view
  with estimatedHours pre-filled from session context.
- Engineer reviews, adjusts, sends recommendation to customer.
- Customer sees inline card in session window: "Want me to take this to launch?"
  with recommended bucket size and price in their currency.
- On Buy: triggers RG-0602 purchase flow; current Stuck session ends free
  immediately; engineer-customer kickoff session auto-scheduled within 24h.
- "Not yet" dismisses card; engineer can re-pitch once more in same session
  (subsequent attempts blocked with supervisor-visible flag).

## Milestone 7: Memory and Communication

### RG-0701: Session Memory v1

Goal: Store continuity memory.

Acceptance criteria:

- Memory entries can be created at session close.
- Engineer can see project memory.
- Enterprise admin cannot see content.

### RG-0702: Engineer Notes and Follow-Ups

Goal: Separate private notes from customer-visible follow-ups.

Acceptance criteria:

- Engineer private note form.
- Customer follow-up form.
- Customer sees only follow-ups.
- Internal policies enforced.

### RG-0703: Artifacts

Goal: Support links, text notes, files metadata.

Acceptance criteria:

- Customer can add link/text artifact.
- Engineer can view artifacts for assigned sessions.
- File upload can be mocked if storage not configured.

## Milestone 8: Supervisor Console

### RG-0801: Supervisor Dashboard Cards

Goal: Show 10-card monitoring dashboard.

Acceptance criteria:

- Supervisor sees assigned engineers.
- Cards show status, session duration, tool, issue, risk state.
- Red-card state supported.

### RG-0802: AI Risk Placeholder

Goal: Simulate AI risk monitoring.

Acceptance criteria:

- Risk score field exists.
- Card turns red above threshold.
- Supervisor can acknowledge risk.

### RG-0803: Supervisor Actions

Goal: Add intervention actions.

Acceptance criteria:

- Private message event.
- Join requested event.
- Takeover event.
- Specialist assigned event.
- Remove engineer from availability.

### RG-0804: Customer Credit

Goal: Supervisor can credit session time.

Acceptance criteria:

- Supervisor can issue credit record.
- Billing view reflects credit.
- Audit log created.

### RG-0805: Supervisor Notes

Goal: Internal supervisor notes.

Acceptance criteria:

- Notes are internal only.
- Engineer cannot see notes.
- Customer cannot see notes.

## Milestone 9: Enterprise Admin

### RG-0901: Organization Code Onboarding

Goal: Enterprise user can join by organization code.

Acceptance criteria:

- Code validation.
- User linked to organization.
- Audit event created.

### RG-0902: Enterprise Wallet

Goal: Wallet model and dashboard.

Acceptance criteria:

- Enterprise admin sees wallet balance.
- Admin can mock top-up.
- Users can be assigned wallet or individual-card billing mode.

### RG-0903: Spend Limits

Goal: Set limits by user/team/project/month/org.

Acceptance criteria:

- UI to create limits.
- Limit records stored.
- Usage dashboard reflects configured limits.

### RG-0904: Bulk Excel Upload

Goal: Enterprise admin uploads user list.

Acceptance criteria:

- Template documented.
- Upload parses name/email/department/team.
- Preview before import.
- Generates invite records.

### RG-0905: Enterprise Usage Dashboard

Goal: Metadata-only usage visibility.

Acceptance criteria:

- Shows user, email, department, team, project, tool, duration, spend, engineer alias, status.
- Does not show transcript/chat/files/code.
- Supports filters.

### RG-0906: Reporting Export

Goal: Export usage report.

Acceptance criteria:

- CSV export minimum.
- XLSX optional.
- Audit event emitted.

## Milestone 10: Internal Admin

### RG-1001: Internal Admin Global Dashboard

Goal: Platform overview.

Acceptance criteria:

- Active sessions.
- Active users.
- Engineer utilization placeholder.
- Revenue placeholder.
- Enterprise usage summary.

### RG-1002: Organization Code Management

Goal: Relay.green leadership can create codes and discounts.

Acceptance criteria:

- Create organization code.
- Configure discount/no discount.
- Configure valid dates and max users.
- Attach to organization.

### RG-1003: Session Admin View

Goal: Internal ops can inspect sessions subject to policy.

Acceptance criteria:

- Session list.
- Session detail.
- Shows metadata, billing, assignment, audit events.

## Milestone 11: Real Provider Integration

### RG-1101: Real Zoom Integration

Blocked by credentials.

Acceptance criteria:

- Real meeting creation in test account.
- Join URLs stored.
- Recording consent flow connected.

### RG-1102: Real Stripe Integration

Blocked by credentials.

Acceptance criteria:

- Customer payment method.
- Payment authorization/capture.
- Webhook handling.

### RG-1103: Real AI Provider

Blocked by provider/model decision.

Acceptance criteria:

- AI triage calls real model.
- Engineer copilot returns suggestions.
- Supervisor risk placeholder replaced with AI score.

## Immediate Next Ticket

Start with RG-0001 after confirming:

- Create new app in `D:\TGCCORPCODEX`.
- Tech stack: Next.js + TypeScript + Tailwind + Prisma.
- Package manager.
- Demo auth first.
