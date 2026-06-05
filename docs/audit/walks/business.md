# Phase 2 Browser Walk — Business surface (`/business`)

> Target: `https://10.0.1.112:3000` (LAN dev, self-signed cert bypassed; exception in
> profile). Date: 2026-06-06. Roles: `enterprise_admin` (tgcenterprise),
> `department_admin` (depadmin3). OBSERVE-MOSTLY. Passwords never printed.
> Logins via POST `/api/auth/signin-password` (`surface:"business"`), both 200.

## Enterprise admin (tgcenterprise@yopmail.com → `/enterprise/v2`)

StaffShell-wrapped, enterprise nav: **Overview, Usage, Billing, Settings**. Account chip
"tgcenterprise / Enterprise Admin". Stripe (`pk_test`) loads for billing.

- **`/enterprise/v2?tab=overview`** — "Hi Tgcenterprise · Enterprise console". Org
  **TGC Capital IT · 7 members · 5 staff**; KPIs Spend €0.00 / Live now 0 / Sessions 9
  (30d) / Avg 0.3m; Recent sessions list; Top departments. Sub-tabs Dashboard /
  Departments / Members. `qa/screens/enterprise-v2-overview.png`.
- **`?tab=usage`** — "Usage & reporting", Export CSV, Usage-by-month chart, Usage-by-
  department (Finance 3 mem · 1.352m · €4.06; test/Engineering/Marketing 0m).
  `qa/screens/enterprise-v2-usage.png`.
- **`?tab=billing`** — Wallet **50.648 min available / 1.352 used / 298 distributed /
  0 undistributed**; low-balance banner; Buy minutes (Starter 500m €1,500 / Team
  2,000m €5,700 / Scale 10,000m €27,000 — Buy buttons **not exercised**); Billing &
  invoices (Spend €0 / 30d €4.05 / Lifetime €4.05); active plan **Starter**; Recent
  transactions (engineering sessions). `qa/screens/enterprise-v2-billing.png`.
- **`?tab=settings`** — Organization (TGC Capital IT, domain tgc.com, **Enterprise code
  TGCCAPIT-EB87-7705**, Channel Partner **Gateway**, partner discount 0%, **promo
  discount 11% until 5/29/2027**); Internal team admins (marketing, test, depadmin3,
  tgcenterprise=enterprise_admin, Niraj Gemawat) + Invite admin; Notifications (3
  toggles ON + Save preferences); Privacy & data (retention **Indefinite**, Export,
  Member erasure); SSO (contact support). All Edit/Copy/Invite/Save **not exercised**.
  `qa/screens/enterprise-v2-settings.png`.
- **`/enterprise/wallet`** → **redirects to `/enterprise/v2?tab=billing`** (alias for
  the Billing tab; title briefly flashes the marketing title mid-redirect).
- **`/finance`** — "Finance". Revenue (This month €0 / 30d €4.05 / Lifetime €4.05);
  Feedback (AI sentiment — "No session feedback yet"). `qa/screens/enterprise-finance.png`.
- Console: only benign CSP `upgrade-insecure-requests` + Stripe-frame report-only
  violations. No crash, no Prisma stub.

## Department admin (depadmin3@yopmail.com → `/department/v2`)

StaffShell-wrapped, nav: **Supervise, Department** (department_admin is in the Supervise
NAV filter per dashboard.md). Chip "depadmin3 / Department Admin".

- **`/department/v2`** — "Hi Depadmin3 · Department console". Department **Finance · TGC
  Capital IT · 2 members**; KPIs Members 2 / Minutes used 1.352m / Remaining 33.648m /
  Allocated 50m; Recent sessions list. Top tabs Overview / Sessions / Usage / Settings;
  sub-tabs Dashboard / Team members. Renders clean. `qa/screens/department-v2.png`.
- Console: only benign CSP error.

## C3-1 realtime-leak check (business roles)
- **enterprise_admin**: network capture filtered for `guest_calls|escalation|realtime|
  supabase.co|wss` returned **ZERO** matches on `/enterprise/v2` (and tabs). No
  supervisor-table access, no realtime socket.
- **department_admin**: same filter on `/department/v2` returned **ZERO** matches.
- Verdict: neither business role issues any `guest_calls`/`session_escalations`
  traffic. (Realtime is polling-only in this environment — see staff.md transport note
  — so a hidden WS subscription is not observable, but there is no REST evidence of
  either role touching supervisor session tables.)

## Divergences & findings
1. `/enterprise/wallet` is a redirect alias to `?tab=billing` — not a standalone page.
   Matches enterprise-wallet.md if documented as such; flag if the route card expects a
   distinct page.
2. Both business roles render cleanly with correct nav filters; no DATA-400 seen here
   (those queries are room/dashboard-specific).
3. No crash / white screen / Prisma stub on any business page.

## Mutations performed
- enterprise_admin + department_admin logins (POST signin-password, 200 each) — session
  only. No minutes bought, no plan activated, no admin invited, no settings saved, no
  data exported, no member erased.
