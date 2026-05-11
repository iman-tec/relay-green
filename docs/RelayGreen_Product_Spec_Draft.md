# Relay.green Product Specification Draft

Version: 0.2  
Purpose: Cleaned product brief for brainstorming, enterprise-grade specification, and future handoff to Claude Code.

> **IMPORTANT — superseding document**: For any conflict between this draft
> and `RelayGreen_Spec_Decisions_v1.md` (the closeout document from the
> 2026-05-09 brainstorm session), the closeout document is canonical. Sections
> 4 (Commercial Model) and 7.6 (Billing Rules) below have been updated to
> align with the unified hour-bucket model.

## 1. Product Summary

Relay.green is a real-time human engineering support platform for nontechnical and semi-technical builders using AI development tools.

The core promise is simple:

> A customer gets stuck while building with AI, clicks the green dot, and is connected to a qualified software engineer within 90 seconds.

Relay.green supports builders across three stages:

1. Get unstuck: On-demand help when AI-generated development work becomes confusing or blocked.
2. Get it live: Fixed-price support to launch the application into production.
3. Keep it running: Monthly or annual maintenance support after launch.

The platform is built around continuity. Wherever possible, the same engineer who helps the customer get unstuck should be able to help launch and maintain the product.

## 2. Target Users

### 2.1 Customer

A customer is an individual builder or employee who is using AI development tools to create software, websites, apps, internal tools, automation, dashboards, or business applications.

Typical customer examples:

- Founder building an MVP with Claude, Cursor, Lovable, Replit, v0, Bolt, Copilot, Gemini, ChatGPT, or similar tools.
- Marketing, finance, HR, operations, or product team member creating an internal AI-built tool.
- Student or solo creator who can generate code but cannot reliably debug, deploy, integrate, or maintain it.

Customer pain points:

- Does not understand technical terms such as CORS, API keys, webhooks, domains, SSL, deployment, environment variables, databases, authentication, or production logs.
- Gets stuck when AI tools produce code that does not work.
- Cannot confidently connect third-party systems such as CRM, ERP, payments, SSO, email, analytics, or internal data sources.
- Needs help launching a product safely.
- Needs ongoing support after the product is live.

### 2.2 Engineer

An engineer is a qualified software engineer who provides real-time technical support to customers.

Engineers may be Gateway/internal engineers or approved external engineers in later phases. What matters operationally is that every engineer is registered on Relay.green, has a structured skill profile, works inside the platform, and is supervised through Relay.green's quality and operations model.

Responsibilities:

- Join urgent customer sessions within the service target.
- Diagnose the customer problem.
- Explain solutions clearly to a nontechnical user.
- Assist through Zoom, chat, voice, screen share, and optionally remote collaboration tools.
- Document the session.
- Maintain customer and project memory.
- Recommend launch or maintenance services when appropriate.

Customer-facing identity:

- Customers see an approved engineer alias, profile photo or avatar, skill summary, language, availability, and relevant expertise.
- Customers must not see the engineer's real full name, personal email, LinkedIn profile, phone number, or direct external contact information.
- All communication must remain inside Relay.green-controlled channels.

### 2.3 Supervisor

A supervisor manages a pod of approximately 10 engineers.

Responsibilities:

- Monitor live engineer-customer sessions.
- Ensure quality, clarity, professionalism, and timely response.
- Intervene when a session becomes unhealthy or escalated.
- Coach engineers.
- Review session transcripts, recordings, NPS, and AI-generated quality alerts.
- Maintain pod-level service levels and utilization.

Supervisor coverage:

- A supervisor normally manages approximately 10 engineers during a shift.
- Relay.green leadership can adjust the engineer-to-supervisor ratio by shift, demand, risk, or operating model.
- Supervisor monitoring is disclosed to customers through general terms and conditions.

### 2.4 Enterprise Administrator

An enterprise administrator manages Relay.green access for a company, department, or large team.

Responsibilities:

- Receive and distribute organization codes or discount/accounting codes.
- Invite or approve employees.
- Monitor usage by user, team, project, and period.
- Manage budget allocation.
- View invoices, spend, active users, and support consumption.
- Configure enterprise controls such as SSO, allowed domains, user groups, spending limits, and reporting access.

Enterprise onboarding model:

- Enterprise users can join with company email and organization code.
- Invite links can also be created and sent by the enterprise administrator.
- Enterprise administrator can upload an Excel file of users with names and email addresses.
- The platform should support batch invite generation and sending from the uploaded user list.
- Once an invited or code-based enterprise user registers, they can start using support immediately if they are covered by the enterprise wallet or are expected to pay with their own card.
- No additional manual enterprise admin approval is required for each user in the initial model.
- Initial enterprise hierarchy is simple: one enterprise admin login can manage the enterprise account. Deeper hierarchy can be added later.

### 2.5 Relay.green Administrator

Relay.green administrators are internal operators and business leaders who manage the overall platform.

Responsibilities:

- View global usage and revenue.
- Monitor active sessions and engineer capacity.
- Manage enterprise customers, individual customers, engineers, supervisors, pricing, discount codes, billing, disputes, and service quality.
- Oversee platform health, compliance, audit logs, and operational risk.

## 3. Core Product Model

### 3.1 The Green Dot

The green dot is the product's primary entry point.

It may appear as:

- Desktop taskbar button.
- Browser extension.
- AI development tool extension or plug-in.
- Web dashboard launch button.
- Embedded partner button inside AI development platforms.
- Mobile app entry point for ongoing customer-engineer communication.

Expected behavior:

1. Customer clicks the green dot.
2. Relay.green asks enough AI-assisted routing questions to match the customer to the right engineer.
3. Customer selects or confirms AI tool, product type, issue type, desired functional expertise, urgency, and language.
4. A 90-second countdown begins.
5. While the customer waits, AI continues collecting context so the engineer can begin faster.
6. Matching service allocates the most suitable available engineer.
7. Customer is connected through Zoom by default.
8. Session is tracked, recorded only if explicitly enabled with consent, transcribed where available, and attached to project memory.

### 3.2 Supported AI Development Tracks

Relay.green should support tool-specific routes, landing pages, engineer skills, and knowledge patterns for:

- Claude
- ChatGPT
- Gemini
- Copilot
- Cursor
- Lovable
- Replit
- v0
- Bolt

Each track should eventually have:

- Specialist engineer pool.
- Tool-specific triage questions.
- Tool-specific pattern library.
- SEO landing pages and help content.
- Known integrations and common issue templates.

## 4. Commercial Model — Unified Hour-Bucket Primitive

> Sections 4.1, 4.2, 4.3 of v0.1 are obsolete. Replaced by the unified
> hour-bucket model below. See `RelayGreen_Spec_Decisions_v1.md` Section B
> for the canonical version.

### 4.1 The unified primitive

Relay.green sells **prepaid hour-buckets** of qualified engineer time. One
commercial unit (hours), three engagement contexts:

| Engagement context | Bucket sizes (hrs) | Cadence |
|---|---|---|
| Get unstuck | 5 · 10 | one-time, top-up anytime |
| Get it live | 20 · 40 · 60 | one-time per launch project |
| Keep it running | 50/mo · 100/mo · custom | monthly recurring |

### 4.2 Pricing ladder (EUR)

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

USD/GBP/INR mirror cards per locked rate cards (Spec Decisions Section C3).

### 4.3 First-time free trial

- First 10 minutes free, once per customer-lifetime.
- First session can begin without a payment method.
- Free minutes expire after the first session, even if less than 10 was used.
- Continuing past minute 10 requires payment method (cliff UX in
  `RelayGreen_Spec_Decisions_v1.md` Section C5).

### 4.4 Hour expiration & rollover

- **Stuck hours**: 12 months from purchase.
- **Launch hours**: 6 months from purchase, tied to a specific launch project.
- **Maintain hours**: monthly recurring; one-month rollover allowed; expires
  end of following month.

### 4.5 Refund policy

| Bucket type | Refund posture |
|---|---|
| Stuck | Refundable at full €/hr on unused hours, less Stripe fees |
| Launch | Refundable at full €/hr if project not started; pro-rated if partially used and cancellation is for cause; never refundable for hours already delivered |
| Maintain | Non-refundable once charged; customer cancels future months but current month's hours stand |

### 4.6 The 10% variance rule (Launch tier only)

Engineer estimates Launch project hours at quote time using AI co-pilot draft.
Customer buys the matching bucket. Engineer may exceed the estimate by up to
10% absorbed silently. Beyond 10%, engineer submits a written justification +
delta-bucket request through the platform; customer accepts (paying for the
extra hours), reverts to remaining-hours hand-off, or cancels.

### 4.7 The "Pass the baton" mechanic

Engineer composes a Launch hour-bucket recommendation through AI co-pilot.
Customer sees a card mid-session: *"Want me to take this to launch? Same
engineer. Estimated 20 hours. Buy 20-hour Launch bucket — €680."* Three
buttons: Buy bucket · See estimate detail · Not yet. On Buy: 100% upfront
payment, current Stuck session ends free, kickoff scheduled within 24h.

## 5. Primary Interfaces

### 5.1 Customer Interface

The customer interface should feel calm, modern, and familiar to users of Claude-style AI tools.

Core design intent:

- Left sidebar for projects and sessions.
- Central conversation workspace.
- Clear session state and billing ticker.
- Easy access to engineer face, name, status, calendar, recordings, files, and project memory.
- Minimal visual friction.
- Strong sense that a real human is available.

Core features:

- Sign up and login.
- Create project.
- Create session.
- Select AI tool track.
- Click green dot for urgent help before or during project creation.
- Answer pre-match and waiting-room AI triage questions.
- See 90-second engineer allocation countdown.
- Join Zoom session.
- Move smoothly through Zoom-supported chat, audio call, video call, screen share, optional remote control, recording, and post-session storage.
- Upload code snippets, screenshots, logs, links, files, and repository context.
- View live timer and billing estimate.
- First 10 free minutes indicator where eligible.
- Hour-bucket ledger drawdown (per-minute from active bucket; no per-session minimum).
- Book future time on engineer calendar.
- View previous sessions under each project.
- View session summaries, transcripts, action items, recordings, and Zoom cloud recording links.
- Continue long-running projects across days, weeks, or months.
- View launch quotes and accept "Pass the baton" offers.
- View maintenance plans and active retainers.
- Manage payment methods and invoices.
- Manage enterprise organization code if applicable.
- Use a mobile app for ongoing chat-style communication with the assigned engineer.
- Send text notes, voice notes, links, files, documents, screenshots, and step-by-step inputs through the platform.

### 5.2 Engineer Console

Core features:

- Engineer login.
- Availability toggle.
- Live queue and assigned customer sessions.
- Customer/project memory.
- Current session context, including triage summary, tool track, files, previous sessions, and known issues.
- Zoom launch or join controls.
- Chat and notes.
- AI copilot suggestions during the session.
- Real-time transcript and summary.
- Accent/transcription support where available.
- Billing/session timer.
- Ability to create launch quote within pricing guardrails.
- Ability to recommend maintenance plan.
- Calendar management.
- Shift and availability management.
- Alias profile management subject to admin approval.
- Private engineer notes visible only to the engineer.
- Customer-visible follow-up messages, files, recommendations, and instructions.
- Post-session summary and resolution pattern submission.
- Escalate to supervisor.

### 5.3 Supervisor Console

Core features:

- Login for supervisor.
- Dashboard with approximately 10 engineer cards.
- Each card shows engineer status, current customer, session duration, modality, AI health score, NPS signals, response latency, and escalation status.
- Live monitoring of active sessions.
- Ability to click into a session.
- View live transcript, session audio/video where permitted, sentiment, technical progress, risk flags, and AI-generated warnings.
- Ability to join or take over a session.
- Coaching notes and quality reviews.
- Engineer utilization and performance metrics.
- Alerts for unhealthy interactions, long silence, customer frustration, repeated misunderstandings, billing disputes, or SLA risk.
- AI monitoring agent that continuously evaluates live sessions and turns an engineer card red when intervention is recommended.
- Private supervisor-to-engineer messaging during live sessions.
- Specialist allocation.
- Customer credit controls.
- Supervisor notes for internal admin, training, and future reference.

### 5.4 Enterprise Administrator Console

Core features:

- Enterprise login.
- Organization profile.
- Domain verification.
- SSO and SCIM support in enterprise tiers.
- Create, view, and manage organization codes.
- Configure organization-code discounts, validity dates, eligible users, and accounting behavior.
- Invite users.
- Bulk upload users by Excel file.
- Generate and send batch invite links.
- Assign departments, teams, budgets, and permissions.
- Usage dashboard by person, team, project, and date range.
- Live user/session visibility where allowed.
- Spend controls and budget alerts.
- Invoice and billing dashboard.
- Export reports.
- Manage discount or accounting codes.
- Manage enterprise wallet funding and allocation.
- Configure which users are covered by the enterprise wallet and which users pay by individual card.

### 5.5 Relay.green Internal Admin Console

Core features:

- Global dashboard.
- Active users and active sessions.
- Engineer capacity and utilization.
- Revenue, billing, refunds, and disputed charges.
- Enterprise account management.
- Discount and organization code management.
- Customer support tooling.
- Engineer onboarding and certification status.
- Supervisor assignment.
- Session quality analytics.
- Pattern library review workflow.
- Audit log.
- Compliance dashboard.
- Incident management.

## 6. Real-Time Session Requirements

### 6.1 Availability Promise

Target promise:

- Engineer available within 90 seconds for urgent green-dot requests.

Operational requirements:

- Real-time matching.
- Follow-the-sun engineer staffing.
- Queue prioritization.
- Skill-based routing.
- Language and accent-aware routing where possible.
- Enterprise priority tiers.
- Fallback escalation if no engineer joins within target.

### 6.2 Communication Channels

Required:

- Zoom integration as the default live-session layer.
- Zoom-supported chat, audio, video, screen share, optional remote control, and recording.
- Session transcript.
- Zoom cloud recording link attached to the session where recording is explicitly enabled.
- Session memory storage so future interactions can continue from prior context.
- Platform-contained communication after and between sessions, including text notes, voice notes, links, documents, and files.
- Engineer mobile app support for chat, notifications, file review, calendar, billing/session history, and session history.

Future/optional:

- Built-in video stack.
- LiveKit or similar real-time infrastructure.
- Remote control with explicit permission.
- Repository or IDE integration.
- Zoom join from mobile app. MVP Zoom join should remain desktop-first.

### 6.3 Accent and Language Support

Problem:

Customers and engineers may speak with regional accents. Miscommunication can reduce trust and session quality.

Capabilities to explore:

- Real-time transcription for both parties.
- Live captions.
- Accent-aware speech-to-text.
- Translation where customer and engineer do not share a language.
- Optional speech normalization or neutral-accent audio transformation.
- AI-generated clarification prompts when the system detects misunderstanding.

Important constraints:

- Real-time accent conversion may introduce latency, consent, privacy, identity, and trust issues.
- The first production-grade version should prioritize accurate transcription, captions, summaries, and coaching alerts before relying on voice transformation.

## 7. Session Lifecycle Specification

### 7.1 Session States

Each support interaction should move through a clear lifecycle.

Core states:

1. Draft: Customer has opened the green-dot flow but has not requested an engineer yet.
2. Triage: AI is collecting issue context, project context, tool track, urgency, and preferred modality.
3. Matching: Customer has requested help and the 90-second allocation timer has started.
4. Engineer assigned: An engineer has accepted or been assigned to the session.
5. Waiting for Zoom: Zoom meeting is being created or opened.
6. Live: Engineer and customer are actively connected.
7. Paused: Session is temporarily interrupted but not ended.
8. Escalated: Supervisor or specialist intervention has been requested.
9. Ending: Customer or engineer has initiated closeout.
10. Closed: Live interaction has ended.
11. Summarizing: Transcript, notes, action items, and memory updates are being generated.
12. Reviewed: Required quality checks or supervisor review have been completed, if applicable.
13. Billed: Final duration, free minutes, minimums, taxes, currency, and payment status have been calculated.
14. Archived: Session is stored under the customer project and available for future continuity.

### 7.2 Customer Flow

1. Customer clicks the green dot from the web app, browser extension, or desktop launcher.
2. Customer can select an existing project or begin creating a new project while waiting for the engineer.
3. Customer selects the AI development track, such as Claude, Cursor, Lovable, Replit, v0, Bolt, ChatGPT, Gemini, or Copilot.
4. AI triage asks routing questions:
   - What are you trying to build?
   - Which tool are you using?
   - What type of product is this: website, web app, mobile app, business application, internal tool, automation, dashboard, or another category?
   - What functional expertise do you need: frontend, backend, database, cloud, integrations, payments, authentication, security, analytics, AI, or another area?
   - What is broken or confusing?
   - What error, screen, or behavior are you seeing?
   - Is this urgent?
5. Customer can upload screenshots, logs, code snippets, links, or files.
6. Customer confirms request.
7. 90-second timer begins.
8. While waiting, AI continues collecting details that help the engineer start faster.
9. Customer sees assigned engineer name, face, status, skill tags, and expected join progress.
10. Zoom session opens by default.
11. Customer interacts with the engineer through chat, audio, video, screen share, and optional remote control.
12. Customer sees live timer, billing estimate, and free-minutes status where applicable.
13. If this is the customer's first session and the free 10 minutes expire, the customer must add a payment method to continue into paid support.
14. For all later sessions, the session is paid from the start by drawing down from an active hour-bucket; if no active matching bucket exists, customer is prompted to purchase one inline.
15. If the customer is not comfortable with the matched engineer, the customer can request a change.
16. Future sessions prioritize the same engineer by default.
17. Customer can end the session, continue, book follow-up time, or request launch/maintenance support.
18. After closeout, the platform stores session metadata, billing records, shared artifacts, and any engineer-submitted follow-up commitments.

### 7.3 Engineer Flow

1. Engineer marks themselves available.
2. Matching service sends a session request based on skill, availability, language, tool track, customer tier, and continuity preference.
3. Engineer accepts the session or is auto-assigned according to operations policy.
4. Engineer sees:
   - Customer name.
   - Organization, if applicable.
   - Project memory.
   - AI triage summary.
   - Tool track.
   - Uploaded artifacts.
   - Previous sessions.
   - Billing/session status.
   - Enterprise policy constraints.
5. Engineer joins Zoom.
6. Engineer diagnoses and supports the customer.
7. Engineer can use AI copilot for:
   - Suggested root causes.
   - Previous similar patterns.
   - Plain-English explanations.
   - Live notes.
   - Follow-up tasks.
   - Quote drafting.
   - Real-time side responses while the engineer listens to the customer.
   - Immediate support if the engineer is unsure how to solve the problem.
8. Engineer can request supervisor help.
9. Engineer closes the session with outcome status:
   - Solved.
   - Partially solved.
   - Needs follow-up.
   - Escalated.
   - Launch opportunity.
   - Maintenance opportunity.
   - Customer abandoned.
10. Engineer reviews or edits the AI-generated summary.
11. Engineer submits final notes and any recommended next steps.
12. Engineer may propose a "Pass the baton" launch quote or maintenance recommendation within approved guardrails.

Engineer status model:

- Available.
- Assigned.
- In Zoom.
- Wrapping up.
- On break.
- Offline.
- Training.
- Shadowing.
- Escalated.

Status visibility:

- Detailed engineer status is primarily visible to supervisors and internal operations.
- Customers should see only customer-safe availability and join-status language.
- Engineers maintain their own calendars and shift availability.

