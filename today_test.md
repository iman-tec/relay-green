# Test Plan — 2026-06-04

Covers everything changed in the 2026-06-03 / 06-04 working sessions: the
`sup_sentiment` live-sentiment pipeline (OpenAI, cumulative chat+voice,
activeness), pre-session chat paste/drag-drop + flush-as-bubbles, global
file caps (3 files / 10 MB), inbox customer names, consolidated customer
summary, and assorted fixes.

## Setup (do this first)

- **Three separate browser contexts** — never share a browser between roles:
  - Customer → `gtlcustomer@yopmail.com` (normal window)
  - Engineer → `gtlengineer@yopmail.com` (incognito)
  - Supervisor → supervisor account (third profile)
- App: `https://10.0.1.112:3000` (local dev) — today's sentiment + file-visibility
  work is **not pushed to main yet**, so test locally until it's pushed.
- Deployed already: `sup_sentiment` migration ✅, `score-session-health` ✅,
  `summarize-guest-call` ✅ (hosted Supabase).
- ⚠️ Pending: the retention-fix migration
  (`20260603120000_project_completion_retention_fix.sql`) is NOT applied yet —
  E3 stays red until it is.

---

## 🟢 A. Live sentiment (`sup_sentiment`)

| #   | Scenario                    | Steps                                                                                              | Expected                                                                                                                                              |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Chat-only session scores    | Engineer accepts; both sides type ≥2 messages; do NOT join Zoom; wait 2–3 min                      | Supervisor tile shows AI line + color; `sup_sentiment` rows tick every minute even in `assigned`/`joining` status (the 06-03 failure mode, now fixed) |
| A2  | Mood arc → dynamic state    | Act frustrated for ~2 min ("still broken, waste of time") then resolve ("perfect, that fixed it!") | Score drops red (< −0.3) then recovers toward green — recency-weighted, not stuck on history. State column: red → orange → green                      |
| A3  | Pre-call drafts count       | Type frustrated thoughts in the right sidebar BEFORE the call, then start it                       | First scoring tick already reflects those lines (drafts flush as guest messages)                                                                      |
| A4  | Voice + chat collectively   | Join Zoom; speak angrily but type politely                                                         | Score follows the voice, not the polite chat                                                                                                          |
| A5  | Activeness chip             | Chat actively → go silent 2+ min mid-session                                                       | Chip moves `active` → `idle` while sentiment stays unchanged                                                                                          |
| A6  | Quiet session costs nothing | Engineer accepts; nobody says anything                                                             | No AI line on tile (deterministic color only); no OpenAI tokens spent                                                                                 |
| A7  | Post-end final score        | End the session; wait ~1 min                                                                       | Past-session tile shows cumulative final sentiment; `sup_sentiment` gets one `phase='final'` row                                                      |
| A8  | Realtime updates            | Keep `/supervise` open during A2                                                                   | Tile color/summary updates without manual refresh                                                                                                     |

> After A1–A7: ask Claude to query `sup_sentiment` and verify minute-ticks,
> generated `state` values, activeness, and the `phase='final'` row.

---

## 📎 B. Pre-session chat (right sidebar "Engineer chat")

| #   | Scenario                  | Steps                                            | Expected                                                                                                                     |
| --- | ------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| B1  | Paste screenshot          | Ctrl+V a screenshot into the textarea            | Lands in the "will be delivered" tray                                                                                        |
| B2  | Paste file                | Copy a PDF/DOCX in Explorer, paste into textarea | Same — staged in tray                                                                                                        |
| B3  | Drag & drop               | Drag a file anywhere onto the panel              | Green dashed "Drop files" overlay appears → file staged                                                                      |
| B4  | Persistence               | Refresh the tab with staged files + typed drafts | Both survive (IndexedDB + sessionStorage)                                                                                    |
| B5  | Photo-only send           | Stage a photo, no text, hit Send                 | Button enabled; toast: "Files queued — delivered when your engineer joins"                                                   |
| B6  | Flush as customer bubbles | Stage files + drafts, then start a call          | Files appear as REGULAR customer bubbles under "Rohan Mehta" (not a system pill) on BOTH sides; drafts arrive in typed order |
| B7  | Flush chunking            | Stage 5 files, then connect                      | Delivered as 2 bubbles (3 + 2) — per-message cap respected                                                                   |

---

## 📏 C. File caps (global — live composer, sidebar, session-review)

| #   | Scenario                             | Steps                                                                                                  | Expected                                                                           |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| C1  | Max 3 files per message              | Attach a 4th file to one message                                                                       | Blocked: "Up to 3 files per message."                                              |
| C2  | Max 10 MB per file                   | Attach a file > 10 MB                                                                                  | Blocked: "<name> is over 10 MB." Hint reads "Up to 10.0 MB per file · 3 files max" |
| C3  | Attachment-only send                 | Send image/document with NO text in live chat and session-review follow-up                             | Sends fine as attachment-only bubble                                               |
| C4  | Center composer files survive intake | On "Describe what you're working on…" attach files BEFORE a session exists, complete the intake wizard | Files are NOT lost — they arrive in the session as customer bubbles after connect  |

---

## 👤 D. Inbox & customer names (already live on main/Vercel)

| #   | Scenario                  | Steps                          | Expected                                                                                                      |
| --- | ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| D1  | Profile names in inbox    | Engineer opens `/inbox`        | gtlcustomer shows as **Rohan Mehta** in the left rail, "Viewing sessions for" header, and right-rail call log |
| D2  | Connect-request card name | Customer pings a busy engineer | Request card shows the real customer name (the broken `customer_profiles.email` query is fixed)               |

---

## 📋 E. Summary + misc fixes

| #   | Scenario                       | Steps                                                                   | Expected                                                                                                                  |
| --- | ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| E1  | Consolidated customer summary  | End a session that had a Zoom call; view summary as customer in `/room` | ONE "Summary" section — no separate "Call summary" capsules (engineer side keeps both)                                    |
| E2  | No heartbeat spam after logout | Engineer logs out, leave tab open 1 min                                 | No `engineer_heartbeat 400` repeating in the dev-server log                                                               |
| E3  | ⚠️ BLOCKED — retention 400s    | Customer loads `/room`; watch the dev-server log                        | No `completion_status does not exist` 400 — requires applying `20260603120000_project_completion_retention_fix.sql` first |

---

## Suggested order

1. **B** (pre-session staging) → **C** (caps) — quick, no call needed for most
2. **A** — one good call session covers A1–A8 plus B6/B7 simultaneously
3. **D / E** spot-checks
4. Report results; Claude verifies `sup_sentiment` rows directly in the DB

## Housekeeping before/after testing

- [ ] Commit + push today's work to main (sentiment pipeline, file visibility, this file)
- [ ] Apply the retention-fix migration (unblocks E3)
- [ ] Revoke the Supabase access token shared in chat (supabase.com/dashboard/account/tokens)
- [ ] Rotate the API keys pasted in chat earlier (OpenAI, Supabase service role, Qdrant) when convenient
