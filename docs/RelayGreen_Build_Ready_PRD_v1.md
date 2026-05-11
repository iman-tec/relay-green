# Relay.green Build-Ready PRD v1

Version: 1.1  
Source: Relay.green brainstorm, board deck, relay.green concept deck, four-track requirements interview, and 2026-05-09 spec decisions session.  
Purpose: Product and engineering specification for building the Relay.green MVP and phased enterprise platform.

> **IMPORTANT — superseding document**: For any conflict between this PRD and
> `RelayGreen_Spec_Decisions_v1.md` (the closeout document from the 2026-05-09
> brainstorm session), the closeout document is canonical. The closeout
> document also captures decisions that this PRD did not previously address
> (currency strategy, tax handling, design system, accent neutralization, the
> 10-min cliff UX, recording consent flow, AI risk-scoring, triage
> questionnaire, engineer skill taxonomy, and the unified hour-bucket
> commercial model that replaces the original 3-leg pricing).

## 1. Executive Summary

Relay.green is a real-time human engineering support platform for nontechnical and semi-technical users building software with AI tools.

The customer promise:

> Click the green dot and get a qualified software engineer within 90 seconds.

Relay.green exists because AI development tools have made software creation accessible to millions of non-engineers, but those users still get stuck when they need to understand technical concepts, integrate systems, deploy to production, or maintain what they built.

The product combines:

- On-demand engineer support.
- Zoom-first live assistance.
- AI triage and AI copilot support.
- Skill-based engineer matching.
- Supervisor monitoring.
- Customer/project memory.
- Enterprise usage governance.
- Fixed-price launch services.
- Monthly maintenance services.

The strategic moat is continuity: the same engineer should ideally support the customer from first unblock through launch and maintenance.

## 2. Product Tracks

Relay.green has five login surfaces:

1. Customer.
2. Engineer.
3. Supervisor.
4. Enterprise administrator.
5. Relay.green internal administrator.

The four commercial/user-facing tracks are Customer, Engineer, Supervisor, and Enterprise Administrator. The Relay.green internal admin layer controls the whole business.

## 3. Commercial Model

> Section 3 has been replaced by the unified **hour-bucket commercial model**
> defined in `RelayGreen_Spec_Decisions_v1.md` Section B. Summary repeated
> here for convenience; the closeout document is canonical.

### 3.1 The unified primitive

Relay.green sells **prepaid hour-buckets** of qualified engineer time, applied
across three engagement contexts. The 20-minute minimum, fixed-price Leg-2 SKUs,
and per-month retainer SKUs in earlier drafts of this PRD are **obsolete**.

| Engagement context | Bucket sizes (hrs) | Cadence |
|---|---|---|
| **Get unstuck** | 5 · 10 | one-time, top-up anytime |
| **Get it live** | 20 · 40 · 60 | one-time per project |
| **Keep it running** | 50/mo · 100/mo · custom | monthly recurring |

### 3.2 Pricing ladder (EUR base; mirror cards in USD/GBP/INR per Section C3)

| Bucket | €/hr | Bucket price |
|---|---:|---:|
| 5 hrs | 39 | 195 |
| 10 hrs | 37 | 370 |
| 20 hrs | 34 | 680 |
| 40 hrs | 32 | 1,280 |
| 60 hrs | 30 | 1,800 |
| 50 hrs/mo | 28 | 1,400/mo |
| 100 hrs/mo | 26 | 2,600/mo |
| 100+ hrs/mo | from 24 | quote |

The €39/hr no-discount anchor preserves every existing decision that referenced
this rate. Larger buckets earn a per-hour discount — natural upsell pressure.

### 3.3 First-time free trial (preserved)

- First 10 minutes free, once per customer-lifetime
- Customer can begin first session without payment method
- Free minutes expire after first session; continuing past minute 10 requires
  payment method per the cliff UX in `RelayGreen_Spec_Decisions_v1.md` Section C5

