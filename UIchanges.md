# Superadmin Panel — UI Redesign Spec

**Status:** Spec only. No code changes yet.
**Scope:** UI-only. No data-model, route-handler, RPC, or business-logic changes.
**Target file(s) to redesign later:**

- [app/(staff)/admin/users/UsersClient.tsx](app/(staff)/admin/users/UsersClient.tsx) — current 5-tab container; will be reshaped into the new 4-tab header.
- [app/(staff)/admin/users/EnterpriseTab.tsx](app/(staff)/admin/users/EnterpriseTab.tsx)
- [app/(staff)/admin/users/ResellersTab.tsx](app/(staff)/admin/users/ResellersTab.tsx)
- [app/(staff)/admin/users/PodsTab.tsx](app/(staff)/admin/users/PodsTab.tsx)
- (new "Internal Users" tab will subsume the existing `StaffTab` rendered inside `UsersClient.tsx`)

> Note: The Superadmin panel sits inside the existing [StaffShell](app/_components/StaffShell.tsx) left-nav chrome. The new page-level tabbed header described here lives **inside** the main content area of `StaffShell`, not in place of it.

---

## 1. Global page chrome (applies to all four tabs)

A page-level header sits at the top of the admin surface with four clickable tabs. Clicking a tab swaps the body below it; the StaffShell side nav and profile chip are unaffected.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Relay   │  Superadmin Panel                                            (profile)│  ← StaffShell top row
├─────────┼─────────────────────────────────────────────────────────────────────────┤
│         │ ┌──────────┬──────────┬──────────┬─────────────────┐                    │
│  Side   │ │Enterprise│ Reseller │   Pods   │ Internal Users  │  ← page header tabs│
│  nav    │ └──────────┴──────────┴──────────┴─────────────────┘                    │
│ (240px) │                                                                          │
│         │   ┌─────────────────── tab body ──────────────────────────────────┐    │
│         │   │                                                                │    │
│         │   │   (sidebar(s) + main details area — see per-tab sections)      │    │
│         │   │                                                                │    │
│         │   └────────────────────────────────────────────────────────────────┘    │
└─────────┴─────────────────────────────────────────────────────────────────────────┘
```

**Tab header behavior**

- Tabs are: **Enterprise** · **Reseller** · **Pods** · **Internal Users**
- Active tab gets an underline + coral accent (re-use `var(--accent)` from [app/globals.css](app/globals.css)).
- Inactive tabs are muted (`var(--muted)`); hover lifts to `var(--text)`.
- Tab selection is reflected in the URL (e.g. `?tab=enterprise`) so reloads / deep-links work — UI-only state, no new routes.

**Minutes usage display (shared — applies to every entity card and list row)**

Because this is the Superadmin panel, every level of the hierarchy must surface a **minutes_used / minutes_allocated** value, and the numbers must add up cleanly as you walk up the tree.

Display format (consistent everywhere): `used / allocated min` with a thin progress bar underneath.

```
 1,240 / 5,000 min   ┃ 25%
 [████░░░░░░░░░░░░░░]
```

- Below 70%: progress bar in neutral `var(--muted)`.
- 70–90%: amber `var(--warning)` (introduce token if missing).
- ≥90%: coral `var(--accent)`.
- ≥100% (overage): solid coral + a small `over` badge.

**Rollup math (UI must reconcile these — no level is allowed to show a contradictory total)**

```
Σ employee.used      ==  department.used
Σ employee.allocated ==  department.allocated

Σ department.used      ==  enterprise.used
Σ department.allocated ==  enterprise.allocated

Σ enterprise.used      ==  reseller.used         (Reseller tab only)
Σ enterprise.allocated ==  reseller.allocated    (Reseller tab only)

