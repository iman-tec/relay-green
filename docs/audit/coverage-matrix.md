# Coverage Matrix (Phase 5)

> Routes × roles × {Documented / Walked / Flow-tested}. Makes gaps visible.
> Legend per cell / column:
> - **Doc** = Phase 1 static route card exists.
> - **Walk** = Phase 2 live browser visit (snapshot/console/network) — `walks/*.md`.
> - **Flow** = Phase 2 end-to-end multi-step exercise — `flows/*.md`.
> - ✅ done · 🟡 partial · ⬜ not done · 🚫 blocked (reason) · n/a not applicable.
>
> As of 2026-06-06. The big gap is **Flow** coverage: the 2-party live-call run
> was BLOCKED by a dev-server outage + missing `browser_tabs`/`Bash` perms
> (`ENV-DEVSERVER-DOWN`). Static + surface layers are complete.

## Page routes — coverage

| Route | Card | Doc | Walk | Flow | Notes |
|---|---|---|---|---|---|
| `/` (home) | marketing-batch | ✅ | ✅ | 🟡 | Try-RELAY funnel driven to "no engineers" then blocked by outage |
| `/login` | login | ✅ | ✅ | ✅ | login matrix; copy bug AUDIT-LOGIN-COPY-1 |
| `/room` | room + room-client | ✅ | ✅ | 🚫 | stale paid session seen; live-call flow blocked |
| `/account` | account | ✅ | ✅ | ⬜ | |
| `/intake`, `/intake/matching/[id]` | intake, intake-matching | ✅ | 🟡 | 🚫 | matching surface = client modal on `/`, not `/intake/*` (divergence) |
| `/payment`, `/payment/success` | payment, payment-success | ✅ | ⬜ | 🚫 | success page orphaned (real flow → `/room?relay_paid=`) |
| `/call/[id]` | call | ✅ | ⬜ | 🚫 | |
| `/dashboard` | dashboard | ✅ | ✅ | ⬜ | DATA-400 KPI 400s confirmed |
| `/inbox` | inbox | ✅ | ✅ | ⬜ | engineer + supervisor |
| `/supervise` | supervise | ✅ | ✅ | 🚫 | pod view rendered; live-session-visible flow blocked |
| `/staff/session/[id]` | staff-session + engineer-session-client | ✅ | ⬜ | 🚫 | engineer workspace; needs a live session |
| `/staff/project/[id]` | staff-project | ✅ | ⬜ | ⬜ | |
| `/session-review/[id]` | session-review | ✅ | ⬜ | ⬜ | |
| `/staff/assistant` | staff-assistant | ✅ | ⬜ | ⬜ | **unprotected** (P1-1) |
| `/staff/onboarding` | staff-onboarding | ✅ | ⬜ | n/a | engineers walked past it (profiles complete) |
| `/calendar` | calendar | ✅ | ✅ | ⬜ | engineer availability |
| `/schedule` | schedule | ✅ | ✅ | ⬜ | supervisor |
| `/quotations` | quotations | ✅ | ✅ | ⬜ | engineer |
| `/bids` | bids | ✅ | ✅ | ⬜ | supervisor |
| `/finance` | finance | ✅ | ✅ | ⬜ | enterprise_admin |
| `/operations` | operations | ✅ | ✅ | ⬜ | supervisor |
| `/settings` | settings | ✅ | 🟡 | n/a | blank for non-engineer; profile-pane auto-open for engineer |
| `/admin` | admin | ✅ | ✅ | ⬜ | super_admin, URL-only (no nav) |
| `/admin/users` | admin-users | ✅ | ✅ | ⬜ | |
| `/admin/v2` | admin-v2 | ✅ | ✅ | ⬜ | bare mode; Pods-tab API bug P1-3 |
| `/enterprise/v2` (+ tabs) | enterprise-v2 | ✅ | ✅ | 🟡 | overview/usage/billing/settings walked read-only |
| `/enterprise/wallet` | enterprise-wallet | ✅ | ✅ | ⬜ | redirect → `?tab=billing` |
| `/enterprise/departments` | enterprise-departments | ✅ | 🟡 | ⬜ | redirect alias |
| `/enterprise/supervise` | enterprise-supervise | ✅ | ⬜ | ⬜ | |
| `/enterprise` (+ legacy redirects) | enterprise | ✅ | ✅ | n/a | server redirect |
| `/department/v2` | department-v2 | ✅ | ✅ | ⬜ | |
| `/department` | department | ✅ | ✅ | n/a | redirect |
| `/reseller/v2` | reseller-v2 | ✅ | ✅ | 🟡 | dashboard/enterprises/settings read-only |
| `/reseller` | reseller | ✅ | ✅ | n/a | redirect |
| `/staff`, `/staff/login` | staff-login | ✅ | ✅ | ✅ | bare `/staff` IS the login |
| `/business`, `/partner` | business-login, partner-login | ✅ | ✅ | ✅ | |
| `/set-password` | set-password | ✅ | ⬜ | ⬜ | `?surface` vs `?mode` defect (P1-8) |
| `auth/callback`, `auth/confirm` | auth-callbacks | ✅ | n/a | ⬜ | route handlers |
| legacy (`/customer`,`/engineer`,`/supervisor`,`/widget/*`) | legacy-batch | ✅ | ⬜ | n/a | redirects/null/electron — no Prisma throw |
| marketing/resources/legal/trust (40+) | marketing-batch | ✅ | 🟡 | n/a | `/` walked; rest static, card-only |

