# Phase 2 Browser Walk — Staff surface (`/staff`)

> Target: `https://10.0.1.112:3000` (LAN dev, self-signed cert bypassed once, exception
> stored in profile). Date: 2026-06-06. Roles: `engineer` (gtlengineer), `supervisor`
> (gtlsupervisor), `super_admin` (ngemawat). OBSERVE-MOSTLY. Passwords never printed.

## Auth/session note (method)
While a customer session was active, a GET to `/staff/login` was bounced by the proxy
to `/login?wrong_surface=1` (surface guard working). Role switches were therefore done
by POSTing the staff creds to `/api/auth/signin-password` (`surface:"staff"`) — the
same call the form makes; the route signs the prior session out first (200, returns
`next`). All three staff logins returned 200 with the documented landing.

## Realtime transport — environment finding (applies to ALL staff pages)
- REST goes through the same-origin proxy `/api/supabase/rest/v1/...`. Per
  `lib/supabase/browser.ts`, **realtime WebSocket is NOT proxied** — it would dial
  `wss://<project>.supabase.co` directly.
- **No Supabase realtime WebSocket was observable for any role.** Evidence: (a) CDP
  network capture (`browser_network_requests`) shows zero `supabase.co`/`wss`/realtime
  entries on every page; (b) a `window.WebSocket` wrapper installed immediately after a
  fresh reload caught **nothing** — supabase-js captures the native `WebSocket` at
  client construction (module init), so a post-load hook can't see it, and no
  reconnect was forced by offline/online.
- Instead, every live surface **polls REST**: engineer dashboard polls
  `engineer_match_offers` every ~2 s and `engineer_heartbeat` ~6 s; customer room polls
  `guest_calls`; supervisor `/supervise` polls `guest_calls`. The match-ring / queue
  updates are poll-driven, not realtime, in this environment.
- **Consequence for C3-1**: the SupervisorAlerts realtime subscriptions cannot be
  observed as live sockets here. The leak question is answered instead by REST scoping
  (see partner.md / business.md): supervisor `guest_calls` polls are **scoped to the
  supervisor's own `supervisor_user_id`/`pod_id`**, not a blanket read.

---

## Engineer (gtlengineer@yopmail.com → `/dashboard`)

Sidebar nav (StaffShell): **Dashboard, Inbox, Quotation, Calendar** — exactly the
documented engineer filter (no Supervise/Users/Operations/Bids/Schedule). Presence
widget "Online · Matcher rings me", Account chip "Luca / Engineer".

