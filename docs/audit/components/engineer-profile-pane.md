# Component map — `EngineerProfilePane.tsx`

**File:** `app/_components/EngineerProfilePane.tsx` (5,464 lines, `"use client"`)
**Purpose:** In-pane Profile / Payouts / Security / Notifications UI for engineers (mirrors customer-side `AccountPane`; building blocks intentionally duplicated, header comment 3–23). Also exports `CalendarTab`, mounted standalone on `/calendar`.

---

## 1. Exports & who imports/renders it

| Export | Line | Consumers |
| --- | --- | --- |
| `EngineerProfilePane` | 285 | `app/_components/StaffShell.tsx:51` (import), rendered at StaffShell.tsx:763–773 when `profilePaneOpen && engineer && guard.kind === "staff"`, with `userId={guard.userId}`, `email={meEmail}`; `onClose` also routes `/settings` → `/dashboard` |
| `CalendarTab` | 887 | `app/(staff)/calendar/CalendarPageClient.tsx:16` — standalone `/calendar` page (own banner state, own `auth.getUser()` → `userId`) |
| `EngineerTab` (type) | 68 | tab identity: `"profile" \| "payouts" \| "security" \| "notifications"` (Calendar moved out to `/calendar`, comment 66–67) |

`app/(staff)/settings/page.tsx` renders `null` — `/settings` is a thin shell; StaffShell watches `pathname === "/settings"` and opens the pane in place (settings/page.tsx:7–17).

---

## 2. Components defined

| Component | Lines | Role |
| --- | --- | --- |
| `EngineerProfilePane` | 285–552 | Header (Dashboard breadcrumb, close X), banner Toast, `SubNav` + active tab body |
| `SubNav` | 557–623 | Left 240px settings nav (Profile / Payouts / Security / Notifications) |
| `ProfileTab` | 628–799 | Read-only identity (alias, email) + expertise + customer-aligned axes chips |
| `ReadOnlyChips` | 801–830 | Label + chip list |
| `CalendarTab` (exported) | 887–1486 | Weekly recurring-availability editor + Monthly projection + timezone preview + `HolidaysSection` |
| `MonthView` | 1518–2281 | 12-month projection grid: holidays, bookings, per-date overrides, multi-select bulk bar, `DateSlotsPopup` |
| `DateSlotsPopup` | 2290–2734 | Per-date slot editor modal (save overrides / reset to pattern / block-unblock date) |
| `SlotEditorRow` | 2736–2820 | One time-range row inside the popup (two `<input type="time">` + remove) |
| `HolidaysSection` | 2860–3341 | Leave-request form + pending/rejected request list + blocked-dates list |
| `LeaveRequestRow` | 3343–3432 | One leave request (status pill, delete when not approved) |
| `HolidayRow` | 3434–3522 | One blocked date (pod holidays read-only "Set by admin") |
| `DayRow` | 3525–3840 | One weekday card: 24h band, window pills, copy-from menu, add-slot editor |
| `WindowPill` | 3843–3919 | Clickable time chip ↔ inline editor |
| `TzConversionLine` | 3926–3982 | Window rendered in each selected customer zone |
| `TimezonePicker` | 3985–4073 | Customer-zone toggle bar with live "now" clocks |
| `InlineEditor` | 4076–4169 | start/end time inputs + save/cancel/(remove); Enter/Escape keys |
| `PayoutsTab` | 4216–4538 | Date-range × contract-category earnings view + recent-session list |
| `DateRangePicker` | 4541–4645 | 7d/30d/90d/YTD/All/Custom preset pills + custom date inputs |
| `CategoryTabs` | 4648–4718 | All / Build / Go-live / Maintain tabs with rollup meta |
| `CategoryDetail` | 4721–4796 | Per-category stat cards |
| `SecurityTab` | 4809–4859 | Password-reset card + `ActiveSessionsCard` |
| `ActiveSessionsCard` | 4866–5033 | Device list (3-device cap), per-row + bulk sign-out |
| `DeviceRow` | 5035–5115 | One device row ("This device" badge; Sign out when not current) |
| `NotificationsTab` | 5120–5294 | Email-notifications toggle, desktop-app pitch, in-room toasts info |
| Building blocks: `SectionHead` 5299, `SectionCard` 5319, `StatCard` 5342, `Toggle` 5376, `StatusPill` 5410, `ComingSoonRow` 5427 | — | shared chrome |

