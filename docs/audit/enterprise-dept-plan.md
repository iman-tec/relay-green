# Enterprise & Department command center — Phase 1 plan

> Plan only. Mocks (Phase 2) come after review. Grounded in
> [enterprise-dept-findings.md](enterprise-dept-findings.md) and the reviewer's locked calls.
> Reuse the shipped CP system; break nothing; flag-gated; login flows untouched.

## 0. Locked calls (from review)

- **G1** flag-branch the existing `PanelClient` (`if (flag) <CommandCenter/> else <LegacyPanel/>`); no new routes; flag-off = today's panel untouched.
- **G2** bare-mode + own rail **for the flag-on console only**; flag-off stays embedded in StaffShell. *Guardrail: the rail must preserve every nav StaffShell gives these admins (§2).*
- **G3** ledger: compose a unified display-only view now (Stripe recharges + session debits); propose an append-only `wallet_transactions` table as the durable follow-up (parallel write, never replace counters, never touch the money path).
- **G4** live spend: **poll** (interval + tab-focus + after session-end); don't touch realtime.
- **G5** terms: additive `terms_type` scope; new blocking **org-MSA gate** at enterprise entry; downstream notice; distinct from the partner clickwrap.
- **CP discount**: surface in the recharge view ("rate includes X% via [Partner]"), display-only.
- **Primitives**: promote `KpiRibbon`/`StatusDot`/`DrillPanel` to a shared dir, fix reseller imports in the same commit, confirm reseller still renders — *before* enterprise/dept consume them.
- Login flows untouched. Console-only.

**Proposed flag:** `NEXT_PUBLIC_ENTERPRISE_V2` (covers both enterprise + department command centers). Off by default. (Name negotiable.)

---

## 1. The three pinned items

### 1a. Exact StaffShell nav the bare rail MUST preserve (the G2 guardrail)

From `StaffShell.tsx` NAV (lines 98–187) + chrome (top 604–640, bottom profile chip 14–15, 760–810):

**Enterprise admin** sees today:
| Item | Route | In-console or external? |
|---|---|---|
| Supervise | `/supervise` | **external** (org-scoped grid) |
| Overview | `/enterprise/v2?tab=overview` | console |
| Usage | `/enterprise/v2?tab=usage` | console |
| Billing | `/enterprise/v2?tab=billing` | console |
| Settings | `/enterprise/v2?tab=settings` | console |
| Finance | `/finance` | **external** (org money + feedback) |
| _chrome_ | Home (`homeHref=/enterprise/v2`), Wordmark→home, **ThemeTriplet**, collapse, profile chip (email · role · **logout**) | shell |
| _panel_ | **NotificationBell** (`/api/enterprise/notifications`) | panel top bar |

**Department admin** sees today:
| Item | Route | In/ext |
|---|---|---|
| Supervise | `/supervise` | **external** |
| Overview | `/department/v2?tab=overview` | console |
| Sessions | `/department/v2?tab=sessions` | console |
| Usage | `/department/v2?tab=usage` | console |
| Settings | `/department/v2?tab=settings` | console |
| _chrome_ | Home (`homeHref=/supervise`), Wordmark, **ThemeTriplet**, collapse, profile chip (logout) | shell |
| _panel_ | **NotificationBell** (`/api/department/notifications`) | panel |

**⚑ Consequence:** the bare rail must include **outbound links to `/supervise` (both) and `/finance` (enterprise)** — those render in StaffShell (not bare), so clicking them leaves the command center into shell chrome. Acceptable for break-nothing; folding Finance into a console view is a later option, not now. The rail must also carry: **NotificationBell, ThemeTriplet, Home, profile/logout** — i.e. everything the shell chrome provides. (Note: the reseller `PortalClient` currently *omits* the bell — backfill it when we build the shared rail.)

### 1b. Primary object per console
- **Enterprise = Departments** (employees + usage + minutes roll up into each department row). Members (staff admins) and the wallet are ribbon/secondary. Empty-state covers orgs with no departments yet.
- **Department = Employees** (the dept admin's one object: who's on the team, their minutes, their usage).

### 1c. Department admins on spend: **read-only** (pinned)
Dept admins see their department's minutes/spend **read-only**; recharge stays enterprise-level. "Department budgets" (dept self-recharge) is explicitly **deferred behind a separate future flag** — not in this revamp.

---

## 2. Architecture

- **Flag branch** in `enterprise/v2/PanelClient.tsx` and `department/v2/PanelClient.tsx`: `if (enterpriseV2Enabled()) return <EnterpriseCommandCenter/> ; return <LegacyPanel/>` (wrapper precedes hooks, as CP did).
- **Bare-mode gating:** extend `StaffShell.isBare` to `reseller/v2 OR (enterpriseV2Enabled() && (pathname startsWith /enterprise/v2 || /department/v2))`. StaffShell is a client component, so it can read the `NEXT_PUBLIC_` flag. Flag-off → `isBare` false → existing sidebar + LegacyPanel, **identical to today**.
- **Shared rail:** a `CommandRail` primitive (the reseller `PortalSidebar` generalized) — props: nav items, external links, identity foot, bell endpoint. Reused by reseller (backfill), enterprise, department.
- **Primitives promotion (first commit):** `KpiRibbon`, `StatusDot`, `DrillPanel`, `format`, `types` → `app/_components/portal/`; update reseller `_portal` imports; verify `/reseller/v2` renders unchanged.

---

## 3. Enterprise command center — views

Rail: **Overview · Recharge · Usage · Members · Settings · Resources** + external **Supervise · Finance** + chrome.