### 7.4 Matching Logic

Matching should prioritize:

1. Same engineer previously attached to the customer or project.
2. Engineer with the right AI tool track specialization.
3. Engineer with the right technical skill tags.
4. Engineer with the right product-type experience, such as website, web app, mobile app, business application, automation, dashboard, or internal tool.
5. Engineer with the right functional expertise, such as frontend, backend, database, cloud, integrations, payments, authentication, security, analytics, or AI.
6. Engineer with matching language or communication preference.
7. Enterprise priority level.
8. Engineer availability and current utilization.
9. Supervisor pod capacity.
10. Supervisor-reviewed performance and recent reliability.

If no ideal engineer is available:

- The system should assign the best available qualified engineer.
- The system should notify the supervisor if 90-second SLA risk is detected.
- The customer should see transparent progress messaging without exposing internal staffing problems.
- The customer should be able to request another engineer if the match is not comfortable.

Same-engineer continuity:

- The first preference is always to continue with the same engineer across urgent support, launch, and maintenance.
- If the same engineer is available, the customer should be routed to that engineer by default.
- If the same engineer is not immediately available, the customer can book time from that engineer's calendar or request another engineer for quicker support.
- Any newly assigned engineer must have access to the prior customer/project memory.
- When the original engineer returns, they must have access to the work performed by the interim engineer.

Engineer profile requirements:

- Relay.green leadership and operations teams must be able to create and manage detailed engineer profiles.
- Engineer profiles must include AI tool expertise, technology skills, product-type experience, functional expertise, languages, time zone, supervisor-reviewed performance indicators, availability, supervisor pod, and eligibility for enterprise accounts.
- The matching engine must use these profiles to map the right engineer to the customer's request.

Assignment and capability rules:

- If an engineer determines they are not capable of solving the customer's issue, they can stop the session path and request supervisor intervention.
- The supervisor can allocate a different engineer or specialist.
- Where appropriate, time spent with the unsuitable engineer should be credited back to the customer.

### 7.5 Zoom Session Rules

Zoom is the primary live interaction layer.

Required capabilities:

- Create meeting automatically.
- Join meeting from customer and engineer interfaces.
- Support chat, audio, video, screen share, and optional remote control.
- Keep recording off by default.
- Request explicit consent from both customer and engineer before recording starts.
- Store Zoom recording link under the session.
- Store transcript where available.
- Attach meeting metadata to the session record.
- Handle reconnection if either party drops.

Remote control rules:

- Customer must explicitly grant control.
- Remote control is available only for paid users.
- Engineer actions should be logged where technically possible.
- Engineer must not access unrelated customer systems, files, or credentials.
- Secrets should be redacted from notes, summaries, and transcripts where possible.

### 7.6 Billing Rules (hour-bucket ledger)

> The 20-minute minimum and per-session rate logic from v0.1 is OBSOLETE.
> Billing now flows through prepaid hour-buckets per Section 4 above.

Core rules:

- Customers buy prepaid hour-buckets; sessions draw down per-minute against
  an active bucket.
- Per-second drawdown internal; per-minute display at customer/engineer UI.
- First customer-lifetime session: up to 10 free minutes (no bucket required).
- Free minutes expire after first session, even if less than 10 used.
- After free trial, every session must draw down from an active bucket of the
  matching engagement type, or from an enterprise wallet covering it.
- Per-minute drawdown rate = bucket's effective €/hr (price paid / size).
- The 20-minute minimum is REMOVED.
- Billing timer starts when engineer joins live session, stops when session ends.
- Paused/disconnected time rules: drawdown pauses when session pauses;
  resumes on reconnect within 5 min; if no reconnect in 5 min, session
  closes and any unused minutes return to the bucket.

Currency & tax:

- Rate cards locked per `RelayGreen_Spec_Decisions_v1.md` Section C3.
- Customer's currency locked at signup (IP-detected, override available, locked thereafter).
- Stripe Tax computes VAT/GST/sales tax per region at time of bucket purchase.

Refund handling resolved in Section 4.5; expiration in Section 4.4.

Billing examples:

- New customer uses 8 minutes in first session: free; free trial consumed.
- New customer reaches 10 minutes and wants to continue: customer either
  buys a Stuck bucket inline (5 hrs / €195 in EUR) and continues, or session
  ends after grace period.
- Returning customer with 5-hr Stuck bucket uses 6 minutes: bucket draws
  down 0.10 hrs (~€3.90 equivalent against €195 paid).
- Customer with 20-hr Launch bucket: engineer delivers in 18 hrs → 2 hrs
  remaining at full refund eligibility for 6 months from purchase.
- Customer with 50/mo Maintain bucket uses 32 hrs in March: 18 hrs roll
  over to April. If unused at end of April, expire.

Resolved formerly-open billing decisions:

1. **Late engineer join** — see O2 (still open).
2. **Zoom failure** — see O2 (still open).
3. **Tax/FX timing** — Stripe Tax at bucket-purchase time; FX at locked
   rate-card prices, refreshed quarterly per C3.