Module-level helpers/constants: `TABS` 77, `rangeFromPreset` 179, `WEEKDAYS` 199, `TZ_OPTIONS` 208 / `TZ_DEFAULT_IDS` 221 / `TZ_STORAGE_KEY` 222, `getOffsetMinutes` 230, `convertMinutes` 247, `fmtConversion` 272, `PRESETS` 860, `isoDateInTz` 2823, `truncate` 2840, `fmt12h` 4171, `minutesToHHMM` 4181, `hhmmToMinutes` 4186, `fmtMinutes` 4798. Types: `EngineerProfile` 108, `AvailabilityWindow` 126, `EngineerHoliday` 133, `ContractType`/`ContractRollup` 143/150, `RecentSession` 159, `DateRange` 173, `MonthBooking`/`DateWindow` 1505/1512, `LeaveRequest` 2848.

---

## 3. State inventory (by component / concern)

### EngineerProfilePane (285)
- `tab` (299) — active `EngineerTab` from `initialTab`.
- `profile` (309), `loading` (310) — engineer profile row.
- `banner` (311) + `showBanner` (314, ok-tone auto-dismiss 4s).
- `resetting` (312) — password reset in flight.
- `emailSaving` (395) — email-notifications toggle in flight.

### CalendarTab (887)
- `windows` (895), `loading` (896), `busy` (897).
- `viewMode` (901) — `"weekly" | "monthly"`.
- `tz` (903) — `Intl` resolved local zone (memo).
- `selectedZoneIds` (913) — persisted in localStorage `relay-engineer-tz-prefs-v1` (914–945); `selectedZones` memo (946).

### MonthView (1518)
- `cursor` {year, month} (1530), `holidaysAll` (1534), `bookings` (1535), `dateWindows` (1536), `popupDate` (1537), `multiSelect` (1538), `selectedDates` Set (1539), `bulkBusy` (1540), `loading`/`busy` (1541–1542).
- Memos: `holidayByDate` 1696, `dateWindowsByDate` 1704, `bookingsByDate` 1714, `minutesPerWeekday` 1729, `gridStart`/`cells` 1745/1754, `today`/`maxCursor`/`canPrev`/`canNext` 1766–1781.

### DateSlotsPopup (2290)
- `slots` drafts (2327), `busy` (2328), `error` (2329); `sortedSlots` memo (2331).

### HolidaysSection (2860)
- `holidays` (2868), `requests` (2869), `loading`/`busy` (2870–2871).
- `viewerRole` engineer/supervisor → `approver` label (2875–2878).
- Form: `reqFrom`/`reqTo`/`reqReason`/`ack` (2881–2884); `totalDays` memo (2889); `visibleRequests` (pending+rejected only, 3104) and `groups` (month-bucketed non-pod holidays, 3113).

### DayRow (3525)
- `adding` (3554), `editingStart` (3555), `copyMenuOpen` (3556), `addDraft` (3574).

### SlotEditorRow / InlineEditor
- mirrored `startStr`/`endStr` strings (2751–2758 / 4091–4092).

### PayoutsTab (4216)
- `range` (4218, default 30d), `category` (4219), `contractRollups` (4220), `recent` (4221), `loading`/`error` (4222–4223); memos `totalSummary` 4330, `visibleRows` 4348 (≤50), `rollupByCategory` 4355.

### SecurityTab / ActiveSessionsCard (4866)
- `devices` (4867), `loading` (4868), `busyId` (4869, `"__bulk__"` sentinel), `myFingerprint` (4870); derived `isAtCap` = ≥3 (4940).

### NotificationsTab (5120)
- no state; `desktopInstalled` from `window.__RELAY_DESKTOP__` (5130–5131).

---

## 4. Data sources (tables, RPCs, other)

### Table reads
| Table | Line(s) | Used by |
| --- | --- | --- |
| `engineer_profiles` select (alias, expertise, presence, email prefs, 4 customer-aligned axes) | 325–331 | pane profile load |
| `engineer_availability_windows` select | 956–961 | CalendarTab weekly windows |
| `engineer_holidays` select | 1559–1564 (MonthView 12-mo), 1669–1674 (refresh), 2904–2909 (HolidaysSection) | holidays |
| `engineer_bookings` select (`status="booked"`) | 1565–1571 | MonthView booking dots |
| `engineer_date_windows` select (best-effort; 404-tolerant) | 1572–1577, 1641–1646 | per-date overrides |
| `leave_requests` select (own, by `requester_user_id`) | 2936–2943 | HolidaysSection requests |
| `user_role_names` select | 2980–2983 | approver label (engineer→Supervisor, supervisor→SuperAdmin) |
| `engineer_session_history` select (≤500, date-filtered) | 4237–4246 | PayoutsTab rows + client-side rollup (note: header comment 4212–4213 also names an `engineer_contract_summary` view, but the code queries only the history view) |

