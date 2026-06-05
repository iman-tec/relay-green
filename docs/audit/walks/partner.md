# Phase 2 Browser Walk — Partner surface (`/partner`)

> Target: `https://10.0.1.112:3000` (LAN dev, self-signed cert bypassed; exception in
> profile). Date: 2026-06-06. Role: `reseller` (gtlchannel@yopmail.com). OBSERVE-MOSTLY.
> Passwords never printed. Login via POST `/api/auth/signin-password`
> (`surface:"partner"`) → 200, next `/reseller/v2`.

## `/reseller/v2` (Channel Partner Panel — bare mode)

Renders in **bare mode** with its OWN sidebar (not StaffShell chrome): **Dashboard,
Enterprises, Settings**. Banner "Channel Partner Panel". Account chip "gtlchannel /
Channel Partner". 7 unread notifications.

- **Dashboard (`?tab=dashboard`)** — Portfolio "Gateway", code **RLC-FA17IT**. KPIs:
  **10 Companies (9 active)**, Portfolio spend **€4.06**, Commission rate 0%, Commission
  est. €0.00. "Companies by spend" list (TGC Capital IT €4.06 active; Autofacet, Test
  gateway, testq, Gateway Adap/Digital, GTL GD, GTL AF **suspended**, GatewayTechnolabs,
  Gateway Group all €0.00). Tabs Portfolio / Sales. `qa/screens/reseller-v2-dashboard.png`.
- **Enterprises (`?tab=clients`)** — downstream-org list with spend + active/suspended
  status; search; All/Active/Suspended filter; **Onboard an enterprise** (not
  exercised); Invitations sub-tab; "Select an enterprise" detail pane. TGC Capital IT
  shows €5.05 spent here. `qa/screens/reseller-v2-enterprises.png`.
- **Settings (`?tab=settings`)** — Channel Partner profile (Gateway, code RLC-FA17IT,
  0% commission); Internal team (gtlchannel **Owner**, gtlemployee2 **Admin·pending**,
  Add member / Remove); White-label branding (enabled, accent **#1632a2**, display
  name/support email, Save branding); Payout details (payout email); Notifications (3
  toggles ON, Save preferences). All Edit/Save/Add/Remove **not exercised**.
  `qa/screens/reseller-v2-settings.png`.
- Console across reseller pages: only the benign CSP `upgrade-insecure-requests`
  report-only error + CSS-preload warnings. No crash, no Prisma stub.

## PRIORITY C3-1 — reseller realtime leak (the headline check)

**Verdict: over-broad subscription EXISTS in code and is mounted for the reseller, but
actual data exposure is BLOCKED by RLS. Live WS not observable (realtime is
non-functional in this env).**

### What the reseller's browser actually fetched (network capture, non-static)
Only these endpoints — **no `guest_calls`, no `session_escalations`, no realtime, no
`supabase.co`/`wss`:**
- `GET /api/supabase/auth/v1/user`
- `GET /api/supabase/rest/v1/user_role_names?...` (own role)
- `GET /api/reseller/notifications`, `GET /api/reseller/dashboard` (server-side,
  reseller-scoped API routes)
- `POST rpc/register_my_device`, `POST rpc/revoke_my_device`
All portfolio data comes from the reseller-scoped `/api/reseller/*` server endpoints,
not direct Supabase table reads.

### Code-level finding (why this is still a real C3-1)
StaffShell DOES wrap `/reseller/v2` (`isBare` list, StaffShell.tsx:485-487) and, even in
bare mode, mounts **`{!engineer && <SupervisorAlerts roles={roles} />}`**
(StaffShell.tsx:500). Inside `SupervisorAlerts` (StaffShell.tsx:1240-1346):
```
const isSupervisor = !isEngineer(roles);   // line 1241 — DENY-LIST, not allow-list
useEffect(() => { if (!isSupervisor) return;
  sb.channel(`supervisor-alerts-shell-${uuid}`)
    .on("postgres_changes", { event:"*", schema:"public", table:"guest_calls" }, …)
    .subscribe();                            // line 1291-1342
}, [isSupervisor]);
// + a second effect subscribing to `session_escalations` INSERT (line 1353+)
```
A reseller is not an engineer → `isSupervisor === true` → the reseller's browser
**does call `.subscribe()` on the global `guest_calls` and `session_escalations`
realtime channels.** The gate is a deny-list (only engineers excluded) rather than an
allow-list (supervisor / super_admin / department_admin only), so EVERY non-engineer
that lands in StaffShell (reseller, enterprise_admin, department_admin) opens these
subscriptions. This is the C3-1 least-privilege violation, confirmed in source.

### Why it does NOT currently leak data (RLS backstop)
Read-only probe executed from the reseller's own session (a SELECT, no mutation):
- `GET /api/supabase/rest/v1/guest_calls?select=id,guest_name,status,customer_user_id&limit=3`
  → **HTTP 200, `[]` (0 rows)**
- `GET /api/supabase/rest/v1/session_escalations?select=id,session_id&limit=3`
  → **HTTP 200, `[]` (0 rows)**
Realtime `postgres_changes` enforces the same RLS, so even if the WebSocket connected
the reseller would receive zero rows. Net exposure today: **none** — RLS holds.

### Why no live socket was captured
Per `lib/supabase/browser.ts`, realtime is the only non-proxied path (would dial
`wss://<project>.supabase.co`). In this environment **no Supabase realtime WebSocket is
observable for any role** (engineer/supervisor/customer all run on REST polling instead;
a `window.WebSocket` hook catches nothing because supabase-js binds the native
constructor at client construction). So the `.subscribe()` call is made but the
transport never establishes here, and MCP/CDP shows no wss entry.

**Same check for `enterprise_admin` and `department_admin`** (see business.md): network
capture showed **zero** guest_calls/escalation/realtime requests on `/enterprise/v2` and
`/department/v2`. (Code path: these also reach `SupervisorAlerts` if routed through
StaffShell and would subscribe under the same deny-list — RLS is again the backstop.)

## Divergences & findings
1. **C3-1 (confirmed, code-level; data exposure RLS-blocked):** `SupervisorAlerts`
   subscribes non-engineers — incl. the reseller — to `guest_calls` + `session_escalations`
   realtime via the deny-list `isSupervisor = !isEngineer(roles)`. Fragile least-privilege
   posture: a single RLS regression on `guest_calls` would turn this into a live
   cross-tenant session-data leak to a channel partner. Recommend an allow-list gate
   (supervisor/super_admin/department_admin only) AND not mounting SupervisorAlerts in
   the `/reseller/v2` bare branch.
2. **Realtime is non-functional / polling-only** in this environment (see staff.md).
   Means the leak is dormant here, not that the code is safe.
3. Reseller surface renders clean (bare shell), correct partner-scoped data via
   `/api/reseller/*`; no crash / white screen / Prisma stub.

## Mutations performed
- reseller login (POST signin-password, 200) — session only.
- Two read-only REST SELECT probes (guest_calls, session_escalations — both returned 0
  rows; no writes). No enterprise onboarded, no member added/removed, no branding/payout
  saved, no notification prefs changed.