### 3.4 The 10% variance rule (Launch tier only)

Engineer estimates Launch project hours at quote time (using AI co-pilot draft).
Customer buys the matching bucket. Engineer may exceed the estimate by up to
**10%** absorbed silently. Beyond 10%, engineer submits a written justification
+ delta-bucket request through the platform; customer accepts (paying for the
extra hours), reverts to remaining-hours hand-off, or cancels. The variance
rule does not apply to Stuck (no estimation) or Maintain (recurring).

### 3.5 Refund policy

| Bucket type | Refund posture |
|---|---|
| Stuck | Refundable at full €/hr on unused hours, less Stripe fees |
| Launch | Refundable at full €/hr if project not started; pro-rated if partially used and cancellation is for cause; never refundable for hours already delivered |
| Maintain | Non-refundable once charged; customer cancels future months but current month's hours stand |

### 3.6 Hour expiration & rollover

| Bucket type | Expiration |
|---|---|
| Stuck (5 / 10 hrs) | 12 months from purchase |
| Launch (20 / 40 / 60 hrs) | 6 months from purchase, tied to a launch project |
| Maintain (monthly) | One-month rollover; expires at end of following month |

### 3.7 Engineer continuity across buckets

Same engineer is the default across Stuck → Launch → Maintain transitions
whenever the same engineer is available, preserving the moat. If the
continuity engineer is unavailable >2 days, supervisor allocates a peer with
full project memory access; original engineer resumes when back.

### 3.8 The "Pass the baton" mechanic (preserved, simplified)

The board-deck upsell narrative survives — expressed as "buy this Launch
hour-pack so I can take it to production for you" instead of "accept this
fixed-price quote." Engineer composes a Launch hour-bucket recommendation
through AI co-pilot (estimated hours + bucket size). Customer sees a card
mid-session: *"Want me to take this to launch? Same engineer. Estimated 20
hours. Buy 20-hour Launch bucket — €680."* Three buttons: Buy bucket · See
estimate detail · Not yet. On Buy: 100% upfront payment, current Stuck
session ends free, kickoff scheduled within 24h.

## 4. MVP Scope

The MVP should prove the core promise before overbuilding the full ecosystem.

### 4.1 MVP Must Have

- Customer web app with Claude-style interface.
- Green-dot urgent request button in web app.
- AI triage before and during waiting period.
- Zoom-first live session flow.
- Engineer console.
- Supervisor console with 10-card monitoring model.
- AI risk flagging for supervisor cards.
- Skill-based matching engine v1.
- Customer/project/session memory.
- Hour-bucket ledger billing (per Section 3 above and `RelayGreen_Spec_Decisions_v1.md` Section B).
- First 10-minute free trial once per customer.
- Payment method gate after free 10 minutes (per cliff UX in Spec Decisions Section C5).
- Multi-currency rate cards (EUR/USD/GBP/INR) via Stripe Multi-Currency Pricing.
- Stripe Tax for VAT/GST/sales-tax across regions.
- Recording off by default with consent required from both sides.
- Remote control only for paid users with customer consent.
- Enterprise organization code support.
- Enterprise wallet and employee-card billing model.
- Enterprise metadata-only usage dashboard.
- Internal admin console.
- AI copilot v1 for engineer.

### 4.2 MVP Should Have

- Browser extension after web MVP.
- Calendar booking for same engineer.
- Bulk enterprise user upload by Excel.
- Batch invite links.
- Supervisor customer-credit controls.
- Engineer alias profile management.
- Recording link storage where enabled.
- Platform-contained text, voice-note, document, link, and file communication.

### 4.3 Post-MVP / Phase 2

- Desktop taskbar green-dot launcher.
- Customer mobile app.
- Engineer mobile app.
- Deeper AI tool integrations.
- IDE/repository integrations.
- Advanced enterprise hierarchy.
- SCIM.
- Advanced reporting API.
- Built-in video stack if Zoom becomes limiting.
- Real-time accent normalization.