Σ engineer.used      ==  pod.used                (Pods tab only)
Σ engineer.allocated ==  pod.allocated           (Pods tab only)
```

> **Internal Users tab is excluded from minutes display.** Superadmins, supervisors, and engineers are staff, not minute-consuming customer accounts. That tab shows users only — no `used / allocated` anywhere.

- **Parent values are derived from children, not fetched independently.** The UI computes each parent's `used` and `allocated` as the sum of its visible children — so the math is consistent by construction. The enterprise card's `5,000 / 20,000 min` IS the sum of its 4 departments; the department's `1,240 / 5,000 min` IS the sum of its 8 employees; etc.
- Each detail card shows its own `used / allocated` AND, in muted text below, the implied formula:
  e.g. on an enterprise card: `5,000 / 20,000 min   (sum of 4 departments)`.
- Because parents are summed from children, **no "totals out of sync" warning is needed** — they cannot disagree.
- Where appears:
  - **Sidebar rows** — compact `used/allocated` value on the right side of every row (enterprise row, department row, reseller row, pod row, employee row, internal-user row).
  - **Detail cards** — large `used / allocated` block with the progress bar and the "(sum of N children)" caption.
  - **Tables** — a `Minutes (used / allocated)` column on the employees table and the internal-users table.

**"Add" form pattern (shared)**

Every primary sidebar has a fixed **Add &lt;entity&gt;** button at the bottom. Clicking it opens a **right-side slide-over drawer** (custom component, no shadcn) overlaying the main area. The drawer:

- Slides in from `right: 0`, width ~440px, full viewport height inside StaffShell.
- Has a backdrop scrim that dims the content behind it.
- Header: title (e.g. "Add Enterprise") + close (×) button.
- Body: stacked form fields (using existing input styles).
- Footer: **Cancel** (ghost) + **Save** (primary coral).
- Closes on ✕, Esc, scrim click, or successful save.

> Spec does **not** prescribe field-by-field form contents. Those map to whatever the current code paths already accept; this redesign is layout only.

---

## 2. Enterprise tab

**Flow:** Enterprise sidebar → Department sub-sidebar → details + employees.

```
┌─ Enterprise list (280px) ──────┬─ Departments (260px) ────────┬─ Details & Employees ──────────────┐
│ 🔍 Search enterprises…         │ 🔍 Search depts…             │  ┌────────────────────────────────┐│
│ ─────────────────────────────  │ ────────────────────────────│  │ Dept · code · status           ││
│ ▸ Acme Corp        [org]       │ • Engineering                │  │ 1,240 / 5,000 min  [████░░░]   ││
│   5,200 / 20,000 [██░░░]       │   1,240 / 5,000  [████░]     │  │ (sum of 8 employees)           ││
│ ▸ Globex            [org]      │ • Design                     │  │ [Edit] [Deactivate] [Delete]   ││
│   12,800 / 15,000 [██████░]    │   600 / 2,000   [██░░░]      │  └────────────────────────────────┘│
│ ▸ Initech           [org]      │ • Operations                 │                                    │
│   3,100 / 10,000  [███░░]      │   3,200 / 8,000 [████░]      │  Employees in this department      │
│ …                              │ …                            │  ┌────────────────────────────────┐│
│                                │                              │  │ name | email | role |          ││
│                                │                              │  │ minutes (used/alloc) | status  ││
│                                │                              │  │ ─── rows ───                   ││
│                                │                              │  └────────────────────────────────┘│
│ [+ Add Enterprise] ────────────│ [+ Add Department] ──────────│                                    │
└────────────────────────────────┴──────────────────────────────┴────────────────────────────────────┘
```

**Sidebar 1 — Enterprise list**

- Header: search box (filter by name).
- Each row: enterprise name, small "organic" badge if applicable (re-use the existing `organizationType` distinction from `EnterpriseTab.tsx`), active/inactive dot, **compact `used / allocated` line + mini progress bar**.
- Click selects → loads its departments into sidebar 2.
- Bottom-pinned: **+ Add Enterprise** button → opens right drawer.

**Sidebar 2 — Departments**

- Hidden until an enterprise is selected (empty state: "Select an enterprise to view its departments").
- Each row: department name, member count (small muted text), **compact `used / allocated` + mini progress bar**.
- Click selects → loads details + employees in the main area.
- Bottom-pinned: **+ Add Department** button → opens right drawer (drawer is scoped to the selected enterprise).

**Main area — Department details + employees**

- Empty state (no department selected): "Select a department to see details and employees."
- When a department is selected:
  - **Details card**: name (large), code (mono pill), status badge, description, **`used / allocated min` block with progress bar + `(sum of N employees)` caption**.
  - **Action row**: `Edit`, `Activate`/`Deactivate` (toggle text by status), `Delete` (danger).
  - **Employees table** (re-use [DataTable.tsx](app/_components/DataTable.tsx)): name, email, role, **minutes (used / allocated)**, status, last active, row actions. Table footer shows the column sum and must equal the department's `used / allocated`.

---

## 3. Reseller tab

**Flow:** Reseller sidebar → Enterprise sub-sidebar → Department sub-sub-sidebar → stacked details + employees.

```
┌─ Resellers (240px) ─────┬─ Enterprises (240px) ─┬─ Departments (220px) ──┬─ Stacked details ──────────┐
│ 🔍 Search               │ 🔍 Search             │ 🔍 Search              │                            │
│ ───────────────────────│ ────────────────────  │ ─────────────────────  │ ┌────────────────────────┐ │
│ • Reseller A           │ • Acme Corp           │ • Engineering          │ │ Reseller details       │ │
│   8,300 / 25,000 [██░] │   5,200 / 15,000 [██░]│   1,240/5,000  [████░] │ │ 8.3k / 25k min [██░░░] │ │
│ • Reseller B           │ • Globex              │ • Design               │ │ (Σ of 3 enterprises)   │ │
│   2,100 / 10,000 [██░] │   2,100 / 8,000  [██░]│   600 /2,000   [██░░]  │ │ [Edit][Deact][Delete]  │ │
│ • Reseller C           │ • Initech             │ • Ops                  │ └────────────────────────┘ │
│   400  /  5,000 [█░░░] │   1,000 / 2,000  [███░]│   3,200/8,000 [████░] │ ┌────────────────────────┐ │
│ …                      │ …                     │ …                      │ │ Enterprise details     │ │
│                        │                       │                        │ │ 5.2k / 15k min [██░░░] │ │
│                        │                       │                        │ │ (Σ of 4 departments)   │ │
│                        │                       │                        │ │ [Edit][Deact][Delete]  │ │
│                        │                       │                        │ └────────────────────────┘ │
│                        │                       │                        │ ┌────────────────────────┐ │
│                        │                       │                        │ │ Department details     │ │
│                        │                       │                        │ │ 1.2k / 5k min  [████░] │ │
│                        │                       │                        │ │ (Σ of 8 employees)     │ │
│                        │                       │                        │ │ [Edit][Deact][Delete]  │ │
│                        │                       │                        │ └────────────────────────┘ │
│                        │                       │                        │  Employees (table)         │
│                        │                       │                        │  ┌──────────────────────┐  │
│                        │                       │                        │  │ name|email|min u/a   │  │
│                        │                       │                        │  └──────────────────────┘  │
│ [+ Add Reseller] ──────│ [+ Add Enterprise] ───│ [+ Add Department] ────│                            │
└────────────────────────┴───────────────────────┴────────────────────────┴────────────────────────────┘
```

**Sidebar behavior**

- Sidebar 1: list of resellers (search + rows). Bottom: **+ Add Reseller**.
- Sidebar 2: appears after a reseller is selected. Lists enterprises belonging to that reseller. Bottom: **+ Add Enterprise** (scoped to the reseller).
- Sidebar 3: appears after an enterprise is selected. Lists that enterprise's departments. Bottom: **+ Add Department** (scoped to the enterprise).

**Main area — stacked details** (everything visible top-to-bottom, scrolls as one column)

1. **Reseller card** — visible as soon as a reseller is selected. Shows `used / allocated` with caption `(Σ of N enterprises)`.
2. **Enterprise card** — appears below the reseller card after an enterprise is selected. Shows `used / allocated` with caption `(Σ of N departments)`.
3. **Department card** — appears below the enterprise card after a department is selected. Shows `used / allocated` with caption `(Σ of N employees)`.
4. **Employees table** — appears below the department card with a `minutes (used / allocated)` column and a footer total that must equal the department card's `used / allocated`.

Each card has its own `Edit / Activate-Deactivate / Delete` actions. The stack effectively functions as a drill-down breadcrumb made of full cards.

**Rollup chain (Reseller tab specifically):** `employees → department → enterprise → reseller`. Each parent's `used / allocated` is computed as the sum of its children — values are always consistent.

**Empty states**

- No reseller selected → main area shows: "Select a reseller to begin."
- Reseller selected, no enterprise → reseller card visible + "Select an enterprise to continue."
- Enterprise selected, no department → reseller + enterprise cards visible + "Select a department to view employees."

---

## 4. Pods tab

**Flow:** Pods sidebar → pod details + supervisor + engineer list (no sub-sidebar).

```
┌─ Pods (280px) ───────────────┬─ Pod details (fills rest) ─────────────────────────┐
│ 🔍 Search pods…              │ ┌────────────────────────────────────────────────┐ │
│ ─────────────────────────    │ │ Pod name · slug · status                       │ │
│ • Pod Alpha   (12 eng)       │ │ 8,400 / 24,000 min  [████░░░░]                 │ │
│   8,400 / 24,000 [████░]     │ │ (Σ of 12 engineers)                            │ │
│ • Pod Beta    (8 eng)        │ │ description                                     │ │
│   2,100 / 16,000 [██░░░]     │ │ [Edit] [Deactivate] [Delete]                    │ │
│ • Pod Gamma   (10 eng)       │ └────────────────────────────────────────────────┘ │
│   18,200/20,000 [████████░]  │                                                    │
│ …                            │ Supervisor                                         │
│                              │ ┌────────────────────────────────────────────────┐ │
│                              │ │ avatar · name · email · status                  │ │
│                              │ │ [Change supervisor]                              │ │
│                              │ └────────────────────────────────────────────────┘ │
│                              │                                                    │
│                              │ Engineers in this pod                              │
│                              │ ┌────────────────────────────────────────────────┐ │
│                              │ │ name|alias|min u/a|status|last seen|actions     │ │
│                              │ │ rows… (footer total must equal pod's u/a)       │ │
│                              │ └────────────────────────────────────────────────┘ │
│ [+ Add Pod] ─────────────────│                                                    │
└──────────────────────────────┴────────────────────────────────────────────────────┘
```

**Pods sidebar**

- Search box.
- Each row: pod name, engineer-count badge, status dot, **compact `used / allocated` + mini progress bar** (pod's aggregate engineer minutes).
- Click selects → loads pod details on the right.
- Bottom: **+ Add Pod**.

**Main area**

- Empty state: "Select a pod to view details."
- When selected:
  1. **Pod details card**: name, slug, status, description, **`used / allocated min` block with progress bar + `(Σ of N engineers)` caption**, `Edit / Activate-Deactivate / Delete`.
  2. **Supervisor section**: single card with the assigned supervisor's avatar, name, email, status, and a `Change supervisor` action.
  3. **Engineers table**: list of engineers in the pod (re-use `DataTable`), with a `minutes (used / allocated)` column and a footer total that must equal the pod card's `used / allocated`.

**Rollup (Pods tab):** `engineers → pod`. Pod card's `used / allocated` is the sum of its engineers.

---

## 5. Internal Users tab

**Flow:** sidebar shows 4 tile-style filters; main area shows the matching user list with search + filter.

```
┌─ Filters (220px) ─────────┬─ Users list (fills rest) ────────────────────────────────┐
│                           │ 🔍 Search by name / email…   [Role ▾] [Status ▾]         │
│ ┌─────────────────────┐   │ ─────────────────────────────────────────────────────────│
│ │      All            │   │ ┌───────────────────────────────────────────────────────┐│
│ │  142 users          │   │ │ name | email | role | pod/org | status | last active  ││
│ └─────────────────────┘   │ │ ────────────────────────────────────────────────────  ││
│ ┌─────────────────────┐   │ │ rows…                                                  ││
│ │   Superadmin        │   │ │                                                        ││
│ │   4 users           │   │ │                                                        ││
│ └─────────────────────┘   │ │                                                        ││
│ ┌─────────────────────┐   │ │                                                        ││
│ │   Supervisor        │   │ │                                                        ││
│ │   18 users          │   │ │                                                        ││
│ └─────────────────────┘   │ │                                                        ││
│ ┌─────────────────────┐   │ │                                                        ││
│ │   Engineer          │   │ └───────────────────────────────────────────────────────┘│
│ │   120 users         │   │                                                           │
│ └─────────────────────┘   │                                                           │
│                           │                                                           │
│ [+ Add Internal User] ────│                                                           │
└───────────────────────────┴───────────────────────────────────────────────────────────┘
```

**Sidebar tiles**

- 4 tiles stacked vertically: **All**, **Superadmin**, **Supervisor**, **Engineer**.
- Each tile shows the role label and a live count only. **No minutes** — internal users are staff and do not consume customer minutes.
- The `All` tile's count MUST equal the sum of Superadmin + Supervisor + Engineer counts.
- Selected tile gets the coral accent border + filled background; others are outlined.
- Bottom-pinned: **+ Add Internal User** button → drawer with role selector (Superadmin / Supervisor / Engineer) + the standard fields.

**Main area**

- Top toolbar: search input + secondary `Role ▾` and `Status ▾` dropdowns (the `Role ▾` is redundant inside a per-role tile but stays useful in **All**).
- Table re-uses [DataTable.tsx](app/_components/DataTable.tsx) — sortable columns, pagination, row actions (Edit, Deactivate, Delete). Columns: name, email, role, pod/org, status, last active. **No minutes column.**
- Empty states per tile: "No superadmins yet" / "No supervisors yet" / etc.

---

## 6. Components to introduce (UI only)

These are new shared UI primitives. Implementation deferred — listed here so the next step is concrete:

| Component | Purpose | Likely path |
|---|---|---|
| `TabsHeader` | Page-level tab strip used by Superadmin panel. | `app/_components/TabsHeader.tsx` |
| `Sidebar` (master-list) | Column with search box on top, scrollable list in the middle, action button pinned to the bottom. Used 3× in Reseller tab, 2× in Enterprise tab, 1× in Pods. | `app/_components/Sidebar.tsx` |
| `Drawer` (right slide-over) | Right-anchored panel with scrim, header, body, footer. Used by every Add button. | `app/_components/Drawer.tsx` |
| `DetailCard` | Title + meta row + description block + action row used by reseller/enterprise/department/pod detail cards. | `app/_components/DetailCard.tsx` |
| `FilterTile` | Big clickable tile with label + count, used by Internal Users sidebar. | `app/_components/FilterTile.tsx` |

> All components will follow existing `var(--text) / var(--border) / var(--accent) / var(--muted)` tokens from [app/globals.css](app/globals.css). No new design tokens.

---

## 7. Out of scope for this redesign

- No changes to Supabase queries, Prisma schema, RPCs, or edge functions.
- No changes to authentication (`proxy.ts`, `useStaffGuard`).
- No changes to existing role-based access — the Superadmin panel remains visible only to `super_admin`.
- No new entities. Department and Reseller groupings render whatever the existing endpoints already return; if the current code doesn't yet expose a clean reseller→enterprise→department tree, that gap is a **follow-up data task**, not part of this UI redesign.
- No mobile-specific layout in this pass; assume ≥1280px viewport (admin-only surface).

---

## 8. Resolved design decisions

All open questions have been answered. Keeping the resolutions here so the next implementation step has the source of truth in one place.

1. **Department entity — resolved.** Lives in [supabase/migrations/20260521130000_enterprise_hierarchy.sql](supabase/migrations/20260521130000_enterprise_hierarchy.sql) as `public.departments`. Key columns: `id`, `enterprise_id` (FK → `public.organizations.id`), `name`, `department_code`, `admin_user_id`, `status` (`active` | `suspended`). Reseller-tab and Enterprise-tab sub-sidebars query this table filtered by `enterprise_id`.
2. **Reseller entity — resolved.** Same migration file, `public.resellers`. Key columns: `id`, `name`, `reseller_code`, `owner_user_id`, `status` (`active` | `suspended`). Enterprises link via `public.organizations.reseller_id`. Reseller-tab sidebar queries `public.resellers`; its sub-sidebar queries `public.organizations WHERE reseller_id = …`.
3. **Activate / Deactivate semantics — resolved.** Action only flips the `status` column between `active` and `suspended`. No session termination, no invite revocation, no cascading effects. Single-row UPDATE; no confirm dialog needed beyond a standard "Are you sure?".
4. **Drawer save behavior — resolved (Option A).** On Save: drawer closes → affected sidebar list refreshes → newly-created row is auto-selected → its sub-sidebar (if any) opens with empty state. Example: adding a new enterprise auto-selects it and opens the (empty) Departments sub-sidebar.
5. **Minutes rollup math — resolved.** Parent `used / allocated` is computed in the UI as the sum of its visible children. The backend's stored parent value (if any) is ignored in favor of the computed sum. Math is consistent by construction; no "out of sync" warning.

> **Status note:** The migration uses lowercase `'active'` / `'suspended'` for `status` (with a CHECK constraint), which differs from the uppercase `ACTIVE / SUSPENDED` used elsewhere in the Prisma schema. UI should render a normalized label ("Active" / "Suspended") regardless of source casing.