4. **Pre-authorization** — Stripe captures full bucket price upfront at
   purchase. No per-session pre-auth needed — drawdown is against already-paid
   bucket balance.

### 7.7 Memory Update Rules

After each session, the system should update customer and project memory.

Required memory objects:

- Session metadata.
- Problem statement.
- Tools and systems discussed or touched.
- Decisions made.
- Follow-up commitments submitted by the engineer.
- Files, links, documents, text notes, voice notes, and step-by-step instructions shared through the platform.
- Launch or maintenance opportunity.
- Links to transcript and recording where available.
- Engineer notes.

Engineer notes visibility:

- Private engineer notes are visible only to that engineer and authorized internal roles where required for operations or compliance.
- Customer-visible follow-ups must be submitted separately as platform messages, documents, recommendations, or instructions.
- Other engineers assigned to the same customer/project should see relevant project memory and prior support context, but not necessarily every private note unless policy permits it.

Memory visibility:

- Customer sees customer-safe summaries and artifacts.
- Engineer sees full working memory for assigned customers and projects.
- Supervisor sees content for supervised sessions.
- Enterprise admin sees only metadata, usage, and spend.
- Internal admin access is controlled by role, audit, and operational need.

### 7.8 Supervisor Monitoring Rules

The supervisor console should monitor every live session for quality and risk.

Signals:

- Session duration.
- Customer sentiment.
- Engineer response latency.
- Long silence.
- Repeated confusion.
- Customer interruption or frustration.
- Engineer uncertainty.
- Unresolved technical loop.
- Billing dispute language.
- Security-sensitive content.
- Request for credentials or secrets.
- SLA breach risk.

Supervisor actions:

- Watch live session metadata.
- Review live transcript, audio/video where permitted, and AI quality alerts.
- Message engineer privately.
- Join session visibly after customer permission.
- Take over session.
- Escalate to specialist.
- Mark session for post-call review.
- Review engineer response time, resolution rate, escalation rate, and support performance.
- Use performance data for coaching and operations without exposing public engineer rankings to customers.
- Remove an engineer from availability during a shift.
- Credit customer time where the supervisor determines the session was not useful.

Supervisor AI support:

- The supervisor console should include an AI agent that continuously monitors live sessions across the supervisor's engineer cards.
- If the AI agent detects risk, the relevant engineer card should turn red and prompt the supervisor to review or take control.
- Risk detection should consider sentiment, confusion, long silence, engineer uncertainty, repeated loops, billing language, security-sensitive content, and unresolved technical progress.
- When the supervisor takes control, the supervisor should also have AI copilot support to solve the problem, guide the current engineer, or allocate a new specialist.

Supervisor dashboard card fields:

- Engineer alias.
- Engineer status.
- Customer alias or customer-safe identifier.
- Session duration.
- AI tool track.
- Issue type.
- Product type.
- Sentiment.
- AI risk flag.
- Escalation state.
- Private message action.
- Join/takeover action.
- Credit action where authorized.

Review process:

- Supervisors do not need to manually review every session in full.
- Supervisors should monitor live dashboards continuously during shift.
- Flagged sessions require immediate supervisor response.
- Supervisors should also review a random sample of completed sessions for quality, training needs, and calibration.

Supervisor notes:

- Supervisor notes are internal admin only by default.
- Supervisor notes are used for training, performance management, operational review, and future reference.
- Supervisor notes are not visible to customers.
- Supervisor notes are not visible to engineers unless a separate coaching or review workflow explicitly shares them.

### 7.9 Post-Session Quality Flow

At session close:

1. AI generates internal notes, quality signals, and memory updates where appropriate.
2. Engineer can submit customer-visible follow-up commitments, documents, recommendations, or instructions if needed.
3. Customer can access shared platform communication and engineer-submitted follow-up items.
4. Customer rates the session.
5. Session is flagged for supervisor review if risk signals were detected.
6. Billing is calculated.
7. Recording and transcript links are attached where available.
8. Pattern library candidate is generated if the resolution is reusable.
9. Launch or maintenance opportunity is recorded if relevant.

### 7.10 Failure and Escalation Scenarios

The platform must handle:

- No engineer available within 90 seconds.
- Engineer accepts but does not join.
- Customer abandons session.
- Zoom meeting creation fails.
- Payment authorization fails.
- Customer refuses recording.
- Customer shares secrets.
- Engineer cannot solve issue.
- Customer asks for work outside support scope.
- Session becomes abusive or unsafe.
- Enterprise policy blocks support for the requested tool or project.

Each scenario should have:

- Customer-facing message.
- Engineer action.
- Supervisor action.
- Billing rule.
- Audit event.
- Recovery path.

Credit rules for failed engineer fit:

- If the engineer cannot solve the issue and the supervisor determines the session was not useful, the time spent with that engineer can be credited back to the customer.
- The supervisor should then allocate a fresh engineer or specialist.

## 8. AI Copilot and Pattern Library