## 5. Customer Track

### 5.1 Customer Profile

Customers are nontechnical or semi-technical builders using AI tools to create:

- Websites.
- Web apps.
- Mobile apps.
- Business applications.
- Internal tools.
- Dashboards.
- Automations.
- AI-powered software.

### 5.2 Supported AI Tool Tracks

First phase priority:

- Claude.
- Gemini.
- Copilot.
- Lovable.
- Replit.
- Cursor.

Longer-term tracks:

- ChatGPT.
- v0.
- Bolt.
- Other emerging AI development platforms.

### 5.3 Customer Flow

1. Customer clicks the green dot.
2. Customer selects or creates a project.
3. AI asks routing questions.
4. Customer confirms AI tool, product type, problem type, functional expertise required, urgency, and language.
5. 90-second countdown starts.
6. AI continues asking useful questions while the customer waits.
7. Matching engine assigns the best available engineer.
8. Customer sees engineer alias, face/avatar, skill summary, and join progress.
9. Zoom opens by default.
10. Customer interacts via chat, audio, video, screen share, and optional remote control.
11. Customer sees timer and billing state.
12. If first free 10 minutes expire, payment method is required to continue.
13. Paid support begins by drawing down from an active hour-bucket (or via inline bucket purchase if none exists).
14. Customer can request another engineer if uncomfortable.
15. Future sessions prioritize the same engineer.

### 5.4 Customer Communication

All communication must remain inside Relay.green-controlled channels.

Supported communication:

- Zoom.
- Platform chat.
- Text notes.
- Voice notes.
- File uploads.
- Documents.
- Screenshots.
- Links.
- Step-by-step instructions.

No mandatory post-session summary is required for the customer. Engineer-submitted follow-ups can be shared when useful.

## 6. Engineer Track

### 6.1 Engineer Supply

Engineers may be Gateway/internal engineers or approved external engineers later.

Every engineer must:

- Be registered on Relay.green.
- Have structured skill profile.
- Work inside Relay.green channels.
- Be supervised by a Relay.green supervisor.
- Be mapped by AI tool expertise, product experience, technical skills, language, availability, and shift.

### 6.2 Customer-Facing Identity

Customers see:

- Engineer alias/dummy name.
- Profile photo or avatar.
- Skill summary.
- Language.
- Relevant expertise.
- Availability.

Customers must not see:

- Real full name.
- Personal email.
- LinkedIn.
- Phone number.
- External contact information.

### 6.3 Engineer Console

Core features:

- Login.
- Availability and shift status.
- Assigned sessions.
- Zoom launch/join.
- Customer/project memory.
- Triage context.
- Uploaded artifacts.
- AI copilot side panel.
- Private notes.
- Customer-visible follow-up composer.
- Calendar.
- Session history.
- Escalate to supervisor.

### 6.4 Engineer AI Copilot

The engineer AI copilot should:

- Listen to session context where permitted.
- Read triage inputs.
- Retrieve project memory.
- Suggest likely causes.
- Suggest responses.
- Explain technical concepts in simple language.
- Surface previous patterns.
- Help draft follow-ups.
- Help draft launch or maintenance recommendations.
- Flag risks.

### 6.5 Engineer Continuity

Same-engineer continuity is the preferred default.

If the same engineer is unavailable:

- Customer can book from the same engineer's calendar.
- Customer can request another engineer for faster support.
- New engineer receives prior project memory.
- Original engineer later sees what the interim engineer did.

### 6.6 Unsolved Issue Flow

If engineer cannot solve:

1. Engineer escalates to supervisor.
2. Supervisor reviews session.
3. Supervisor can allocate another engineer or specialist.
4. Supervisor can credit time back to customer if the session was not useful.

## 7. Supervisor Track

### 7.1 Supervisor Role

A supervisor normally manages approximately 10 engineers in a shift. Relay.green leadership can adjust this ratio.