## Roles — coverage

| Role | Login | Surface walk | Core flow | Notes |
|---|---|---|---|---|
| client | ✅ | ✅ `/room`,`/account` | 🚫 live call blocked | stale session present |
| engineer | ✅ | ✅ dashboard/inbox/calendar/quotations | 🚫 needs live session | |
| supervisor | ✅ | ✅ supervise/operations/bids/schedule/inbox | 🚫 | |
| super_admin | ✅ | ✅ admin/v2, admin/users, admin | ⬜ read-only intended | |
| enterprise_admin | ✅ | ✅ enterprise/v2 + finance | 🟡 read-only | |
| department_admin | ✅ | ✅ department/v2 | ⬜ | |
| reseller | ✅ | ✅ reseller/v2 | 🟡 read-only | C3-1 oversub checked |
| client_employee | 🚫 banned | 🚫 | 🚫 | employee5 banned — needs unban/replacement |

## The 8 core flows — status

| # | Flow | File | Status |
|---|---|---|---|
| 1 | Guest Try-RELAY → ring → call → paywall | flows/1-guest.md | 🟡 funnel driven (dev); guest signup timed out (server died) |
| 2 | Customer chat-first → live call → PostCall | flows/2-customer-deploy.md + flows/2-3-two-party-live.md | ✅ **2-PARTY PROD**: connect→ring→engineer accept→both **Live**→chat both ways→engineer end→**PostCall**. ❌ except Zoom A/V (headless) + customer-join-after-call-start (**A2P-1 bug**) |
| 3 | Engineer dashboard → accept → workspace → review | flows/2-3-two-party-live.md | ✅ **2-PARTY PROD**: real `/dashboard` ring overlay (EngineerIncomingMatch w/ intake)→Accept→real `/staff/session/[id]` workspace→chat→Start Zoom→End→review |
| 4 | Supervisor pod view → act-now → escalation | flows/4-8-staff-payments.md | ✅ Live ops: live 1, Watch/act-now present, callback queue absent (expected) |
| 5 | Quote → bid → contract | flows/4-8-staff-payments.md | 🟡 both ends render; chain breaks — "Request a Quote" no-op → empty bid queue (producer gap) |
| 6 | Bookings schedule/reschedule/cancel | flows/4-8-staff-payments.md | 🟡 /schedule view + bookable slots ✅; create skipped (non-atomic, FUNC-BOOK-ATOMIC-1) |
| 7 | Enterprise/reseller/dept admin reads | walks/staff.md + walks/business.md + walks/partner.md | ✅ surface-walked (admin/v2, enterprise/v2, dept/v2, reseller/v2) |
| 8 | Payments: Stripe checkout / wallet / paywall resume | flows/4-8-staff-payments.md | ✅ Recharge → Stripe TEST checkout (pk_test) entry verified; no charge (full resume not completed) |

## Gaps & re-run requirements

**To close Flow coverage (2-party live loop — the core product):**
1. Operator restart `npm run dev` at `10.0.1.112:3000`; confirm
   `/api/online-engineers` < 1 s (`ENV-DEVSERVER-DOWN`).
2. Put the **engineer account online first** so the guest/customer funnel matches.
3. Grant `mcp__playwright__browser_tabs` (and ideally `Bash`) to the flow agent —
   two concurrent role contexts are required for realtime cross-role asserts and
   were denied last run.
4. Clear the stale "Luca joined as engineer" session on the QA customer account
   (E2E-CLEANUP-1) for a clean start.
5. Unban `employee5` (or supply a replacement) to cover the department-employee
   paywall-suppression / minutes-debit path.

**Not blocking (static-complete, live-deferred by design):** legacy routes,
marketing/legal/trust pages, `/call/[id]`, `/staff/project`, `/session-review`,
`/set-password`, auth route handlers — documented, low-risk, no live walk needed
unless changed.
