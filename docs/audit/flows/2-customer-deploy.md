# Flow 2 — Customer chat-first → call → PostCall (LIVE on PRODUCTION DEPLOY)

> Target: **`https://relay-green-471i.vercel.app`** (Vercel production build, same
> Supabase backend as dev). Driven by the main thread via Playwright MCP, single
> browser context. Date 2026-06-06. OBSERVE-MOSTLY; mutations logged below.
> Customer = `gtlcustomer@yopmail.com` (QA).

## Steps observed (PASS unless noted)

| # | Step | Observed | Verdict |
|---|---|---|---|
| 1 | `/login` (deploy) | Password-first form, **pre-filled**. Copy still reads "we'll send you an 8-digit code" on a password form. | ✅ + `AUDIT-LOGIN-COPY-1` reproduces on PROD |
| 2 | Click Sign in | → `/room` (200), title "Session — Relay.green". Server gate honored. | ✅ |
| 3 | `/room` initial state | **Stale LIVE session present** (same backend): "00:24 **paid** · On call · 👤 Luca joined as engineer · Zoom call · ongoing · 📞 Call started". Header **"Join the call" button ENABLED**; inline "Join call" present; "Add participant" disabled; "Send" disabled (empty composer). | ✅ confirms R2 call-button enable-on-session-row on PROD; E2E-CLEANUP-1 reproduces |
| 4 | Session auto-ends | Between snapshots the "00:24 paid" clock exhausted → **client-side lifecycle (R3) fired `end_session` live**. UI transitioned to **PostCallView**. | ✅ end→PostCall transition observed live; R3 client-billing confirmed |
| 5 | PostCallView | "Session ended · 1 min", "Summary", "Waiting for Zoom summary…", right rail "You chatted with Luca · Session ended", **"This session has ended — the conversation is read-only."** + "Session ended — read-only" lock. | ✅ PostCall + summary-pending + read-only lock (CHAT-LOCK-1 is UI-only — server enforcement not retested here) |
| 6 | "Back to room" | → idle/home room: dashboard chrome (Scheduled 6 / Contracts 7 / Notifications 20+), RELAY hero, chat-first composer "Message your engineer…", "Start a call" button, draft hint "your engineer sees them as soon as the call connects." | ✅ chat-first idle state |
| 7 | Type a draft message + Send enables | Typed "Audit probe…"; **Send button enabled** on non-empty (was disabled). | ✅ |
| 8 | Click "Start a call" (draft unsent) | Button went `[active]` but **NO connecting/ring/matching overlay appeared**; idle hero remained; post-check `guest_calls` active-status query → **`[]`** (no session created, no ring). | ⚠ `AUDIT-STARTCALL-NOOP-1` (low): start-a-call with an unsent draft is a silent no-op — no session, no ring, no feedback. May require sending the message first; no UI tells the user. |

## Production-confirmed findings (cross-ref, not re-filed)

- **`AUDIT-DATA-400-1` → confirmed on PROD.** Console + network: repeated 400 on
  `GET /api/supabase/rest/v1/projects?select=id,name,…,completion_status,completed_at&customer_id=eq.<uuid>&order=created_at.desc`
  (4× per poll cycle). The `completion_status`/`completed_at` columns 400 the
  whole select → project sidebar/summary silently empty. **Escalates from dev to
  production** — every customer `/room` makes this failing query on repeat.
- **REST-polling, NOT realtime, on PROD.** All session/chat/queue updates arrive
  via `/api/supabase/rest/v1/...` GET polling (guest_calls, guest_messages,
  customer_entitlements polled every ~1–2 s); **zero WebSocket/wss** observed.
  Contradicts the documented `relay-session:{id}` Supabase realtime channel
  (room.md / R5). The polling masks realtime bugs and is the live transport.
- **CSP Report-Only on PROD** (confirms R13 / OQ-5): console shows
  `upgrade-insecure-requests ignored … report-only`, and Stripe iframe
  `frame-src 'self'` violation **"logged, but no further action taken"** — CSP
  blocks nothing. Stripe.js (test mode) loads.
- **Bulk history query smell:** `guest_messages?...&guest_call_id=in.(~90 UUIDs)`
  and the sibling `client_intakes`/`guest_calls` bulk reads grow with the
  customer's lifetime session count — unbounded `in.(...)` list (perf, low).
- **`AUDIT-ONLINE-ENG-LEAK-1` confirmed on PROD**: anon `GET /api/online-engineers`
  → engineer real UUID + tech + experience (same as dev).

## Mutation log

| Action | Persisted? | Cleanup |
|---|---|---|
| Customer login (UI) on deploy | session cookie | self-expires |
| Stale "Luca" session ended | yes — by **clock expiry** (R3), not a manual click | self-cleaned (resolves E2E-CLEANUP-1 instance) |
| Typed draft message + clicked "Start a call" | **NO** — no session created (`guest_calls` active = `[]`); draft never sent | nothing to clean |

## Not covered (needs engineer-side orchestration)
Ring → engineer accept → live Zoom A/V → cross-role chat propagation → engineer
end. One MCP browser context = one auth; true 2-party needs a second context
(`browser_tabs` shares cookies) or engineer-side curl RPC driving (`claim_session`
/ `mark_joined` / message insert / `end_session`). The customer "Start a call"
did not even reach a ring state in this run, so the handshake could not begin.
Deferred — see coverage-matrix.md re-run requirements.