- **`/dashboard`** — "Hi Gtlengineer". Renders: Scheduled·upcoming (4 bookings,
  grouped by day), Next-4-weeks availability grid (read-only; holidays/availability),
  MonthStats KPI strip (all 0), 5 stacked "New bid request" toasts each with a
  **Create bid** CTA (not exercised). Presence ball + ringtone control.
  - **BUG (data) — KPI stats 400**: `GET guest_calls?select=...projects(contract_type,
    completion_status)&claimed_by=eq.<me>` → **400 Bad Request** (request #79). Same
    `completion_status`/`contract_type` schema drift as the customer room. dashboard.md
    documents "stats query fails silent if projects.contract_type is pre-migration" —
    confirmed firing; KPIs render 0.
  - Screenshot `qa/screens/engineer-dashboard.png`.
- **`/inbox`** — Customer list (left, "Loading…"/empty), center "Welcome back · Pick a
  customer", right Call-log with Customer/Project toggle, search, date range, sort
  dropdown; "No calls yet · 0 of 0". Bid toasts persist. `qa/screens/engineer-inbox.png`.
- **`/quotations`** — "Quotation". Estimation requests **21**; tabs Needs bid 10 /
  Review 2 / Appointment 3 / Bid sent 0 / Accepted 6; quote-request list (Go-live /
  Maintain badges, customer + age, **Prepare bid** per row, not exercised); right "AI
  project assistant" panel (textbox disabled until a bid is opened).
  `qa/screens/engineer-quotations.png`.
- **`/calendar`** — "Your calendar". 4-week grid + weekly recurring availability
  ("49h / week", Quick set), blocked dates ("No blocked dates yet"), timezone
  Asia/Calcutta. Editing controls present, not exercised. `qa/screens/engineer-calendar.png`.
- Console across engineer pages: only the benign CSP `upgrade-insecure-requests`
  report-only error. No crash, no Prisma stub.

## Supervisor (gtlsupervisor@yopmail.com → `/supervise`)

Sidebar nav: **Inbox, Supervise, Operations, Bids, Schedule, Calendar** — matches the
documented supervisor filter (no Dashboard/Quotation/Users). Chip "gtlsupervisor /
Supervisor".

- **`/supervise`** — session monitor. Tabs **all 195 / waiting 0 / live 0 / past 195 /
  appointments / team / matching**; sentiment legend (Healthy / Shaky / At risk);
  search; pagination "Showing 1–20 of 195", 10/page selector. Polls `guest_calls`
  **scoped to own supervisor_user_id + pod_id** (and queued-unclaimed / reassign_needed
  — legitimate supervisor scope). `qa/screens/supervisor-supervise.png`.
- **`/operations`** — "Pod Gateway". Pod capacity **4/15** (1–10 = first supervisor,
  11–15 = second; preview note references `lib/allocation/podAllocation.ts`). Engineer
  roster table (gtlengineer Idle·Online; gtlengineer2/3/4 Idle·Offline) with
  Online/Offline presence toggles (mutating, not exercised).
  `qa/screens/supervisor-operations.png`.
- **`/bids`** — "Bids". Estimation requests **11**; tabs Appointment 3 / Review 2 /
  Bid sent 0 / Accepted 6 / Rejected 0; pod bid-review cards (Port management, still,
  test 3) with **Review bid** (not exercised) + AI review panel.
  `qa/screens/supervisor-bids.png`.
- **`/schedule`** — own appointments (none), **Team schedule** (gtlengineer +
  gtlengineer2 booked slots Mon Jun 8, clickable slots = drop, not exercised), **Team
  leave calendar** (gtlengineer4 leave · Accepted). `qa/screens/supervisor-schedule.png`.
- **`/inbox`** — same inbox component, loads for supervisor. `qa/screens/supervisor-inbox.png`.
- Console: only the benign CSP error.

## Super admin (super_admin QA account → `/admin/v2`)

Note the chip reads "Super Admin **+1**" — this account also holds another role
(Department/Supervise links appear on the StaffShell-wrapped admin pages).

- **`/admin/v2`** (bare mode — own banner, no StaffShell sidebar; matches
  dashboard.md "bare mode for /admin/v2 and /reseller/v2"). Tabs: **Channel Partners,
  Enterprise, Pods, Bench, Internal Users**. Default landed on `?tab=reseller`:
  channel-partner list **Arista** (2 ent · 10% comm · 0/200 min), **Oswal**
  (0 ent · 10% comm · 0/1.4k min), **Gateway** (10 ent · 0% comm · 1.35/800 min);
  "Add Channel Partner" (not exercised); Sign out. `qa/screens/superadmin-admin-v2.png`.
- **`/admin/users`** (legacy, StaffShell-wrapped; sidebar Supervise / Users / Department).
  Tabs: Internal staff / Users / Enterprise customers / Pods / Resellers; "Add user";
  role filter (All roles / Engineer / Supervisor / Enterprise Admin / Super Admin);
  user table (compiling/loading). `qa/screens/superadmin-admin-users.png`.
- **`/admin`** (legacy dashboard, StaffShell). **Activity** chart (daily sessions, last
  30 days — peaks 126 on 6/1, 80 on 6/5), **Users & roles** grant/revoke grid ("Click a
  role to grant. Click again to revoke (engineer only)" — MUTATING, not exercised),
  **Audit log** (latest 40 session events). `qa/screens/superadmin-admin.png`.
- Console: only the benign CSP error. No crash, no Prisma stub on any admin page.

## Divergences & findings
1. **DATA-400 (engineer KPI):** `guest_calls...projects(contract_type,completion_status)`
   → 400 on `/dashboard` (same `completion_status` schema drift seen in customer
   `/room`). Silent-fails to 0 KPIs. Same root cause as customer DATA-400.
2. **Realtime is polling-only** in this environment for staff too (see transport
   section). Not necessarily a bug (the browser client explicitly tolerates a blocked
   realtime path) but means SupervisorAlerts toasts would not fire here, and live
   queue/match updates rely on 2 s polling.
3. **StaffShell role filters all match** the documented dashboard.md NAV: engineer,
   supervisor, and super_admin each saw exactly their expected nav set; bare-mode for
   `/admin/v2` confirmed.
4. No white screens, no crashes, no "Prisma is no longer wired" anywhere on staff.

## Mutations performed
- engineer / supervisor / super_admin logins (POST `/api/auth/signin-password`, 200
  each) — session only. No bids created, no presence toggled, no roles granted/revoked,
  no slots dropped, no users added.