Supervisor duties:

- Monitor live sessions.
- Watch AI risk flags.
- Review live transcripts/audio/video where permitted.
- Message engineer privately.
- Join visibly after customer permission.
- Take over sessions.
- Assign specialists.
- Remove engineer from availability.
- Credit customer time.
- Create internal notes.
- Support training and performance management.

### 7.2 Supervisor Dashboard

Dashboard uses live engineer cards.

Each card should show:

- Engineer alias.
- Engineer status.
- Customer alias or safe identifier.
- Session duration.
- AI tool track.
- Product type.
- Issue type.
- Sentiment.
- AI risk flag.
- Escalation state.
- Private message action.
- Join/takeover action.
- Credit action where authorized.

### 7.3 AI Monitoring

An AI monitoring agent continuously evaluates live sessions.

If risk is detected:

- Engineer card turns red.
- Supervisor is prompted to review.
- Supervisor can take action.

Risk signals:

- Customer frustration.
- Long silence.
- Repeated confusion.
- Engineer uncertainty.
- Unresolved technical loop.
- Billing complaint.
- Security-sensitive content.
- Credential/secrets issue.
- Low confidence from AI copilot.
- Session taking too long.

### 7.4 Supervisor Privacy and Consent

- Monitoring is disclosed in general terms and conditions.
- Supervisor can monitor internally under platform quality policy.
- If supervisor joins visibly, customer permission is required.
- Supervisor notes are internal admin only unless explicitly shared through a coaching workflow.

## 8. Enterprise Administrator Track

### 8.1 Enterprise Onboarding

Enterprise users can join by:

- Company email plus organization code.
- Invite link.
- Bulk invite from Excel upload.

Enterprise admin can upload an Excel file with:

- User name.
- Email.
- Department.
- Team.
- Optional project or budget group.

After registration, users can start immediately if:

- They are covered by enterprise wallet.
- Or they are expected to use an individual card.

No additional per-user admin approval is required in the initial model.

### 8.2 Organization Codes

Organization codes can support:

- Access control.
- Accounting.
- Discounts.

Relay.green leadership can create organization codes and configure:

- Discount or no discount.
- Discount percentage/value.
- Eligible users.
- First few users.
- From-date/to-date.
- Accounting behavior.

### 8.3 Enterprise Billing

Enterprise billing can be:

- Central company wallet/invoice.
- Individual employee cards.
- Configurable mix by user.

Enterprise admin can:

- Fund wallet.
- Allocate users to wallet.
- Exclude users from wallet.
- Require certain users to pay by card.
- Track usage against wallet.

### 8.4 Budget Controls

Enterprise admin can set spend limits by:

- User.
- Team.
- Department.
- Project.
- Month.
- Entire organization.

### 8.5 Enterprise Visibility

Enterprise admin can see live and historical metadata only.

Allowed metadata:

- User name.
- User email.
- Department.
- Team.
- Project name.
- AI tool track.
- Session duration.
- Spend.
- Engineer alias.
- Date/time.
- Session status.
- Recording enabled yes/no.
- Wallet or individual-card billing source.

Enterprise admin cannot see:

- Transcripts.
- Recordings.
- Chat content.
- Uploaded files.
- Code.
- Detailed engineering notes.

### 8.6 Enterprise Reporting

Required reports:

- Monthly spend.
- User usage.
- Department usage.
- Team usage.
- Project usage.
- Active users.
- Top AI tools.
- Launch projects.
- Maintenance contracts.
- Budget remaining.

Initial enterprise hierarchy:

- One enterprise admin login can manage the whole account.
- Multi-level hierarchy can be added later.

## 9. Internal Admin Track

Relay.green internal admins manage:

- Global dashboard.
- Users.
- Enterprises.
- Organization codes.
- Discounts.
- Engineers.
- Supervisor pods.
- Active sessions.
- Billing.
- Refunds/credits.
- Session quality analytics.
- Pattern library review.
- Compliance.
- Audit logs.
- Incidents.