### 8.1 Engineer AI Copilot

The engineer should have an AI copilot during sessions.

Capabilities:

- Read triage context.
- Retrieve customer memory.
- Search previous session summaries.
- Retrieve relevant technical patterns.
- Suggest likely root causes.
- Suggest explanation phrasing for nontechnical users.
- Listen to the live session where consent and technical architecture permit.
- Provide real-time side suggestions to the engineer.
- Help the engineer respond faster when they are uncertain.
- Generate post-session summary.
- Generate launch quote draft.
- Generate maintenance recommendation.
- Flag risk, unclear commitments, or unresolved issues.

### 8.2 Pattern Library

Every session should create learning data.

Workflow:

1. Session is summarized.
2. Resolution is proposed as a reusable pattern.
3. Sensitive data is removed.
4. Pattern is reviewed by qualified engineers.
5. Approved pattern becomes searchable for future sessions.

Pattern categories:

- AI tool.
- Error type.
- Framework.
- Hosting provider.
- Integration type.
- Deployment issue.
- Security issue.
- Billing/payment issue.
- Enterprise policy issue.

## 9. Memory and Project Continuity

Each customer should have project-level and session-level memory.

Memory should include:

- Project description.
- AI tool used.
- Tech stack.
- Repository links, if shared.
- Environments.
- Deployment status.
- Previous issues.
- Decisions made.
- Credentials status without exposing secrets.
- Prior engineer notes.
- Session transcripts and summaries.
- Launch and maintenance commitments.

Access controls:

- Customer can see their own memory.
- Assigned engineer can see memory for active and assigned customers.
- Supervisors can see memory for engineers they supervise.
- Enterprise admins can see metadata and usage, with content visibility controlled by policy.
- Relay.green admins can access content only under support, compliance, or authorized operational workflows.

Enterprise administrator visibility:

- Enterprise administrators can view usage, spend, user, team, project, and session metadata.
- Enterprise administrators cannot view actual session transcripts, recordings, chat content, code, files, or detailed engineering notes unless a separate customer-controlled policy is explicitly introduced later.
- Enterprise administrators can see live visibility of active users and active sessions at metadata level.
- Enterprise administrators can see complete usage reports at any point in time.

Allowed enterprise metadata fields:

- User name.
- User email.
- Department.
- Team.
- Project name.
- AI tool track.
- Session duration.
- Spend.
- Engineer alias.
- Date and time.
- Session status.
- Recording enabled yes/no.
- Wallet or individual-card billing source.

## 10. Enterprise and Compliance Requirements

Enterprise-grade expectations from day one:

- Multi-tenant architecture.
- Strong tenant isolation.
- SSO for enterprise customers.
- SCIM for enterprise user provisioning.
- Role-based access control.
- Audit logs.
- Data retention controls.
- Data deletion workflows.
- GDPR readiness.
- DPDP readiness.
- SOC 2 roadmap.
- Encryption in transit and at rest.
- Secrets redaction.
- Payment compliance through a compliant payment provider.
- Incident response process.
- Legal terms covering IP ownership, support scope, recording consent, and liability.

Enterprise admin permissions:

- Enterprise admin can view live and historical usage metadata.
- Enterprise admin can manage organization code access.
- Enterprise admin can manage invite links and bulk invites.
- Enterprise admin can configure spend limits by user, team, department, project, month, or full organization.
- Enterprise admin can fund and manage an enterprise wallet.
- Enterprise admin can choose whether specific users consume from the wallet or pay with individual cards.
- Enterprise admin does not initially need advanced restrictions for supported tools, project types, remote control, recording, or file uploads.
- Enterprise admin cannot view transcripts, recordings, chat content, code, uploaded files, or detailed engineering notes.

Organization-code discount rules:

- Relay.green leadership can create organization codes.
- An organization code can include no discount or a special discount.
- Discounts can apply to selected users, first few users, or a defined from-date/to-date period.
- Organization codes can support access control, accounting, and discounting.

## 11. Scale and Reliability Goals

Initial ambition:

- 10,000+ users in the first month.
- Ability to support rapid ramp toward enterprise volume.

Platform goals:

- Multi-region architecture.
- Low-latency session start.
- Reliable queue and matching system.
- Horizontal scaling for real-time services.
- Observability across every service.
- Error tracking.
- Performance monitoring.
- Capacity forecasting for engineers.
- Load testing before launch.

Availability targets to refine:

- Closed beta: 99.5%.
- Public launch: 99.9%.
- Enterprise maturity: 99.95%.

## 12. Proposed High-Level Architecture

Frontends:

- Customer web app.
- Desktop green-dot launcher.
- Browser extension.
- Customer mobile app.
- Engineer mobile app.
- Engineer console.
- Supervisor console.
- Enterprise admin console.
- Relay.green internal admin console.

Core services:

- Identity and access service.
- Organization and tenant service.
- Matching service.
- Session orchestration service.
- Realtime/chat service.
- Zoom integration service.
- Calendar integration service.
- Billing service.
- Quote and project service.
- Retainer service.
- AI copilot service.
- Pattern library service.
- Knowledge base service.
- Notification service.
- Audit log service.
- Reporting and analytics service.

