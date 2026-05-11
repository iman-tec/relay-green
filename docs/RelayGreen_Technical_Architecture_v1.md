# Relay.green Technical Architecture v1

Version: 1.1  
Purpose: Initial architecture, domain model, services, and data model for Claude Code implementation.

> **IMPORTANT — superseding document**: For any conflict between this
> architecture and `RelayGreen_Spec_Decisions_v1.md` (the closeout document
> from the 2026-05-09 brainstorm session), the closeout document is canonical.
> The billing model below has been migrated from per-minute hourly billing to
> a unified hour-bucket ledger.

## 1. Architecture Goal

Build Relay.green as a modular, multi-role, multi-tenant support platform with explicit boundaries between:

- Identity and access.
- Organizations and enterprise accounts.
- Customer projects.
- Engineer profiles.
- Matching.
- Sessions.
- Billing.
- Zoom/live communication.
- AI triage/copilot/monitoring.
- Memory.
- Reporting.
- Audit.

The MVP may run as a modular monolith, but the module boundaries should be clean enough to split into services later.

## 2. Recommended Runtime Shape

### MVP Runtime

- Next.js web application.
- Server actions or API routes for backend operations.
- PostgreSQL database.
- Prisma ORM.
- Mock providers for Zoom, Stripe, and AI until credentials are available.
- Role-based dashboards inside one app.

### Later Runtime

- Separate realtime/session service.
- Queue/presence service.
- Worker service for transcripts, summaries, and pattern extraction.
- Analytics warehouse.
- Mobile and extension clients consuming the same API.

## 3. Roles

System roles:

- CUSTOMER.
- ENGINEER.
- SUPERVISOR.
- ENTERPRISE_ADMIN.
- INTERNAL_ADMIN.

Optional later roles:

- BILLING_ADMIN.
- QUALITY_ADMIN.
- SUPPORT_ADMIN.
- LEGAL_COMPLIANCE_ADMIN.

## 4. Core Domain Entities

### 4.1 User

Represents any authenticated person.

Fields:

- id.
- email.
- displayName.
- role.
- status.
- organizationId nullable.
- createdAt.
- updatedAt.

Important rule:

- A user may have a real identity internally, but customer-facing engineer identity must use alias profile data.

### 4.2 Organization

Represents enterprise customer account.

Fields:

- id.
- name.
- primaryDomain.
- status.
- defaultBillingMode: WALLET or INDIVIDUAL_CARD.
- createdAt.
- updatedAt.

### 4.3 OrganizationCode

Used for enterprise onboarding, accounting, access control, and discounts.

Fields:

- id.
- organizationId.
- code.
- status.
- discountType.
- discountValue.
- validFrom.
- validTo.
- maxUsers.
- metadata.

### 4.4 EnterpriseWallet

Represents central company balance or invoiced credit.

Fields:

- id.
- organizationId.
- balanceAmount.
- currency.
- lowBalanceThreshold.
- status.

### 4.5 EnterpriseUserPolicy

Controls whether a user consumes from wallet or individual card.

Fields:

- id.
- organizationId.
- userId.
- billingMode: WALLET or INDIVIDUAL_CARD.
- monthlyLimitAmount.
- projectLimitAmount.
- status.

### 4.6 Project

Customer-owned work area.

Fields:

- id.
- customerId.
- organizationId nullable.
- name.
- description.
- aiToolTrack.
- productType.
- techStack.
- status.
- createdAt.
- updatedAt.

### 4.7 EngineerProfile

Platform-controlled engineer profile.

Fields:

- id.
- userId.
- aliasName.
- avatarUrl.
- bioSummary.
- languages.
- timezone.
- status.
- supervisorId.
- isExternal.
- customerVisible.
- createdAt.
- updatedAt.

Never expose:

- real name.
- personal email.
- phone.
- LinkedIn.
- external contact details.

### 4.8 EngineerSkill

Searchable skill profile.

Fields:

- id.
- engineerProfileId.
- skillType: AI_TOOL, TECHNOLOGY, PRODUCT_TYPE, FUNCTIONAL_EXPERTISE, LANGUAGE.
- skillName.
- proficiency.
- verified.