Leadership dashboards should show:

- Active users.
- Active sessions.
- Revenue.
- Enterprise usage.
- Individual customer usage.
- Engineer utilization.
- Supervisor/team metrics.
- Credit rates.
- Escalation rates.
- Training needs.

## 10. Core Platform Modules

### 10.1 Frontends

- Customer web app.
- Browser extension.
- Desktop green-dot launcher.
- Customer mobile app.
- Engineer mobile app.
- Engineer console.
- Supervisor console.
- Enterprise admin console.
- Internal admin console.

### 10.2 Backend Services

- Identity and access service.
- Organization and tenant service.
- Engineer profile service.
- Matching service.
- Session orchestration service.
- Zoom integration service.
- Realtime/chat service.
- Billing service.
- Wallet service.
- Discount/code service.
- Calendar service.
- AI triage service.
- Engineer AI copilot service.
- Supervisor AI monitoring service.
- Memory service.
- Pattern library service.
- Notification service.
- Reporting service.
- Audit log service.

### 10.3 Data Stores

- PostgreSQL for transactional data.
- Redis for queues, presence, and realtime state.
- Object storage for files and artifacts.
- Vector database or pgvector for memory and pattern retrieval.
- Analytics warehouse for usage and performance reporting.

### 10.4 Third-Party Integrations

- Zoom.
- Stripe or equivalent payment provider.
- Calendar provider.
- Email/SMS/WhatsApp notification provider.
- SSO providers later.
- AI model providers.
- Excel import.
- GitHub/GitLab/Bitbucket later.

## 11. Roles and Permissions

### 11.1 Customer

Can:

- Create projects.
- Request support.
- Use free first session.
- Add payment.
- Join Zoom.
- Share files/links/notes.
- Grant remote control.
- Enable recording with consent.
- View own sessions, artifacts, billing, and engineer follow-ups.

Cannot:

- See engineer real identity.
- Contact engineer outside platform.
- Access internal notes.

### 11.2 Engineer

Can:

- View assigned customer/project context.
- Join sessions.
- Use AI copilot.
- Write private notes.
- Submit customer-visible follow-ups.
- Escalate to supervisor.
- Manage calendar/availability.

Cannot:

- Expose personal contact details.
- Access unrelated customer data.
- View supervisor internal notes by default.

### 11.3 Supervisor

Can:

- Monitor assigned engineer sessions.
- See live transcripts/audio/video where permitted.
- Receive AI alerts.
- Message engineer privately.
- Join visibly after customer permission.
- Take over.
- Assign specialist.
- Remove engineer from availability.
- Credit customer time.
- Create internal notes.

### 11.4 Enterprise Admin

Can:

- Manage organization code.
- Upload users.
- Send invites.
- Manage wallet and card-policy allocation.
- Set spend limits.
- View live and historical usage metadata.
- Export reports.

Cannot:

- View transcripts, recordings, chats, code, files, or detailed engineering notes.

### 11.5 Internal Admin

Can manage the full operating platform subject to RBAC, audit logs, and compliance policies.

## 12. Session Lifecycle

States:

1. Draft.
2. Triage.
3. Matching.
4. Engineer assigned.
5. Waiting for Zoom.
6. Live.
7. Paused.
8. Escalated.
9. Ending.
10. Closed.
11. Memory update.
12. Reviewed.
13. Billed.
14. Archived.

Key events:

- Green-dot click.
- Triage started.
- Matching started.
- Engineer assigned.
- Zoom meeting created.
- Engineer joined.
- Customer joined.
- Free 10 minutes reached.
- Payment method added.
- Paid session started.
- Remote control requested/granted/ended.
- Recording requested/enabled/disabled.
- Supervisor alert fired.
- Supervisor joined.
- Session ended.
- Billing finalized.
- Memory updated.

## 13. Design Direction