- **Overview** (primary): KpiRibbon (Balance · Spend this month · Active departments · Members) over the **Departments table** (name · admins · employees · allocated/used minutes · spend · status) → **DrillPanel** (dept detail: employees, usage, refill action). Empty-state = "create your first department."
- **Recharge** (merges today's Wallet+Billing): one balance/minutes number, one buy action (existing Stripe bundle flow, discount auto-applied), the **CP discount callout** ("Your rate includes X% via [Partner]" from `/api/enterprise/me.channelPartner`), and the **unified ledger** (recharges + session debits, date · type · amount · balance-after, read-only). Live via **poll**.
- **Usage**: the existing k-anon `byDepartment`/`byPeriod` reports, in the new shell (reuse endpoint).
- **Members**: staff admins (invite/resend/erase) — existing endpoints.
- **Settings**: org identity (name/domain/retention), enterprise code, **terms record** (accepted version/date/signer + download), **ThemeTriplet**, notification prefs, export.
- **Resources**: how-to, employee onboarding, deck, videos (CP Resources pattern).

## 4. Department command center — views

Rail: **Overview · Sessions · Usage · Settings · Resources** + external **Supervise** + chrome.

- **Overview** (primary): KpiRibbon (Dept minutes remaining · Spend this month · Employees · Active) over the **Employees table** (name · status · minutes · spend · last activity) → DrillPanel (employee usage; refill only if dept-budgets flag — off now). Read-only spend.
- **Sessions / Usage**: existing dept endpoints in the new shell.
- **Settings**: dept name, notification prefs, ThemeTriplet, the **downstream terms notice** ("Your organization accepted Relay's terms on [date]").
- **Resources**: same pattern.

## 5. Terms model (org-MSA)

- **Additive migration:** `terms_acceptances.terms_type text` (`'partner_commercial' | 'enterprise_msa'`, default `'partner_commercial'` to preserve existing rows) + index on `(enterprise_id, terms_type)`. Nothing else touched.
- **New gate:** `EnterpriseMsaGate` at enterprise-admin entry (in the command center shell) — **blocking, affirmative, never pre-checked, terms viewable first**; the admin attests authority to bind the org. Writes an `enterprise_msa` row (org id, signer, version, sha256, IP, time). Endpoint: extend `/api/enterprise/accept-terms` with a `type` param, or a sibling `/api/enterprise/accept-msa`. **Distinct from `PartnerTermsGate`** (different version lineage in `lib/...`; the partner gate stays partner-only on `partner_status='invited'`).
- **Version tracking:** current-accepted vs latest `ENTERPRISE_MSA_VERSION`; a material bump forces re-accept on next entry (new row).
- **Downstream notice:** dept admins/employees see a lightweight "org accepted on [date]" line (Settings/notice) — never a second contract.

## 6. Recharge: ledger + live spend + discount (G3/G4/CP)

- **Display-only unified ledger now:** compose from (a) **credits** = Stripe recharges (read PaymentIntents tagged `relay_kind=enterprise_minutes`, or the simplest source we can read without new writes) and (b) **debits** = ended `guest_calls` (duration × rate). Render date · type · amount · running balance. Clearly labelled as derived.
- **Durable follow-up (proposed, not this step):** append-only `wallet_transactions` (org_id, kind, minutes_delta, cents, balance_after, source_ref, created_at), **written in parallel** at recharge (topup) and session-end — never replacing the denormalized counters, never gating the money path. Lets the ledger become authoritative later without a UI change.
- **Live spend:** a `usePolledApiData` (wrap the existing `useApiData`) — refetch on interval (e.g. 20s), on tab `focus`, and on a session-end signal. No realtime channel.
- **Discount callout:** display-only from `/me.channelPartner`; the discount is *already applied* at `wallet/checkout` (verified) — do not re-implement.

## 7. Schema (additive only)
1. `terms_acceptances.terms_type` (+ index). _This step._
2. `wallet_transactions` append-only table. _Follow-up, parallel-write._

No change to `organizations.status`, the `*_minutes` counters, the transfer RPCs, or the recharge/crediting path.

## 8. Build order (Phase 2 sub-steps — each flag-gated, break-nothing, verified)
1. **Promote primitives** → shared dir; fix reseller imports; **verify `/reseller/v2` renders** (own commit). Backfill the reseller bell into the shared `CommandRail`.
2. **Flag + bare-mode gating + empty flag-branch** in both PanelClients (renders a stub command center); verify flag-off = identical live.
3. **Enterprise** command center views (Overview→Departments, Members, Usage).
4. **Department** command center views (Overview→Employees, Sessions, Usage).
5. **Terms**: migration + `EnterpriseMsaGate` + downstream notice.
6. **Recharge**: merged view + discount callout + poll + composed ledger.
7. **Settings + Resources** for both.
8. **Verify**: flag-off no-op (curl) + flag-on walk with QA enterprise (`tgcenterprise@yopmail.com`) and department (`depadmin3@yopmail.com`) accounts; read-only (no writes to shared prod).

## 9. Break-nothing checklist
- Flag off → `/enterprise/v2` + `/department/v2` byte-identical (StaffShell sidebar, legacy tabs); any new endpoint 404s. Verify live.
- Bare rail preserves **all** of §1a (Supervise, Finance, bell, theme, home, logout) — no lost navigation.
- Money path untouched (recharge/crediting/RPCs); discount surfaced, not rebuilt; ledger display-only.
- Schema additive (`terms_type`, later `wallet_transactions`); existing columns untouched.
- No downstream MSA re-signing — org acceptance binds the org.
- Promote primitives without breaking reseller (verify in the same commit).
- dev ≡ prod: no write-flow e2e against shared data without throwaway + cleanup.

---
_Phase 1 deliverable. Stop for review before Phase 2 (mocks)._
