# Relay.green Spec Decisions v1

Version: 1.0
Date: 2026-05-09
Owner: Niraj Gemawat
Status: Canonical — supersedes prior documents on any conflict

## How to read this document

This document captures the decisions made during the brainstorm session that
followed Codex's initial spec generation. It is the **canonical source of
truth** for every decision listed below. Where this document conflicts with
the earlier six documents, this document wins.

Each decision has three parts:

- **Spec language** — the wording that goes into the unified PRD
- **Sub-decisions** — locked smaller choices flowing from the main decision
- **Implementation notes** — concrete guidance for Claude Code at build time

## Cross-referenced source documents

- `RelayGreen_Build_Ready_PRD_v1.md`
- `RelayGreen_Product_Spec_Draft.md`
- `RelayGreen_Technical_Architecture_v1.md`
- `RelayGreen_Codex_Build_Approach.md`
- `RelayGreen_Implementation_Backlog_v1.md`
- `RelayGreen_Start_Build_Checklist.md`

---

## Section A: Top-Level Architectural Posture

| # | Topic | Locked decision |
|---|---|---|
| A1 | Commercial primitive | **Single prepaid hour-bucket ledger** across all engagement contexts (replaces 3-leg model) |
| A2 | Auth & registration | claude.ai-mirror flow — passwordless email-OTP + mandatory phone-OTP + Google/Apple OAuth |
| A3 | Design language | Anthropic claude.ai aesthetic — warm cream + coral, Source Serif 4 + Inter, shadcn/ui themed |
| A4 | Realtime media stack | **Zoom Video SDK** embedded in Relay.green consoles (locked for accent neutralization, identity protection, and recording control) |
| A5 | AI tracks at v1 | 9 supported front doors: Claude · ChatGPT · Gemini · Copilot · Cursor · Lovable · Replit · v0 · Bolt |
| A6 | Language support v1 | **English only.** Spanish/French/Hindi/Portuguese deferred to Phase 3+ |
| A7 | Customer-facing currency | **EUR / USD / GBP / INR**, locked rate cards, IP-detected at signup, locked thereafter |
| A8 | Tax engine | Stripe Tax — VAT (EU), VAT (UK), state sales tax (US), GST (IN), B2B reverse-charge for valid VAT IDs |
| A9 | Built using | Claude Code (the platform itself is built using Claude Code as the development tool) |

---

## Section B: Commercial Model — Hour-Bucket Primitive

### B.1 The unified primitive

One commercial unit (hours), three engagement contexts, eight standard buckets
plus a custom tier.

| Engagement context | Bucket sizes (hrs) | Cadence | Replaces |
|---|---|---|---|
| **Get unstuck** | 5 · 10 | one-time, top-up anytime | hourly Leg 1 |
| **Get it live** | 20 · 40 · 60 | one-time | fixed-price Leg 2 |
| **Keep it running** | 50/mo · 100/mo · custom | monthly recurring | retainer Leg 3 |

### B.2 Pricing ladder (LOCKED)

EUR base rate; USD/GBP/INR locked per Section C3 currency rate cards.

| Bucket | €/hr | Bucket price | USD | GBP | INR |
|---|---:|---:|---:|---:|---:|
| 5 hrs | 39 | 195 | 210 | 165 | 17,500 |
| 10 hrs | 37 | 370 | 400 | 315 | 33,000 |
| 20 hrs | 34 | 680 | 730 | 580 | 60,000 |
| 40 hrs | 32 | 1,280 | 1,380 | 1,090 | 1,15,000 |
| 60 hrs | 30 | 1,800 | 1,940 | 1,530 | 1,60,000 |
| 50 hrs/mo | 28 | 1,400/mo | 1,510/mo | 1,190/mo | 1,25,000/mo |
| 100 hrs/mo | 26 | 2,600/mo | 2,810/mo | 2,210/mo | 2,32,000/mo |
| 100+ hrs/mo | from 24 | quote | quote | quote | quote |

The €39/hr no-discount anchor preserves every existing decision tied to that
rate. Larger buckets earn a discount per hour — natural upsell pressure.

### B.3 First-time free trial (preserved from original spec)

- **First 10 minutes free**, once per customer-lifetime
- Customer can begin first session without payment method on file
- Free minutes expire after first session, even if less than 10 was used
- Continuing past minute 10 requires payment method (see Section C5 for cliff UX)
- Adding a payment method also unlocks the ability to purchase any bucket

### B.4 Hour ledger model

- Each customer has an **hour-ledger per active engagement** (one for Stuck, one
  per Launch project, one per Maintain bucket)
- Hours drawn down by minute as engineer-customer Zoom session runs
- Drawdown granularity: **per-second** internally, billed in **per-minute** at
  display layer (industry standard)
- Cross-engagement transfer is not permitted (hours bought for Maintain cannot
  be used for Stuck)

### B.5 Expiration & rollover

| Bucket type | Expiration |
|---|---|
| Stuck (5 / 10 hrs) | 12 months from purchase |
| Launch (20 / 40 / 60 hrs) | 6 months from purchase, tied to a specific launch project |
| Maintain (monthly recurring) | One-month rollover allowed; expires at end of following month |

### B.6 Refund policy

| Bucket type | Refund posture |
|---|---|
| Stuck | Refundable at full €/hr on unused hours, less Stripe fees |
| Launch | Refundable at full €/hr if project not started; pro-rated if partially used and cancellation is for cause; never refundable for hours already delivered |
| Maintain | Non-refundable once charged; customer cancels future months but current month's hours stand |

### B.7 The 10% variance rule (Launch tier only)