Customer UI should feel close to Claude-style AI workspaces:

- Calm.
- Minimal.
- Left sidebar for projects and sessions.
- Central conversation/session area.
- Engineer presence visible.
- Clear timer and billing.
- Clear green-dot action.
- No clutter.

Supervisor UI should feel like an operations control room:

- 10 live cards.
- Red risk states.
- Fast drill-down.
- Live transcript/audio/video panel.
- AI alert panel.
- Private engineer messaging.
- Takeover controls.

Enterprise UI should feel like a usage and spend dashboard:

- Dense but readable.
- Filters by user/team/project/date.
- Wallet and budget visibility.
- Exportable reports.
- No access to sensitive session content.

## 14. Compliance and Trust

Required:

- Multi-tenant architecture.
- Strong tenant isolation.
- RBAC.
- Audit logs.
- Encryption in transit and at rest.
- Secrets redaction.
- Recording consent.
- GDPR readiness.
- DPDP readiness.
- SOC 2 roadmap.
- Data retention policies.
- Data deletion workflows.
- Incident response.
- IP ownership terms.
- Support scope terms.
- Supervisor monitoring disclosure.

## 15. Open Decisions Before Build

These must be resolved before implementation begins:

1. Exact MVP tool tracks: confirm six-track first phase or reduce for MVP.
2. Exact pre-match questionnaire.
3. Exact engineer skill taxonomy.
4. Payment provider and currency/tax rules.
5. Wallet top-up, low-balance, and failed-payment flow.
6. Zoom failure and late-engineer billing policy.
7. Recording consent UX.
8. Supervisor join permission UX.
9. AI red-card risk scoring v1.
10. Excel upload template.
11. Report export formats.
12. Data retention periods.
13. First infrastructure target: AWS, Azure, GCP, or other.

## 16. Suggested Build Phases

### Phase 0: Foundation

- Monorepo.
- Auth/RBAC.
- Tenant model.
- Core database schema.
- Audit log.
- Basic admin shell.
- Payment provider setup.
- Zoom integration proof.

### Phase 1: Core Support MVP

- Customer web app.
- Engineer console.
- Green-dot flow.
- Triage.
- Matching v1.
- Zoom session creation.
- Billing v1.
- Memory v1.
- Internal admin v1.

### Phase 2: Supervisor Operations

- Supervisor dashboard.
- 10-card live view.
- AI red-card monitoring v1.
- Private engineer messaging.
- Takeover flow.
- Credit controls.

### Phase 3: Enterprise Console

- Organization codes.
- Enterprise wallet.
- Bulk Excel upload.
- Invites.
- Usage dashboard.
- Spend controls.
- Reports.

### Phase 4: Continuity and Expansion

- Browser extension.
- Desktop launcher.
- Mobile apps.
- Advanced AI copilot.
- Pattern library.
- Launch project workflow.
- Maintenance retainer workflow.

## 17. Claude Code Handoff Prompt

Use this PRD to build Relay.green as an enterprise-grade multi-role platform.

Start with Phase 0 and Phase 1 only. Do not attempt all phases at once.

Implement:

- Customer web app.
- Engineer console.
- Internal admin shell.
- Auth/RBAC.
- Tenant and organization model.
- Engineer profile model.
- Green-dot support request flow.
- AI triage placeholder interface.
- Matching service v1.
- Zoom integration abstraction.
- Hour-bucket ledger billing model with 10-minute first-session free trial; per-minute drawdown at the bucket's effective €/hr (anchor €39/hr at 5-hr bucket, sliding to €24/hr at custom Maintain).
- Session memory model.
- Audit log.

Design must follow the customer experience direction: Claude-like workspace, green-dot support action, calm interface, clear engineer presence, and billing transparency.

Keep architecture modular so Supervisor, Enterprise Admin, Browser Extension, Desktop Launcher, Mobile Apps, AI Copilot, and Pattern Library can be added in later phases.