Data stores:

- PostgreSQL for transactional data.
- Redis for queues, presence, and realtime state.
- Object storage for files, summaries, and generated artifacts.
- Vector database or pgvector for memory and pattern retrieval.
- Analytics warehouse such as ClickHouse or equivalent for usage and operational metrics.

Integrations:

- Zoom.
- Stripe or equivalent payment provider.
- Calendar provider.
- Email/SMS/WhatsApp notifications.
- SSO providers.
- AI model providers.
- Cloud hosting providers.
- GitHub/GitLab/Bitbucket in later phases.
- Excel import for enterprise user upload.

## 13. Critical Product Questions

### 13.1 Business Model

1. Should subscription bundles be introduced later, or should Leg 1 remain strictly pay-as-you-use?
2. What happens if the engineer joins late or Zoom fails during a paid session?
3. Are taxes and currency conversion calculated at invoice time, authorization time, or session close?
4. Should enterprise usage be billed to the organization, the employee, or both depending on policy?
5. Should launch and maintenance pricing be globally fixed, region-adjusted, or engineer-tier-adjusted?

### 13.2 Customer Experience

1. What exact pre-match questions should be mandatory before engineer assignment?
2. What customer-facing message appears when the customer reaches the free 10-minute limit?
3. What is the exact flow when a customer requests a different engineer?
4. Should customers be able to favorite engineers beyond the default continuity relationship?
5. What is the first mobile app scope: chat only, or chat plus session booking and file sharing?

### 13.3 Engineer Operations

1. What exact skill taxonomy should be used when registering engineer expertise?
2. What certifications or internal approval gates are required by AI tool track?
3. What is the exact policy for crediting customers when an engineer cannot solve the issue?
4. Which private engineer notes can be shared with other engineers on the same customer/project?
5. What is the escalation path from engineer to supervisor to specialist?

### 13.4 Supervisor and Quality

1. What exact AI risk-scoring model should drive red-card alerts?
2. What customer-facing terms language is required to disclose supervisor monitoring?
3. What permission UX should appear when a supervisor joins visibly?
4. What customer credit limits can supervisors approve without higher authorization?
5. What leadership metrics should be used to evaluate supervisors and teams?

### 13.5 Enterprise Governance

1. What exact Excel template should enterprise admins use for bulk user upload?
2. What organization-code discount rules are needed: user count, date range, first-use only, recurring, or custom?
3. What wallet top-up, low-balance, and failed-payment flows are required?
4. What metadata should be visible during a live session versus after session close?
5. What report export formats are required: CSV, XLSX, PDF, API, or all?

### 13.6 Compliance and Trust

1. What is the recording consent flow?
2. How long are recordings, transcripts, and summaries retained?
3. How are secrets, API keys, and customer code protected?
4. Can engineers download customer files?
5. What customer IP terms are required?

## 14. MVP Recommendation

The MVP should focus on proving the core promise without overbuilding the full enterprise platform.

Recommended MVP scope:

- Customer web app with Claude-style session interface.
- Green-dot urgent request button in the web app.
- Browser extension after web app.
- Desktop taskbar launcher after browser extension.
- Customer mobile app for ongoing chat-style interaction after the first web experience is proven.
- Engineer mobile app for ongoing chat-style interaction after the first web experience is proven.
- Engineer console.
- Supervisor live dashboard.
- Zoom integration.
- Calendar scheduling.
- Stripe billing.
- First 10 minutes free.
- Hour-bucket ledger billing (per-minute drawdown; no per-session minimum).
- Project and session memory.
- Platform-contained customer-engineer communication.
- Session transcript where available.
- Recording link storage.
- Basic enterprise code support.
- Internal admin dashboard.
- AI copilot v1 for summaries, suggested fixes, and quality flags.
- Real-time engineer AI copilot side panel.

Defer until after MVP:

- Real-time accent conversion.
- Full desktop taskbar product across all operating systems.
- Deep IDE integrations.
- Full partner integrations with AI development tools.
- Advanced enterprise SCIM.
- Complex marketplace-style engineer selection.
- Fully automated launch quote generation without human review.

## 15. Immediate Next Steps

1. Define billing edge cases for the hour-bucket ledger: post-free payment gating, drawdown reconciliation, paused/disconnected time, bucket exhaustion mid-session, and refund triggers.
2. Confirm whether the first phase includes all six priority AI tool tracks: Claude, Gemini, Copilot, Lovable, Replit, and Cursor.
3. Define the detailed matching questionnaire and engineer profile taxonomy.
4. Define customer onboarding and triage flow.
5. Define engineer onboarding and certification model.
6. Define session lifecycle from green-dot click to billing and memory update.
7. Define enterprise admin visibility and privacy boundaries.
8. Convert this document into detailed PRD, architecture spec, data model, and build backlog for Claude Code.