- Engineer estimates Launch project hours at quote time (using AI co-pilot draft)
- Customer buys the matching bucket (20 / 40 / 60)
- Engineer may exceed the estimate by up to **10%** absorbed silently
- Beyond 10%: engineer submits a written justification + delta-bucket request
  through the platform; customer accepts (paying for the extra hours), reverts
  to remaining-hours hand-off, or cancels
- Variance rule does not apply to Stuck (no estimation) or Maintain (recurring)

### B.8 Engineer allocation per Maintain bucket

- Hours in a Maintain bucket are allocated to the customer's **named continuity
  engineer**
- If continuity engineer is unavailable >2 days, supervisor allocates a peer
  with full project memory access; original engineer resumes when back
- Customer is notified transparently of any peer-coverage handoff
- Same engineer is the default across Stuck → Launch → Maintain transitions
  whenever the same engineer is available, preserving the moat

### B.9 The "Pass the baton" mechanic (preserved, simplified)

The board deck's central upsell narrative survives — just expressed as
"buy this Launch hour-pack so I can take it to production for you" instead
of "accept this fixed-price quote." Implementation:

- Mid- or post-Stuck-session, engineer composes a Launch hour-bucket
  recommendation through AI co-pilot (estimated hours + bucket size)
- Customer sees a card in their session window:
  *"Want me to take this one to launch? Same engineer. Estimated 20 hours.
  Buy 20-hour Launch bucket — €680."*
- Three buttons: **Buy bucket** · **See estimate detail** · **Not yet**
- On Buy: 100% upfront payment, current Stuck session ends free, kickoff
  scheduled within 24h

### B.10 What is OBSOLETE under this model

The following sub-decisions previously locked through I5 are now obsolete:

- **I5.g** — Definition of done per S/M/C tier (no fixed-price tiers)
- **I5.h** — Customer change-requests during Leg 2 (no fixed-price scope)
- **I5.i** — Complexity mismatch re-quoting (10% variance rule replaces it)
- **I5.k** — EU 14-day right-of-withdrawal waiver (refund policy replaces it)

The following are PRESERVED but reinterpreted:

- **I5.a** — 100% upfront payment (now: 100% upfront for the hour bucket)
- **I5.b** — Engineer drafts via AI co-pilot (now: drafts the bucket
  recommendation, not the SOW)
- **I5.c** — Anthropic-style refund posture (now: codified in B.6 above)
- **I5.d** — Same-engineer guarantee (preserved in B.8)
- **I5.e** — Pricing guardrails (now: bucket sizes are the guardrails;
  custom pricing requires supervisor approval)
- **I5.f** — Quote then pay then begin (now: bucket purchase then begin)

---

## Section C: Critical Decisions

### C1 — Accent Neutralization

**Spec language**:

> Accent neutralization is integrated into the platform from day 1 as an
> engineer-initiated, mid-session, on-demand capability. Engineers can launch
> it with a single click when accent comprehension becomes an obstacle.
> Initial deployment is a controlled pilot on a small cohort of engineers;
> activation rate, customer reaction, and call quality are measured before
> broad rollout. Customers must consent at the moment the engineer activates it.

**Sub-decisions**:

| # | Decision |
|---|---|
| C1.a | Platform absorbs the per-minute cost in v1 (not billed as a separate line item to customer) |
| C1.b | Customer consent banner appears mid-call when engineer activates: "Your engineer is enabling real-time voice clarity. Accept to continue." Two buttons: Accept / Keep original. Default = Accept after 5 seconds with audit log |
| C1.c | Pilot cohort: 10–15 engineers in Phase 1; expand to all of Phase 1 if NPS ≥ +5 vs. control after 60 days |
| C1.d | Recording behavior: record both streams (original + neutralized). Customer-facing playback uses neutralized; internal review uses original |

**Implementation notes**:

- Vendor: Sanas-class real-time accent neutralization SDK (or Krisp Accent Localization)
- Wired into Zoom Video SDK audio path on engineer console
- One-time engineering cost: $130–180K
- Year-1 run rate: $2K/mo (Phase 1 pilot, 100 engineers); scales to ~$15–25K/mo at Phase 3 (1,000 engineers, 10% activation rate)
- Privacy: GDPR Article 9 (biometric voice data) DPIA required before launch
- MVP launch impact: +6–8 weeks
- Year-1 total cost: ~$300–450K

---

### C2 — Registration & Auth Flow

**Spec language**:

> Relay.green registration mirrors claude.ai's flow: passwordless email-code
> authentication, mandatory phone-OTP verification, optional Google/Apple SSO.
> No card required at signup; payment method is requested only at the
> 10-minute paid-session gate (Section C5) or at first bucket purchase.

**Registration screens** (claude.ai mirror):

| # | Screen | Inputs | Out |
|---|---|---|---|
| 1 | Welcome | Continue with Google / Apple / email | Branch |
| 2a | Email entry | email | Send 6-digit code |
| 2b | OAuth | popup | Skip to step 5 |
| 3 | Verify email | 6-digit code (auto-advance) | Verify |
| 4 | Phone number | country selector + phone | Send SMS OTP |
| 5 | Verify phone | 6-digit code | Verify |
| 6 | Profile | First name + preferred name (optional) | Save |
| 7 | AI track preference | 9 logo tiles, multi-select | Save |
| 8 | Terms & policies | 2 inline checkboxes (ToS + monitoring disclosure) | Land in app |

**Free-tier abuse prevention** is satisfied by mandatory phone-OTP verification
(industry-proven ~80% reduction in fake account creation per Twilio data) plus
device fingerprinting (FingerprintJS or Castle.io) as a fraud-override signal.

**Implementation notes**:

- Email OTP via Resend or SendGrid
- Phone OTP via Twilio Verify (~$0.05/OTP)
- OAuth via NextAuth or Clerk (already in I2 technology list)
- Device fingerprinting: FingerprintJS Pro free tier covers v1
- Total year-1 cost: ~$300–600/mo at 10K users + ~$200–500/mo for fingerprinting

---

### C3 — Currency & Rate Cards

**Spec language**:

> Relay.green publishes locked rate cards in 4 currencies for v1: EUR, USD, GBP,
> INR. Customer's billing currency is detected by IP geolocation at signup with
> manual override, and locked to the customer's account thereafter. Stripe
> Multi-Currency Pricing charges customers in their local currency; settlement
> currency for Relay.green reporting is EUR. Rate cards are reviewed quarterly,
> with auto-trigger to re-publish if FX moves >5% on any pair.

**Sub-decisions**:

| # | Decision |
|---|---|
| C3.a | Region detection at signup via IP geolocation; user can override the dropdown |
| C3.b | Customer cannot self-service change currency after lock; support-ticket only |
| C3.c | Enterprise wallet currency set by enterprise admin at org creation; locked to org |
| C3.d | Public pricing pages display IP-detected currency by default with a footer switcher |

**Locked rate card** is in Section B.2.

**Implementation notes**:

- Stripe Multi-Currency Pricing (no extra fee, included in standard Stripe pricing)
- Engineering cost: ~1 week
- INR uses Indian numbering (lakh notation)

---

### C4 — Tax / VAT / GST Handling

**Spec language**:

> Relay.green uses Stripe Tax for automatic tax calculation across all 4 v1
> currencies. Stripe Tax is configured to:
> - Charge VAT on EU/UK B2C sales (registered via Stripe's OSS scheme)
> - Honor B2B reverse-charge for EU/UK enterprise customers with a valid VAT ID
> - Calculate state-level sales tax for US customers per economic-nexus rules
> - Apply 18% GST on Indian transactions
> - Display tax-inclusive prices in EU/UK, tax-exclusive in US/India (regional convention)
> - File returns automatically in jurisdictions where Stripe Tax filing is supported

**Implementation notes**:

- Engineering cost: 2–3 days
- Run-rate fee: 0.5% of taxable transactions (~$250/month at month-1 scale)

---

### C5 — 10-Minute Cliff UX Flow

**Spec language**:

> At minute 7 of the customer's first session, the system silently prompts for
> card-on-file via a non-blocking toast. The engineer console shows a pre-cliff
> indicator and can manually trigger the card sheet earlier if the customer is
> ready. At minute 10, if a card is on file, a single-click "Continue at €39/hr"
> pop-up appears without breaking audio. If no card is on file, a 60-second
> grace period applies with engineer-extendable +2-minute button (capped once
> per customer-lifetime, audit-logged). If the card is declined, system offers
> Apple Pay / Google Pay / PayPal as 1-click alternates; if all fail, polite
> session end with email follow-up containing a one-click resume link.

**Locked sub-decisions**:

| # | Decision |
|---|---|
| C5.a | Card pre-collection at minute 7 (default); engineer can trigger earlier |
| C5.b | b5 — 60s grace + engineer one-click "+2 min" button, capped at once per customer-lifetime, audit-logged |
| C5.c | Audio stays live during grace |
| C5.d | d3 — Multi-method retry (Apple Pay / Google Pay / PayPal) on decline; polite end + email if all fail |
| C5.e | Grace minutes free to customer; engineer paid for time per O1 |

**Customer/engineer view by time**:

| Time | Customer sees | Engineer sees |
|---|---|---|
| 0:00 | "10 minutes free with Priya" + countdown | Triage context + timer |
| 7:00 | Soft toast: "Add your card to keep going past 10 min" | Console toast: "Pre-cliff prompt sent" |
| 7:30 (eng-override) | Engineer-triggered card sheet | "Card sheet sent" |
| 9:00 | More prominent: "1 min of free time left" | "30s to cliff" indicator |
| 10:00 (card on file) | "Continue with Priya at €39/hr?" — 1 click | "Customer at cliff. Awaiting decision." |
| 10:00 (no card) | 60s grace + insistent card modal; audio continues; mute at 11:00 if no decision | Same view + "+2 min" button |

---

### C6 — Engineer Real-Identity Protection in Zoom

**Spec language**:

> All Relay.green sessions run on Zoom Video SDK embedded in Relay.green's
> customer and engineer consoles. Engineer joins are blocked from native Zoom
> clients at the platform level. Engineer display name is `aliasName` (first
> name + last initial only, e.g., "Priya R."). Engineer must use a
> Relay.green-branded virtual background during all sessions. Camera default-on,
> customer-controllable. Recording is owned by the Relay.green Zoom org account;
> recording metadata never contains engineer real name. Customer fallback to
> native Zoom join URL is permitted only when the embed cannot load (with
> explicit "you are leaving the secure embed" notice). All joins are
> server-audited; alias mismatch terminates the session.

**Locked sub-decisions**:

| # | Decision |
|---|---|
| C6.a | Block engineer's native Zoom client completely — Video SDK only |
| C6.b | Customer-controllable camera state, both on by default |
| C6.c | Customer can fall back to native Zoom only when embed cannot load |
| C6.d | Engineer alias = first name + last initial (no country code) |

**Implementation notes**:

- Zoom Video SDK ($10–25K setup) is the same SDK used for accent neutralization
  (C1) — single integration covers both
- Engineer-side Zoom desktop client login must be platform-blocked at the org
  Zoom admin level
- Branded background asset is centrally managed — engineer cannot upload custom
- Audit log captures: alias used, real userId (server-side), session ID, timestamp

---

## Section D: Important Decisions

### I1 — Triage Questionnaire

**Spec language**:

> Pre-match: 5 single-select questions (AI tool, help category, product type,
> urgency, language=English-default). Post-match: 1 required free-text + 5
> optional context fields collected during 90s wait. AI assistant produces an
> "engineer briefing card" from all answers, displayed to the matched engineer
> at join-time. English is the sole supported language for v1. Additional
> languages deferred to Phase 3+.

**Pre-match questions (≤20 seconds, all single-select)**:

| # | Question | Type | Drives matching by |
|---|---|---|---|
| 1 | Which AI tool are you using? | 9 logo tiles | AI-track specialization |
| 2 | What kind of help do you need? | 6 chips: Stuck on a bug · Can't deploy · Connecting another tool · Something doesn't make sense · Going live · Something broke after it was working | issueCategory → engineer skill match |
| 3 | What are you building? | 7 chips: Website · Web app · Mobile app · Internal business tool · Automation · Dashboard · Other | productType → engineer experience match |
| 4 | How urgent? | 3 chips: Right now · Sometime today · This week is fine | Queue priority |
| 5 | Preferred language | English (auto-default v1) | language match |

**Post-match questions (during 90s wait)**:

| # | Question | Required? |
|---|---|---|
| 6 | Tell me what's happening — in your own words | Yes |
| 7 | What error or behavior are you seeing? | Optional |
| 8 | What have you tried already? | Optional |
| 9 | Drop in screenshots, logs, or files | Optional (file upload) |
| 10 | Any code link? (GitHub repo, Lovable share link, Cursor session, etc.) | Optional |
| 11 | Have you worked with a Relay.green engineer before? | Auto-suggested if continuity exists |

**Locked sub-decisions**:

| # | Decision |
|---|---|
| I1.a | Q6 required; Q7–Q10 optional |
| I1.b | No extra enterprise question — no friction add |
| I1.c | English only at launch |
| I1.d | AI-suggested issue category for chip-vs-text mismatches |

**The engineer briefing card** (produced by Claude Haiku from all answers,
displayed to engineer at match time):

```
Customer briefing — Anita F. (Lyon, 11 PM local)
- Tool: Lovable, building a web app (e-commerce)
- Issue: Connecting another tool — Stripe webhook returning 401 in production
- Tried: regenerated webhook secret twice, restarted deploy
- Files: 1 screenshot of error log, 1 paste of webhook URL config
- Continuity: First-time customer (no preferred engineer)
- Suggested engineer skills: Stripe, webhooks, Lovable deploy, EU evening availability
```

---

### I2 — Engineer Skill Taxonomy

**Spec language**:

> Engineer skills are tracked across 4 enum'd categories: AI_TOOL (9 values),
> PRODUCT_TYPE (7 values), FUNCTIONAL_EXPERTISE (12 values), TECHNOLOGY (~45
> values, opinionated toward modern AI-tool-built stacks). Each skill has a
> proficiency (FAMILIAR / PROFICIENT / EXPERT) and a verified flag. Engineers
> self-declare initially; the onboarding factory verifies skills over time.
> No minimum verified-skill count is required for go-live (engineering quality
> is assured at hire time). Matching falls back to highest weighted overlap on
> AI_TOOL + ISSUE_CATEGORY when no exact match exists, with explicit "best
> available — not exact" UX badge.

**AI_TOOL (9)**:
> Claude · ChatGPT · Gemini · Copilot · Cursor · Lovable · Replit · v0 · Bolt

**PRODUCT_TYPE (7)**:
> Website · Web app · Mobile app · Internal business tool · Automation · Dashboard · Other

**FUNCTIONAL_EXPERTISE (12, ordered by frequency of citizen-builder pain)**:

| # | Area |
|---|---|
| 1 | Deployment / DNS / SSL / going-live |
| 2 | Authentication & identity |
| 3 | Payments |
| 4 | Database / data modeling |
| 5 | Third-party integrations (CRM, email, APIs) |
| 6 | Frontend / UI |
| 7 | Backend / API |
| 8 | AI / LLM integration |
| 9 | Security & secrets |
| 10 | Email / Notifications |
| 11 | Analytics / Observability |
| 12 | Mobile |

**TECHNOLOGY (45, AI-tool-first)**:

| Group | Values |
|---|---|
| Languages | TypeScript · JavaScript · Python |
| Frontend | React · Next.js · Vue · Svelte · Tailwind CSS · shadcn/ui |
| Backend | Node.js · Hono · Express · NestJS · FastAPI |
| Databases | PostgreSQL · Supabase · Neon · MongoDB · Firebase · Redis · pgvector |
| Hosting / deploy | Vercel · Netlify · Cloudflare · Railway · Fly.io · AWS · GCP |
| Auth | Clerk · Supabase Auth · NextAuth · Auth0 |
| Payments | Stripe · Paddle · Lemon Squeezy · Razorpay |
| AI providers | Anthropic API · OpenAI API · Vercel AI SDK · LangChain · OpenRouter |
| Comms | Resend · Twilio · SendGrid · Postmark |

**Proficiency**:

| Level | Match weight |
|---|---:|
| FAMILIAR | 0.4 |
| PROFICIENT | 0.7 |
| EXPERT | 1.0 |

Unverified self-claims use 60% of declared weight.

**Locked sub-decisions**:

| # | Decision |
|---|---|
| I2.a | 12 functional areas as listed |
| I2.b | ~45 technologies; engineer-submitted additions reviewed weekly |
| I2.c | 3-level proficiency (FAMILIAR / PROFICIENT / EXPERT) |
| I2.d | No minimum verified-skill gate at launch |
| I2.e | Fallback: highest weighted overlap on AI_TOOL + ISSUE_CATEGORY with explicit "best available" badge |

---

### I3 — AI Risk-Scoring v1 (Supervisor Red-Card System)

**Spec language**:

> Supervisor red-card system uses a hybrid rules + Claude Haiku scoring model.
> Rules deterministically catch obvious signals (silence, latency, secret
> leakage); Claude Haiku scores ambiguous sessions every 30s (yellow zone) or
> 10s (look-harder zone). Composite risk score (0–100) drives green/yellow/red
> card states. Red cards trigger supervisor push notification and surface
> specific triggering signals + a 30s auto-summary. Three supervisor actions:
> private message, join visibly (with customer permission), take over.
> False-positive target ≤15%, recalibrated weekly via supervisor feedback.
> Supervisor can override AI for 5-min windows.

**Signals & thresholds**:

| Signal | Source | Look-harder threshold | Red-card threshold |
|---|---|---|---|
| Silence duration | Transcript timing | >30s mid-session | >60s |
| Customer sentiment | Claude on transcript | Score ≤ 0.4 | Score ≤ 0.2 |
| Engineer response latency | Transcript timing | >15s avg over last 5 turns | >30s avg |
| Repetition / confusion loop | Claude (semantic) | Customer rephrases same Q ≥3× | ≥4× |
| Engineer uncertainty | Claude (linguistic) | "I'm not sure" >2× per 5 min | >4× |
| Security-sensitive content | Regex + Claude | Detected secret-shape | Engineer asks for credential |
| Billing dispute language | Claude (semantic) | "this is taking too long" | "I'm not paying", "refund" |
| Session over-running | Time | >40 min on a single Stuck issue | >60 min |
| Topic drift | Claude (semantic) | Drifts from triage's stated issue | Drifts >2 turns away |
| Customer abuse / toxicity | Claude (toxicity) | Score ≥0.5 | ≥0.7 |
| AI copilot low-confidence | Internal | <40% confidence | <20% |

**Card states**:

- 🟢 Green: 0–30
- 🟡 Yellow: 31–60 (visible to supervisor; no urgent prompt)
- 🔴 Red: 61+ (push notification + pulse)

**Locked sub-decisions**:

| # | Decision |
|---|---|
| I3.a | Claude Haiku 4.5 |
| I3.b | 30s yellow / 10s look-harder cadence; green sessions are rules-only |
| I3.c | Disclosure already at signup checkbox (O3) |
| I3.d | ≤15% FP target, weekly recalibration |
| I3.e | 5-min supervisor override of AI score |

---

### I4 — Recording Consent UX Flow

**Spec language**:

> Recording is off by default. Either party can request recording mid-session
> via a "Request recording" button; the other party sees an inline
> accept/decline banner. Both consents (with timestamps) are logged before
> recording starts. Engineer, customer, or supervisor (if joined) can initiate.
> AI-initiated recording is not permitted at v1. Either party can stop
> recording at any time. Recordings are retained 90 days by default (365 days
> configurable at enterprise org level), accessible to customer (always),
> assigned engineer (90 days), supervisor (supervised pod only), and internal
> admin (audit-logged). Enterprise admins cannot access recordings — metadata
> only. Customer-initiated recording is blocked if engineer declines, and
> engineer decline patterns are audit-logged for periodic review.

**Locked sub-decisions**:

| # | Decision |
|---|---|
| I4.a | 90-day default retention; 365-day configurable at enterprise org level |
| I4.b | Access tiers: customer (always), engineer (90d), supervisor (supervised pod 90d), internal admin (audit-logged); enterprise admin = NO content access (metadata only) |
| I4.c | Engineer decline overrides customer request; decline patterns audit-logged |

---

## Section E: Operational Decisions Resolved

### O3 — Supervisor Monitoring Disclosure

**Spec language**:

> Supervisor monitoring is disclosed at signup via an inline checkbox at
> registration step 8: "I understand my session may be monitored for quality."
> No additional in-session prompt is required. EU-GDPR compliant under
> recital 47 (legitimate interest + transparent prior notice).

**Already resolved at signup checkbox** in C2 step 8.

---

### Design System Spec

**Spec language**:

> Relay.green's visual design follows Anthropic's claude.ai language. shadcn/ui
> component primitives are themed to match cream/coral palette with serif
> headers and sans-serif body. Single-column registration, generous whitespace,
> calm minimal aesthetic across all five consoles.

**Color tokens**:

| Token | Value | Usage |
|---|---|---|
| `--background` | `#F5F4EE` | Page bg, light mode |
| `--background-dark` | `#2C2A26` | Page bg, dark mode |
| `--surface` | `#FFFFFF` | Cards, modals, light mode |
| `--surface-dark` | `#1F1E1B` | Cards, modals, dark mode |
| `--primary` | `#D97757` | Primary CTA only — sparingly |
| `--primary-hover` | `#C66645` | Hover state |
| `--text` | `#2C2A26` | Body text |
| `--text-muted` | `#6B6862` | Secondary text |
| `--border` | `#E8E5DD` | Subtle 1px borders |
| `--green-dot` | `#3DCB7E` | Brand green dot — launch button only |
| `--accent-red` | `#C8553D` | Supervisor red-card alerts only |

**Typography**:

| Element | Font | Size | Weight |
|---|---|---|---|
| Page title H1 | Source Serif 4 | 32–40px | 500 |
| Section H2 | Source Serif 4 | 22–24px | 500 |
| Body | Inter | 15–16px | 400 |
| Button label | Inter | 14–15px | 500 |
| Input | Inter | 16px | 400 |
| Code/mono | JetBrains Mono | 14px | 400 |

Source Serif 4 + Inter are free open-source equivalents to Anthropic's
Copernicus + Styrene B. Future migration to Klim Type Foundry licensed
fonts is a $5–7K decision and trivially retrofittable.

**Component conventions** (shadcn/ui themed):

- Button: `rounded-md` (6px), `px-4 py-2.5`, primary uses `--primary`
- Input: `rounded-md`, `px-3 py-2.5`, focus ring `--primary` 2px
- Card: `rounded-xl` (16px), `bg-surface`, subtle shadow `0 1px 3px rgba(0,0,0,0.04)`
- Dialog: centered, `rounded-xl`, max-width 480px, dim backdrop

**Console layouts**:

| Surface | Layout |
|---|---|
| Customer dashboard | Left rail (256px): Projects + Sessions list. Right pane: active conversation. Top right: green dot launcher always visible |
| Engineer console | Left rail: assigned customers. Center: current session split-view (transcript top, AI copilot bottom). Right: customer/project memory |
| Supervisor console | 10-card grid (responsive 5×2 / 4×3 / 3×4 / 2×5). Cards 280×180px; red-state has 2px `--accent-red` border + slow pulse |
| Enterprise admin | Top filter bar. Stat tiles (4-up). Usage table (TanStack Table or shadcn Table) |
| Internal admin | Same chrome as enterprise but cross-tenant data and ops actions |

---

## Section F: Operational Decisions (continued)

### O1 — Engineer Compensation Model (RESOLVED)

**Spec language**:

> Engineers in Phases 1–2 are salaried Gateway Digital employees; salary is set
> externally by Gateway HR and is not part of the platform's billing engine.
> The platform calculates a **3% bonus on customer-billing attributed to each
> engineer** (computed in EUR-equivalent against the locked rate-card values
> per C3), exported monthly to Gateway payroll for inclusion in the engineer's
> variable compensation. The 3% rate is admin-configurable globally (default
> = 3%) and overridable per-engineer through the Internal Admin console for
> retention or recognition purposes. Free-trial minutes and no-show sessions
> generate €0 billing → €0 bonus contribution; engineers still receive
> Gateway salary for that time per Gateway HR policy. For Phase-3+ external
> engineers, compensation flows under Model C: 60% of customer payment per
> hour delivered, paid via Stripe Connect, with no salary or platform-tunable
> bonus override.

**Locked sub-decisions**:

| # | Decision |
|---|---|
| O1.a | 3% bonus of attributed customer billing (EUR-equivalent), admin-tunable globally + per-engineer |
| O1.b | Engineer dashboard: live hours today + MTD + projected monthly bonus; monthly settled statement |
| O1.c | Free-trial 10 min: engineer salaried for time; no platform bonus contribution |
| O1.d | Cancelled / no-show sessions: engineer salaried for ready-time; no platform bonus contribution |
| O1.e | Phase-3 external engineer model: 60/40 split via Stripe Connect |
| O1.f | `EngineerCompensationProfile` entity stores per-engineer comp parameters; new entity in Architecture v1.1 |

**Implementation notes**:

- Billing attribution: each `HourLedgerEntry` already carries `engineerProfileId`. Bonus calculation aggregates `amountDrawn` (in EUR-equivalent) per engineer per month
- Monthly bonus payroll export: cron job runs first business day of month, generates per-engineer report, sends to Gateway payroll vendor (CSV / API)
- Per-engineer override: stored on `EngineerCompensationProfile.bonusPercentage`; default 3.00, range 0.00–10.00; changes audit-logged
- For external engineers, Stripe Connect Custom or Express account per engineer; weekly payouts; 1099 / equivalent tax form generation handled by Stripe Connect

---

### O2 — Zoom-Failure & Late-Engineer Billing Policy (RESOLVED)

**Spec language**:

> Customer is never charged for platform-fault session failures. Affected
> minutes are credited back to the customer's hour-bucket by default;
> customer may request cash refund via support. Engineer paid for ready-time
> per Gateway salary; no platform bonus contribution on €0 billing per O1.c/d.
> All session abnormalities (dropouts, no-shows, late joins, customer
> drop-outs) are logged in the SessionInterruption entity and feed both
> reliability SLA reporting and per-engineer quality metrics.

**Per-scenario billing rules**:

| Scenario | Customer charge | Bucket impact | Audit |
|---|---|---|---|
| Zoom embed fails to start | €0 | No drawdown | `PLATFORM_FAULT_EMBED` |
| Zoom dropout — both reconnect within 5 min | Drawdown pauses; resumes on reconnect | Outage minutes returned | `ZOOM_OUTAGE` |
| Zoom dropout — no reconnect within 5 min | Drawdown stops at moment of dropout | Outage minutes returned | `NEVER_RECOVERED` |
| Engineer accepts but doesn't join within 90s | €0 | No drawdown | `ENGINEER_NO_SHOW` |
| Engineer joins 90s–5min late | Drawdown starts at actual join | Normal | `ENGINEER_LATE_JOIN` |
| Engineer joins >5 min late | €0 entire session | Minutes returned | `ENGINEER_VERY_LATE` |
| Customer drops out, no return in 5 min | Drawdown stops at dropout | Pre-dropout minutes consumed | `CUSTOMER_DROPOUT` |
| Customer dropout in first 60s | €0 grace if engineer agrees session was non-started | Minutes returned | Engineer-flagged |
| Customer-side network outage | Same as customer dropout | Same | `CUSTOMER_NETWORK_OUTAGE` |

**Locked sub-decisions**:

| # | Decision |
|---|---|
| O2.a | Default = bucket credit; customer can request cash refund via support |
| O2.b | Engineer late threshold for "very late" = 5 minutes |
| O2.c | Engineer no-show consequences: 1st = warning + supervisor 1:1; 2nd within 30d = pulled from shift availability; 3rd = HR escalation |
| O2.d | Reconnect window after Zoom dropout = 5 minutes |
| O2.e | Customer-side outage: stop drawdown on WebRTC signaling drop; resume on reconnect; treat as dropout if no reconnect in 5 min |
| O2.f | Internal admin dashboard tracks: session completion rate, MTTR, per-engineer no-show rate |
| O2.g | Customer-facing transparency: "Sorry — we hit a technical issue. Your X minutes have been credited back. Want to try again now?" with single re-match button |

**Implementation notes**:

- New entity: `SessionInterruption` (added to Architecture v1.1)
- WebRTC signaling drop detection in customer console + engineer console; mirrored telemetry to platform backend
- Re-match flow shares triage context from prior failed session — customer should not have to re-answer triage
- Engineer no-show counter resets every 30 days

---

### O4 — Mobile App Phasing (RESOLVED)

**Spec language**:

> Mobile experience ships in two stages. **Stage 1 (Phase 1, alongside the
> customer web app)**: Progressive Web App (PWA) for both customer and
> engineer, built on Next.js with workbox-based service worker, Web Push
> notifications, install-to-home-screen, offline support, and camera access
> for screenshots. **Stage 2 (Phase 4)**: native iOS and Android apps for
> mobile-specific features (background voice notes, lock-screen Zoom
> controls, native Apple Pay / Google Pay, biometric login). Mobile primary
> use case is between-session chat, file sharing, calendar, and billing
> review; **live Zoom sessions stay desktop-only at v1** because AI
> co-pilot, transcription, accent neutralization, and engineer console are
> desktop-optimized. Trigger for native app development is >40% of
> customer-engineer messages sent on mobile.

**Locked sub-decisions**:

| # | Decision |
|---|---|
| O4.a | Mobile primary use case = between-session comms (chat, files, calendar, billing); live Zoom desktop-only at v1 |
| O4.b | PWA framework: Next.js App Router + workbox service worker + Web Push; mobile-tuned routes activate by viewport |
| O4.c | Native app trigger: >40% of customer-engineer messages on mobile |
| O4.d | Engineer mobile = engineer PWA in Phase 1; native engineer app in Phase 4 alongside customer native |
| O4.e | Push at v1 = Web Push (covers iOS 16.4+ Safari and all Android browsers, ~95% reach); native APNs/FCM deferred |
| O4.f | Native-only features deferred: background voice recording, lock-screen Zoom controls, native Apple Pay / Google Pay, biometric login, deep iOS Shortcuts / Android Tasker |

**Implementation notes**:

- PWA can be built into the customer / engineer web codebase with ~5–8 days of additional engineering (manifest + service worker + Web Push subscription)
- Web Push requires a VAPID key pair generated at platform initialization, stored in env config
- iOS Safari requires user to install the PWA to home screen before push permission can be requested; UX prompt copy: "Install Relay.green to get notified when your engineer is ready"
- Native app phase (Phase 4) re-evaluated against the >40% mobile-message trigger; build estimate at that point: ~12 weeks each platform with React Native or Expo

---

### O5 — Domain & Brand Independence (RESOLVED)

**Spec language**:

> Relay.green operates as a fully independent customer-facing brand. All
> customer-visible surfaces — domain, email, OAuth callbacks, marketing,
> footer, transactional copy — refer to Relay.green only and **do not
> reference Gateway Digital, thegatewaydigital.com, or any Gateway parent
> brand**. Internal operational realities (engineer payroll under Gateway
> HR, Gateway as parent entity) remain platform-internal and never surface
> to the customer or in any customer-facing endpoint.

**Locked sub-decisions**:

| # | Decision |
|---|---|
| O5.a | Primary production domain = `relay.green` |
| O5.b | Fallback domain on contest = an independent Relay.green-owned TLD (e.g., `relay.app`, `getrelay.com`); NOT a Gateway sub-domain. Platform supports alternate domain via env-var swap |
| O5.c | Trademark notice: `© Relay.green. All rights reserved.` Legal entity selection (Relay.green Pvt Ltd vs. Gateway parent) is a separate legal-track decision; customer-facing string is "Relay.green" only |
| O5.d | All email from `@relay.green` only — `support@relay.green`, `support@relay.green`, `support@relay.green`, `support@relay.green`. No `@gatewaygroup.com` in customer-facing flows |
| O5.e | OAuth callback URLs whitelist **only `relay.green`**. No `thegatewaydigital.com` anywhere in OAuth configs, redirect URIs, or customer-facing references |
| O5.f | Brand-conflict response plan: 14-day evaluation, then negotiate / rename / relocate; architecture supports rename via env-var swap |
| O5.g | Auto-renew for 5+ years; calendar alert at year-3 to extend |
| O5.h | WHOIS privacy enabled |
| O5.i | Wildcard SSL via Let's Encrypt or Cloudflare; auto-renewing |
| O5.j | Customer-facing brand independence: no Gateway Digital references in any customer surface (UI text, email body, error messages, footer, terms, privacy, OAuth screens). Engineer console may show "Powered by Gateway" only on engineer-onboarding-internal screens, never on customer-facing surfaces |

**Legal entity decision (RESOLVED)**:

Relay.green is a **separate legal entity** from Gateway Digital. This entity
is the customer-facing party for: trademark ownership, Stripe account holder,
GDPR data controller, all customer contracts (Terms of Service, Privacy
Policy, DPA), and all customer-facing receipts and invoices. Engineering
services are provided to Relay.green by Gateway Digital under an
engineering-services agreement; engineers remain Gateway employees but
their delivered hours are invoiced to the Relay.green entity, which in turn
bills the customer.

**Knock-on effects on already-locked decisions**:

| Decision | Impact |
|---|---|
| O1 — Engineer commission | Relay.green entity pays Gateway for engineering services (cost-of-revenue); Gateway pays the 3% bonus to engineers via standard payroll. Platform accounting unchanged. |
| C3 — Stripe account | Held in Relay.green entity name; settlement currency EUR |
| C4 — Stripe Tax | Tax registrations (EU OSS, UK VAT, US economic-nexus, IN GST) under Relay.green entity |
| O5.c — Trademark | Trademark applications in Relay.green entity name in EU, US, India for v1 |
| GDPR / DPA | Relay.green entity = data controller; Gateway = sub-processor under engineering-services agreement |

**Remaining legal-track follow-ups**:

- Engineer-services agreement between Gateway and Relay.green: covers rates, IP ownership, data handling, engineer alias enforcement, indemnification
- Specific incorporation jurisdiction for Relay.green entity (likely matches primary market or favorable HQ) — separate decision

**Implementation notes for engineering**:

- All hardcoded brand strings must come from a single config (`brand.config.ts`) — no inline "Relay.green" strings in code; supports rename in <1 day if ever needed
- Email templates use `{{brand.name}}` and `{{brand.email.support}}` placeholders, sourced from brand config
- DNS configured for both `relay.green` and the future fallback alternate (TBD); both pointed to Vercel/Cloudflare; only one active at a time
- Internal admin console may show parent operational data (Gateway HR sync status, payroll exports, internal IDs) — this is acceptable as it's never customer-facing

---

## Section G: Out-of-Scope (Operations Track)

The following items are explicitly **out of the platform-build scope** and
are managed by Relay.green operations / legal / HR teams separately:

| # | Topic | Owner |
|---|---|---|
| O6 | Engineer onboarding factory + certification gates | Operations / HR |
| Legal | Company formation, trademark filings, engineer-services agreement | Legal counsel |
| Brand | Logo design, brand guidelines, marketing site copy | Marketing |
| Training | Engineer training curriculum content | Ops + L&D |

Platform engineering supports these workstreams via existing entities and
admin surfaces (e.g., `EngineerCompensationProfile`, internal admin
console, audit log) but is not responsible for delivering the operational
content itself.

**All platform-spec decisions are now closed. Implementation may proceed.**

---

## Section H: Implementation Handoff Notes

### H.1 Stack (locked)

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui themed per Design System Spec
- Prisma ORM + PostgreSQL
- Stripe (Multi-Currency + Stripe Tax) for payments
- Zoom Video SDK for realtime media
- Anthropic API (Claude Haiku 4.5) for AI risk-scoring + engineer co-pilot + triage summarization
- Twilio Verify for phone OTP
- Resend (or SendGrid) for email OTP + transactional email
- npm as package manager
- Repository: `D:\TGCCORPCODEX\relay-green` (per existing build checklist)
- Demo auth + mocked providers in Phase 0; real providers in Phase 4

### H.2 First-build sequence (overrides backlog Milestone 6 only; everything else stands)

The implementation backlog at `RelayGreen_Implementation_Backlog_v1.md` stands
unchanged for Milestones 0–5 (Foundation, Data, Auth, Customer Flow, Matching,
Session Lifecycle). Milestone 6 (Billing v1) is REPLACED with:

- **RG-0601 (REVISED)** — Hour-bucket ledger engine
  - HourBucket entity (engagement type, size, price paid, hours remaining,
    expiration, refund status)
  - HourLedgerEntry entity (bucket reference, session reference, minutes drawn,
    cost in EUR-equivalent)
  - Drawdown service: per-second internal, per-minute display
  - First 10 free minutes special case (no bucket required for first session)
- **RG-0602 (REVISED)** — Bucket purchase UI
  - 8 buckets visible; locked to customer's currency
  - Stripe Multi-Currency checkout
  - Stripe Tax wired
  - Apple Pay / Google Pay enabled (per C5.d)
- **RG-0603 (REVISED)** — Drawdown billing records
  - LedgerEntry created per minute drawn
  - Reconciliation report for internal admin

### H.3 Critical risks / dependencies

| Risk | Mitigation |
|---|---|
| Zoom Video SDK quota at 10K month-1 users | Engage Zoom enterprise contract early; reserve capacity for Phase 1 |
| Sanas-class accent vendor pilot quality | 60-day pilot before broad rollout; binary go/no-go gate (NPS ≥ +5) |
| Hour-bucket model FX exposure | Quarterly rate-card review with auto-trigger at >5% FX move (per C3) |
| GDPR Article 9 voice biometric DPIA | Complete BEFORE Phase 1 customer-facing launch |
| relay.green domain / trademark | Resolve in O5 before public marketing begins |

### H.4 Verification checklist for full spec re-alignment

After this document is published, the following must be verified:

- [ ] PRD Section 3 rewritten to describe hour-bucket model
- [ ] Spec Draft Sections 4.1, 4.2, 4.3 collapsed into a single hour-bucket Section 4
- [ ] Spec Draft Section 7.6 rewritten for drawdown ledger logic
- [ ] Architecture Section 4.20 (BillingRecord) updated for HourLedger
- [ ] Architecture Section 4 — new entities HourBucket and HourLedgerEntry added
- [ ] Architecture Section 7 (Billing Logic) rewritten
- [ ] Implementation Backlog Milestone 6 tickets revised
- [ ] All 4 currencies + locked rate cards present in PRD pricing section
- [ ] End-to-end customer journey test reads cleanly: signup → 5-hr Stuck bucket
      → engineer recommends Launch → 20-hr Launch bucket → engineer delivers in
      18 hrs → 50-hr Maintain bucket