### Table writes
- `engineer_profiles` update `email_notifications_enabled` + `_updated_at` (404–410).

### RPCs
| RPC | Line(s) | Trigger |
| --- | --- | --- |
| `set_engineer_window` | 1043, 1166, 1223 | upsert window / apply preset / copy day |
| `remove_engineer_window` | 1038, 1090, 1125, 1158, 1215 | window edits, clear-all, preset/copy pre-clears (sequential loops) |
| `apply_date_template_bulk` | 1849 (multi-select), 2361 (popup save, single date) | per-date overrides |
| `add_engineer_holidays_bulk` | 1871 | multi-select "Block all" |
| `clear_date_overrides_bulk` / `clear_date_overrides` | 1894 / 2383 | reset to pattern (bulk / single) |
| `add_engineer_holiday` / `remove_engineer_holiday` | 2407 / 2402, 3006 | popup block-toggle; HolidaysSection remove |
| `submit_leave_request` | 3053 | leave form Apply (maps `DATE_IN_PAST` error to friendly text, 3074) |
| `delete_leave_request` | 3088 | delete pending/rejected request |

### Other
- `auth.resetPasswordForEmail(email, { redirectTo /set-password?mode=engineer })` — 438–442.
- `listMyDevices` / `revokeDevice` / `getOrCreateFingerprint` from `lib/relay/deviceTracking` (imports 58–63) — ActiveSessionsCard 4873–4938 (these wrap `list_my_devices` / `revoke_my_device` per comment 4862–4865).
- localStorage: `relay-engineer-tz-prefs-v1` (917, 939).
- No realtime channels, no edge-function invokes, no `fetch()` calls in this file.

---

## 5. Effects

| Lines | Component | Deps | Purpose |
| --- | --- | --- | --- |
| 320–392 | Pane | `userId` | Load `engineer_profiles`; default empty profile on error |
| 914–932 | CalendarTab | `[]` | Hydrate selected zones from localStorage, else `["PT","ET","GMT"]` |
| 951–988 | CalendarTab | `userId`, `showBanner` | Load weekly windows |
| 1545–1631 | MonthView | `userId` | Parallel 12-month load: holidays + booked bookings + date windows (date-windows errors degrade silently) |
| 2753–2758 | SlotEditorRow | `slot.start`/`slot.end` | Re-sync time strings on prop change |
| 2975–2998 | HolidaysSection | `userId`, `loadHolidays`, `loadRequests` | Role + holidays + own leave requests |
| 4227–4328 | PayoutsTab | `userId`, `range` | History query → recent rows + per-contract-type rollup (no-contract-type defaults to `build`, 4302) |
| 4872–4884 | ActiveSessionsCard | `[]` | Fingerprint + initial device list |

---

## 6. Handlers + enable/disable conditions

### Pane chrome
| Element | Handler | Condition | Lines |
| --- | --- | --- | --- |
| "Dashboard" home | `goHome` = `onClose()` + push `/dashboard` | always | 305–308, 480–490 |
| Close X | `onClose` | always | 506–515 |
| SubNav item | `onChange(tab)` | always | 581–616 |

### ProfileTab — read-only (presence picker moved to Dashboard, comment 693–695; edits require re-onboarding, 791–794).

### CalendarTab (weekly)
| Element | Handler | Condition | Lines |
| --- | --- | --- | --- |
| Weekly/Monthly toggle | `setViewMode` | always | 1313–1341 |
| Preset pill (`Weekdays 9–5` etc.) | `applyPreset` — confirm if windows exist, clear-all loop then insert loop | `disabled={busy}` | 1142–1196, 1410–1425 |
| Clear all | `clearAll` — `window.confirm`, sequential removes | shown when `windows.length > 0`; `disabled={busy}` | 1112–1140, 1426–1441 |
| TimezonePicker chip | `toggleZone` (persists localStorage) | always | 933–945, 4035–4061 |
| DayRow "+ Add slot/another" | `handleAddClick` → `findFreshSlot` → inline `InlineEditor` → `onAdd` → `upsertWindow(weekday, null, …)` | `disabled` = parent `busy` | 3567–3577, 3742–3753, 3793–3809, 1459–1461 |
| WindowPill click | toggle inline editor; commit → `upsertWindow(weekday, oldStart, …)` (delete-then-insert when start changed, 1037–1042); remove → `removeWindow` | `disabled` = busy; save no-ops if `start >= end` (4097) | 3764–3787, 1018–1110 |
| Copy-from menu | `onCopyFrom(sourceDay)` → `copyFromDay` (clears target then copies) | menu shown only when other days have windows (3682); `disabled={busy}` | 3681–3737, 1198–1256 |

