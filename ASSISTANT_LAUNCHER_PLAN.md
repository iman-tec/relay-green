# ASSISTANT_LAUNCHER_PLAN — engineer-side assistant → floating launcher + tab

User requested fast-track; plan + implementation land together.

## Discovery (verified in code)
- Assistant component: `app/_components/ProjectAIAssistant.tsx` (self-contained;
  loads project memory from `projectId` prop; backend = project_ai threads, so
  any mount shares the same memory).
- Inline render site 1 — session workspace (callOpen=false):
  `EngineerSessionClient` MainPane two-pane (ChatPane + ProjectAIAssistant,
  ~line 713).
- Inline render site 2 — Zoom call screen (callOpen=true): left `Panel
  id="eng-call-ai"` (~line 505).
- Accept handler: `EngineerIncomingMatch.accept` (accept_match → session row
  carries `project_id` — the CUSTOMER-selected project).
- Session-end flow: status→ended effect already redirects engineer to
  /staff/project/[id].
- No existing BroadcastChannel util — native API used directly.

## Implementation checklist
- [x] `lib/relay/assistantTab.ts` — popup-safe open/focus helper, per-session
      named window (`relay-assistant-{sessionId}`), handle cache (no
      duplicates), popup-blocked sessionStorage flag.
- [x] `app/staff/assistant/page.tsx` (+ client) — full-window
      ProjectAIAssistant from `?session&project`; BroadcastChannel
      `relay-assistant-{sessionId}` listener → "Session ended" overlay.
- [x] `app/_components/AssistantLauncher.tsx` — 48px draggable floating
      sparkle: pointer events (mouse+touch), 5px click-vs-drag threshold,
      viewport clamping + re-clamp on resize, NO persistence (default
      bottom-right, clear of End-session/top controls), keyboard
      activatable, aria-label.
- [x] EngineerSessionClient: both inline panels removed (call screen →
      CallSurface full width; workspace → full-width ChatPane); launcher
      mounted for engineers while session is active; "ended" broadcast on
      terminal status; popup-blocked toast (one-shot) on mount.
- [x] EngineerIncomingMatch.accept: synchronous `window.open("about:blank")`
      inside the Accept gesture → named + navigated to the assistant route
      after accept succeeds (closed on failure); blocked → flag + launcher
      fallback.

## Verification
- [x] tsc --noEmit exit 0 (gate for the commit).
- [ ] Manual (needs a ringing offer): Accept auto-opens tab; drag ≠ open;
      click opens/refocuses; session end shows "Session ended" in tab.