### 4.9 EngineerAvailability

Calendar and shift availability.

Fields:

- id.
- engineerProfileId.
- status: AVAILABLE, ASSIGNED, IN_ZOOM, WRAPPING_UP, ON_BREAK, OFFLINE, TRAINING, SHADOWING, ESCALATED.
- startsAt.
- endsAt.
- source: SHIFT, CALENDAR, MANUAL.

### 4.10 SupportSession

Main session object.

Fields:

- id.
- customerId.
- projectId nullable.
- organizationId nullable.
- engineerProfileId nullable.
- supervisorId nullable.
- status.
- aiToolTrack.
- productType.
- issueType.
- functionalExpertiseNeeded.
- urgency.
- language.
- startedAt.
- engineerJoinedAt.
- endedAt.
- freeTrialApplied.
- paidStartedAt nullable.
- billableMinutes.
- totalAmount.
- currency.
- billingStatus.
- createdAt.
- updatedAt.

Session states:

- DRAFT.
- TRIAGE.
- MATCHING.
- ENGINEER_ASSIGNED.
- WAITING_FOR_ZOOM.
- LIVE.
- PAUSED.
- ESCALATED.
- ENDING.
- CLOSED.
- MEMORY_UPDATE.
- REVIEWED.
- BILLED.
- ARCHIVED.

### 4.11 TriageResponse

Stores pre-match and waiting-room context.

Fields:

- id.
- sessionId.
- question.
- answer.
- source: CUSTOMER, AI, SYSTEM.
- createdAt.

### 4.12 SessionArtifact

Files, links, documents, screenshots, voice notes, text notes.

Fields:

- id.
- sessionId.
- uploadedByUserId.
- artifactType.
- url.
- textContent nullable.
- metadata.
- createdAt.

### 4.13 ZoomMeeting

Provider-specific meeting metadata.

Fields:

- id.
- sessionId.
- provider.
- providerMeetingId.
- joinUrlCustomer.
- joinUrlEngineer.
- recordingEnabled.
- recordingConsentCustomerAt nullable.
- recordingConsentEngineerAt nullable.
- recordingUrl nullable.
- status.

### 4.14 RemoteControlGrant

Tracks consent for remote control.

Fields:

- id.
- sessionId.
- customerId.
- engineerProfileId.
- grantedAt.
- revokedAt nullable.
- status.

Rules:

- Only paid users can grant remote control.
- Customer must explicitly grant control.

### 4.15 SessionMemory

Project/session continuity record.

Fields:

- id.
- projectId nullable.
- sessionId.
- memoryType.
- content.
- visibility: CUSTOMER_SAFE, ENGINEER_CONTEXT, INTERNAL_ONLY.
- createdBy.
- createdAt.

### 4.16 EngineerNote

Private engineer notes.

Fields:

- id.
- sessionId.
- engineerProfileId.
- note.
- visibility: PRIVATE_ENGINEER, INTERNAL_AUTHORIZED.
- createdAt.

### 4.17 CustomerFollowUp

Customer-visible follow-up from engineer.

Fields:

- id.
- sessionId.
- engineerProfileId.
- content.
- attachmentUrl nullable.
- createdAt.

### 4.18 SupervisorEvent

Tracks supervisor intervention.

Fields:

- id.
- sessionId.
- supervisorId.
- eventType: AI_RISK_FLAG, PRIVATE_MESSAGE, JOIN_REQUESTED, JOINED, TAKEOVER, SPECIALIST_ASSIGNED, CREDIT_APPROVED, ENGINEER_REMOVED.
- details.
- createdAt.

### 4.19 SupervisorNote

Internal supervisor note.

Fields:

- id.
- sessionId nullable.
- engineerProfileId nullable.
- supervisorId.
- note.
- purpose: TRAINING, PERFORMANCE, INCIDENT, GENERAL.
- createdAt.

### 4.20 BillingRecord

Session billing calculation under the hour-bucket ledger model. Each session
that consumes paid time produces a BillingRecord that references the
HourLedgerEntry rows it generated.

Fields:

- id.
- sessionId.
- customerId.
- organizationId nullable.
- hourBucketId nullable (which bucket was drawn down; null only for free first session).
- billingSource: INDIVIDUAL_CARD, ENTERPRISE_WALLET, INVOICE, FREE_TRIAL.
- ratePerHour (EUR-equivalent at time of bucket purchase).
- currency.
- freeMinutesApplied.
- billableMinutes (per-minute drawdown from bucket).
- subtotal.
- discountAmount.
- taxAmount.
- total.
- status.
- createdAt.

Note: the `minimumMinutesApplied` field from v1.0 is removed; the 20-minute
minimum is no longer part of the commercial model.

### 4.23 HourBucket (NEW)

Represents a customer's prepaid block of engineer hours.

Fields:

- id.
- customerId.
- organizationId nullable.
- engagementType: STUCK, LAUNCH, MAINTAIN.
- bucketSize (hours: 5 / 10 / 20 / 40 / 60 / 50 / 100 / custom).
- pricePaid (in customer's locked currency at time of purchase).
- currency.
- effectiveRatePerHour (= pricePaid / bucketSize).
- hoursRemaining (decremented by drawdown).
- launchProjectId nullable (for LAUNCH buckets).
- purchasedAt.
- expiresAt (12 months STUCK, 6 months LAUNCH, end-of-next-month MAINTAIN with 1-month rollover).
- status: ACTIVE, EXHAUSTED, EXPIRED, REFUNDED, PARTIALLY_REFUNDED.
- stripePaymentIntentId.
- refundEligibility: FULL, PRORATED, NONE.
- createdAt.
- updatedAt.

### 4.24 HourLedgerEntry (NEW)

Per-minute drawdown record.

Fields:

- id.
- hourBucketId.
- sessionId.
- customerId.
- engineerProfileId.
- minutesDrawn (decimal; per-second internal, per-minute display).
- ratePerHour (matches HourBucket.effectiveRatePerHour).
- amountDrawn (= minutesDrawn / 60 * ratePerHour, EUR-equivalent).
- entryType: DRAWDOWN, FREE_TRIAL, CREDIT_REVERSAL, ADJUSTMENT.
- createdAt.

### 4.25 LaunchEstimate (NEW)

Tracks engineer's hour estimate for Launch buckets and the 10% variance rule.

Fields:

- id.
- customerId.
- launchProjectId.
- engineerProfileId.
- estimatedHours.
- bucketRecommendedSize (20 / 40 / 60).
- aiCopilotDraftId.
- supervisorApprovalRequired (true if custom hours outside standard buckets).
- supervisorApprovedByUserId nullable.
- status: DRAFT, RECOMMENDED, ACCEPTED, EXPIRED.
- createdAt.
- updatedAt.

### 4.26 LaunchVarianceRequest (NEW)

Records engineer requests for additional hours beyond the 10% variance window.

Fields:

- id.
- launchEstimateId.
- engineerProfileId.
- requestedAdditionalHours.
- justification (text, required).
- supervisorReviewedByUserId nullable.
- customerDecision: PENDING, ACCEPTED, REJECTED, REVERTED_TO_REMAINING_HOURS.
- createdAt.
- decidedAt.

### 4.28 SessionInterruption (NEW)

Tracks all session abnormalities (dropouts, no-shows, late joins, customer
drop-outs) for billing, reliability SLA reporting, and per-engineer quality
metrics.

Fields:

- id.
- sessionId.
- interruptionType: PLATFORM_FAULT_EMBED, ZOOM_OUTAGE, ENGINEER_NO_SHOW, ENGINEER_LATE_JOIN, ENGINEER_VERY_LATE, CUSTOMER_DROPOUT, CUSTOMER_NETWORK_OUTAGE, BOTH_RECONNECTED, NEVER_RECOVERED.
- startedAt.
- endedAt nullable.
- minutesAffected (decimal).
- billingImpact: CREDIT_TO_BUCKET, REFUND_REQUESTED, NO_IMPACT, MINUTES_CONSUMED.
- bucketCreditAmount nullable (in EUR-equivalent).
- refundRecordId nullable.
- detectedBy: PLATFORM_AUTOMATIC, ENGINEER_FLAGGED, CUSTOMER_REPORTED, SUPERVISOR_DETERMINED.
- resolutionNotes nullable.
- engineerNoShowCounterIncremented (boolean — true if this interruption increments the engineer's 30-day rolling no-show counter per O2.c).
- createdAt.

Rules per O2:

- PLATFORM_FAULT_EMBED, ENGINEER_NO_SHOW, ENGINEER_VERY_LATE → minutes returned to bucket; €0 customer charge
- ZOOM_OUTAGE with reconnect <5 min → drawdown paused; outage minutes returned
- ZOOM_OUTAGE with no reconnect → drawdown stops at dropout; outage minutes returned
- ENGINEER_LATE_JOIN (90s–5min) → drawdown starts at actual join; logged for engineer stat tracking
- CUSTOMER_DROPOUT, CUSTOMER_NETWORK_OUTAGE → drawdown stops at dropout; pre-dropout minutes consumed normally
- Customer dropout in first 60s → engineer can flag for €0 grace; supervisor reviews if pattern emerges
- Engineer no-show counter resets every 30 days; consequences per O2.c

### 4.27 EngineerCompensationProfile (NEW)

Tracks each engineer's compensation arrangement and platform-side bonus
parameters. Salary itself is held in Gateway HR systems and is not stored
on the platform.

Fields:

- id.
- engineerProfileId.
- employmentType: GATEWAY_SALARIED, EXTERNAL_CONTRACTOR.
- bonusPercentage (decimal; default 3.00 for GATEWAY_SALARIED; null for EXTERNAL_CONTRACTOR).
- externalCommissionPercentage (decimal; default 60.00 for EXTERNAL_CONTRACTOR; null for GATEWAY_SALARIED).
- paymentCurrency.
- payrollVendor (e.g., "gateway-internal", "stripe-connect", or specific provider).
- stripeConnectAccountId nullable (only for EXTERNAL_CONTRACTOR).
- effectiveFrom.
- effectiveTo nullable.
- overrideReason nullable (text — recorded when bonusPercentage differs from global default).
- overrideExpiresAt nullable.
- createdAt.
- updatedAt.

Rules:

- For GATEWAY_SALARIED: monthly bonus = SUM(HourLedgerEntry.amountDrawn) for the engineer in the month, in EUR-equivalent, multiplied by bonusPercentage / 100.
- For EXTERNAL_CONTRACTOR: payout = SUM(HourLedgerEntry.amountDrawn) for the engineer in the period, multiplied by externalCommissionPercentage / 100; paid via Stripe Connect on weekly cadence.
- Free-trial drawdown entries (entryType = FREE_TRIAL) have amountDrawn = 0, so contribute €0 to bonus base.
- Cancelled / no-show sessions generate no HourLedgerEntry, so contribute €0.
- Override (per-engineer bonusPercentage other than the global default) requires overrideReason and overrideExpiresAt; changes are written to AuditLog.
- Global default bonusPercentage is held in a platform configuration table and tunable from the Internal Admin console.

### 4.21 CreditRecord

Customer credit issued by supervisor/admin.

Fields:

- id.
- sessionId.
- customerId.
- approvedByUserId.
- amount.
- minutes.
- reason.
- status.
- createdAt.

### 4.22 AuditLog

Required for sensitive operations.

Fields:

- id.
- actorUserId.
- action.
- entityType.
- entityId.
- metadata.
- createdAt.

## 5. Service Boundaries

### 5.1 Identity Service

Responsibilities:

- Login.
- Role resolution.
- Session user context.
- RBAC enforcement.

### 5.2 Organization Service

Responsibilities:

- Organization creation.
- Organization code validation.
- Enterprise user association.
- Wallet policy.
- Invite management.

### 5.3 Matching Service

Responsibilities:

- Match customer session to engineer.
- Prefer same engineer continuity.
- Use AI tool, product type, functional expertise, language, availability, supervisor pod, and performance indicators.
- Return best available engineer.

### 5.4 Session Orchestration Service

Responsibilities:

- Own session state transitions.
- Enforce valid lifecycle movement.
- Create triage records.
- Attach engineer/supervisor.
- Coordinate Zoom and billing events.

### 5.5 Billing Service

Responsibilities:

- Free 10-minute rule (first session per customer-lifetime).
- Payment gate after free time (10-min cliff UX per Spec Decisions C5).
- Hour-bucket ledger: purchase, drawdown, expiration, rollover, refund.
- Multi-currency rate cards (EUR/USD/GBP/INR) via Stripe Multi-Currency Pricing.
- Stripe Tax for VAT/GST/sales-tax calculation.
- Launch 10%-variance rule and LaunchVarianceRequest workflow.
- Enterprise wallet versus individual card source.
- Discount code calculation.
- Credit application.

### 5.6 Zoom Service

Responsibilities:

- Create meeting.
- Store join URLs.
- Track recording consent.
- Store recording link.
- Abstract provider details.

### 5.7 AI Service

Responsibilities:

- AI triage.
- Engineer copilot.
- Supervisor monitoring.
- Risk scoring.
- Memory generation assistance.

MVP can mock AI responses first.

### 5.8 Memory Service

Responsibilities:

- Store session/project continuity.
- Enforce visibility.
- Retrieve customer/project history for engineer.
- Keep enterprise admin content-blind.

### 5.9 Reporting Service

Responsibilities:

- Enterprise usage reports.
- Internal admin dashboards.
- Supervisor/team metrics.
- Export later.

### 5.10 Audit Service

Responsibilities:

- Log sensitive events.
- Preserve operational traceability.

## 6. RBAC Matrix

| Capability | Customer | Engineer | Supervisor | Enterprise Admin | Internal Admin |
|---|---:|---:|---:|---:|---:|
| Create project | Yes | No | No | No | Yes |
| Request support | Yes | No | No | No | Yes |
| View own session content | Yes | No | No | No | Yes with policy |
| View assigned customer memory | No | Yes | Yes for pod | No | Yes with policy |
| View engineer real identity | No | Self only | Yes | No | Yes |
| View enterprise usage metadata | Own only | No | No | Yes | Yes |
| View transcripts | Own if enabled | Assigned | Supervised sessions | No | Yes with policy |
| View recordings | Own if enabled | Assigned if permitted | Supervised sessions if permitted | No | Yes with policy |
| Credit customer time | No | No | Yes | No | Yes |
| Manage organization code | No | No | No | Limited | Yes |
| Manage engineer availability | No | Self | Pod | No | Yes |
| Remove engineer from availability | No | No | Yes | No | Yes |
| View supervisor notes | No | No by default | Own notes | No | Yes |

## 7. Billing Logic v1 (hour-bucket ledger)

Rules:

- Customers buy prepaid hour-buckets; sessions draw down per-minute against
  an active bucket.
- First customer-lifetime session gets up to 10 free minutes (no bucket required).
- Free minutes expire after the first session, even if less than 10 used.
- After free-trial, every session must draw down from an active bucket.
- Customer must own at least one ACTIVE bucket of the matching engagement
  type, OR an enterprise wallet covering the engagement, before a paid session
  can begin.
- Per-minute drawdown rate = HourBucket.effectiveRatePerHour (= pricePaid /
  bucketSize). This already accounts for volume discounts.
- Supervisor/admin credit creates a CREDIT_REVERSAL HourLedgerEntry that
  effectively returns minutes to the bucket.
- Bucket expiration: STUCK 12 months, LAUNCH 6 months, MAINTAIN end-of-next-month.
- The 20-minute minimum from v1.0 is REMOVED.

Pseudo logic:

```text
if customer.hasNeverUsedFreeTrial:
  allow session without payment method
  drawdown_meter = 0
  on every minute:
    drawdown_meter += 1
    if drawdown_meter <= 10:
      record FREE_TRIAL entry; total cost so far = 0
    else:
      // 10-minute cliff reached — see C5 cliff UX
      if customer has card on file:
        if customer has active matching bucket:
          start drawdown from bucket
        else:
          prompt customer to buy bucket inline
          drawdown paused until purchase confirmed
      else:
        prompt for card; 60s grace; engineer can extend +2 min once
  on session close:
    mark free trial consumed
else:
  require active matching bucket OR enterprise wallet coverage before session start
  on every minute (per-second internal): bucket.hoursRemaining -= 1/60
  on bucket exhaustion: customer offered top-up; session continues only if bucket purchased
  generate BillingRecord referencing all HourLedgerEntry rows for this session

bucket_purchase(customer, engagementType, size, currency):
  price = locked_rate_card[currency][engagementType][size]
  charge via Stripe Multi-Currency Pricing
  Stripe Tax computes VAT/GST/sales-tax per region
  on success: create HourBucket with hoursRemaining = size, expiresAt per type

launch_variance_check(launchEstimate, hoursActuallyUsed):
  variance = (hoursActuallyUsed - launchEstimate.estimatedHours) / launchEstimate.estimatedHours
  if variance <= 0.10:
    engineer absorbs silently; no customer charge
  else:
    create LaunchVarianceRequest with justification
    customer accepts (buys delta), reverts to remaining hours, or cancels
    if accepted: new HourBucket created for delta hours
```

## 8. Matching Logic v1

Priority:

1. Same engineer previously attached to project/customer and available.
2. AI tool track match.
3. Product type match.
4. Functional expertise match.
5. Language match.
6. Enterprise priority.
7. Availability.
8. Supervisor pod load.
9. Supervisor-reviewed performance/reliability indicators.

Fallback:

- Assign best available qualified engineer.
- Customer may request another engineer.
- Supervisor may reassign if engineer cannot solve.

## 9. Audit Events v1

Audit these actions:

- User login.
- Organization code use.
- Enterprise wallet change.
- Spend limit change.
- Engineer assignment.
- Session state change.
- Recording consent.
- Remote control grant/revoke.
- Supervisor join.
- Supervisor takeover.
- Customer credit.
- Engineer removed from availability.
- Enterprise export.
- Admin access to session content.

## 10. MVP API / Server Actions

Initial endpoints/actions:

- createProject.
- startSupportRequest.
- saveTriageResponse.
- matchEngineer.
- assignEngineer.
- createZoomMeeting.
- updateSessionState.
- startPaidSession.
- calculateBilling.
- closeSession.
- createMemoryEntry.
- createEngineerNote.
- createCustomerFollowUp.
- createSupervisorEvent.
- issueCredit.
- validateOrganizationCode.
- uploadEnterpriseUsers.
- createInviteLinks.
- getEnterpriseUsage.

## 11. UI Routes

Suggested routes:

```text
/login
/customer
/customer/projects
/customer/projects/[projectId]
/customer/sessions/[sessionId]
/engineer
/engineer/sessions/[sessionId]
/supervisor
/supervisor/sessions/[sessionId]
/enterprise
/enterprise/users
/enterprise/usage
/enterprise/wallet
/admin
/admin/sessions
/admin/engineers
/admin/organizations
```

## 12. First Database Migration

First migration should include:

- users.
- organizations.
- organization_codes.
- enterprise_wallets.
- enterprise_user_policies.
- projects.
- engineer_profiles.
- engineer_skills.
- engineer_availability.
- support_sessions.
- triage_responses.
- session_artifacts.
- zoom_meetings.
- remote_control_grants.
- session_memories.
- engineer_notes.
- customer_follow_ups.
- supervisor_events.
- supervisor_notes.
- billing_records.
- credit_records.
- audit_logs.

## 13. Build Readiness

Codex can start building after these setup decisions:

1. Confirm app stack: Next.js + TypeScript + PostgreSQL + Prisma.
2. Confirm whether to create a new app in this workspace.
3. Confirm package manager: npm, pnpm, or yarn.
4. Confirm whether auth starts as local seeded demo auth or production auth.

Recommended for fastest start:

- New Next.js app.
- TypeScript.
- npm.
- Prisma.
- PostgreSQL-ready schema with local SQLite fallback only if PostgreSQL is unavailable.
- Demo auth first, production auth later.