### MonthView
| Element | Handler | Condition | Lines |
| --- | --- | --- | --- |
| Prev / Next month | `goPrev`/`goNext` | `disabled` outside current-month → +11-month horizon (`canPrev`/`canNext`) | 1776–1799, 1918–1948 |
| Today | `goToday` (also opens today's popup unless multi-select) | always | 1800–1807, 1976–1983 |
| Select multiple | toggle `multiSelect`, clears selection on exit | always | 1955–1975 |
| Day cell | `handleCellClick` — multi-select toggles set; else opens `DateSlotsPopup` | ignores out-of-month cells (1826) | 1825–1838, 2037–2134 |
| Bulk bar: 9am–5pm / Mornings / Evenings | `applyBulkTemplate(slots)` → `apply_date_template_bulk` | bar shown when `multiSelect && selectedDates.size > 0`; buttons `disabled={bulkBusy}` | 2179–2223, 1843–1864 |
| Bulk Block all / Reset to pattern / Cancel | `bulkBlockDates` / `bulkResetDates` / clear selection | `disabled={bulkBusy}` | 2224–2257, 1866–1906 |

### DateSlotsPopup
| Element | Handler | Condition | Lines |
| --- | --- | --- | --- |
| Add another slot | `addSlot` (next non-overlapping) | `disabled={busy}`; hidden while date blocked | 2336–2341, 2555–2568 |
| Slot time inputs / remove | `updateSlot` / `removeSlot` | `disabled={busy}` | 2342–2347, 2736–2820 |
| Save | `handleSave` — validates end>start, within day → `apply_date_template_bulk([date])` | `disabled={busy}`; hidden when blocked | 2349–2376, 2714–2729 |
| Reset to weekly pattern | `handleResetToPattern` → `clear_date_overrides` | not blocked; `disabled={busy}` | 2378–2394, 2664–2677 |
| Block / Unblock this date | `handleToggleHoliday` → `add_engineer_holiday` / `remove_engineer_holiday` | `disabled={busy}` | 2396–2421, 2678–2703 |
| Scrim / X / Cancel | `onClose` (also `useOverlayDismiss`, 2312) | — | 2423–2429, 2477–2485, 2705–2713 |

### HolidaysSection
| Element | Handler | Condition | Lines |
| --- | --- | --- | --- |
| From/To date inputs | `setReqFrom`/`setReqTo` (min = today / from) | — | 3159–3201 |
| Reason textarea, ack checkbox | local state | — | 3221–3253 |
| Apply | `submitRequest` → `submit_leave_request` (validates dates, reason, ack) | `disabled={!ack \|\| !reqReason.trim()}`, `loading={busy}` | 3023–3081, 3255–3266 |
| Delete request | `deleteRequest` → `delete_leave_request` | only pending/rejected rows render delete (`deletable = !approved`, 3356); `disabled={busy}` | 3083–3100, 3417–3429 |
| Remove blocked date | `removeOne` → `remove_engineer_holiday` | pod holidays show read-only "Set by admin" instead (3498–3506); `disabled={busy}` | 3000–3021, 3507–3519 |

### PayoutsTab
- Range preset pills + Custom + two date inputs → `setRange` (4571–4642).
- Category tabs → `setCategory` (4685–4715). All read-only otherwise.

### SecurityTab
| Element | Handler | Condition | Lines |
| --- | --- | --- | --- |
| Reset password | `onResetPassword` (pane-level, 433–452) | `loading={resetting}`; no-op without email | 4845–4852 |
| Device "Sign out" | `handleRevoke` — `window.confirm` → `revokeDevice` | hidden for current device (5095); `disabled` while busy; serialized by `busyId` | 4891–4915, 5095–5112 |
| "Sign out everywhere else" | `handleRevokeAllOthers` — confirm → parallel revokes | shown when other devices exist (5011); `disabled` while `busyId === "__bulk__"` | 4917–4938, 5013–5027 |

### NotificationsTab
| Element | Handler | Condition | Lines |
| --- | --- | --- | --- |
| Email toggle | `onToggleEmail` → pane `onToggleEmailNotif` (optimistic update + rollback, 396–430) | `disabled={emailSaving}` | 5196–5201 |
| Download Relay desktop | external link `/download-relay-desktop` | shown when `!desktopInstalled` | 5247–5261 |
