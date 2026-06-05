"use client";

/*
 * Engineer-side AI-assistant tab plumbing.
 *
 * The assistant no longer renders inline in the session screens — it lives
 * in its own tab at /staff/assistant?session=…&project=…. One tab per
 * session, named `relay-assistant-{sessionId}`: re-opening focuses the
 * existing tab instead of spawning duplicates. All opens MUST happen
 * inside a user gesture (Accept click / launcher click) or the browser
 * popup-blocks them; when that still happens we set a sessionStorage flag
 * so the session page can hint at the floating launcher.
 */

const handles = new Map<string, Window>();

export const POPUP_BLOCKED_KEY = "relay:assistant-popup-blocked";

export function assistantTabUrl(
  sessionId: string,
  projectId: string | null
): string {
  const q = new URLSearchParams({ session: sessionId });
  if (projectId) q.set("project", projectId);
  return `/staff/assistant?${q.toString()}`;
}

export function assistantChannelName(sessionId: string): string {
  return `relay-assistant-${sessionId}`;
}

// Standalone WINDOW (not a tab): passing size features makes window.open
// spawn a separate popup window the engineer can place beside the call.
// NB: never add "noopener" here — it makes window.open return null and we
// need the handle for refocus/adopt.
function popupFeatures(): string {
  const availW = window.screen?.availWidth ?? 1280;
  const availH = window.screen?.availHeight ?? 900;
  const w = Math.min(960, availW);
  const h = Math.min(1000, availH - 40);
  const left = Math.max(0, Math.round((availW - w) / 2));
  const top = Math.max(0, Math.round((availH - h) / 3));
  return `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
}

/**
 * Open (or refocus) the assistant tab for a session. Call ONLY from a user
 * gesture. Returns true when a tab is open/focused, false when blocked.
 */
export function openAssistantTab(
  sessionId: string,
  projectId: string | null
): boolean {
  const existing = handles.get(sessionId);
  if (existing && !existing.closed) {
    existing.focus();
    return true;
  }
  const w = window.open(
    assistantTabUrl(sessionId, projectId),
    assistantChannelName(sessionId),
    popupFeatures()
  );
  if (!w) {
    try {
      sessionStorage.setItem(POPUP_BLOCKED_KEY, sessionId);
    } catch {
      /* ignore */
    }
    return false;
  }
  handles.set(sessionId, w);
  w.focus();
  return true;
}

/**
 * Popup-safe pattern for flows where the session id is only known AFTER an
 * await (e.g. Accept → accept_match → session): open a blank window
 * synchronously inside the gesture, then adopt() it once the ids exist —
 * or discard() it if the flow failed.
 */
export function prepareAssistantTab(): {
  adopt: (sessionId: string, projectId: string | null) => void;
  discard: () => void;
} {
  const w =
    typeof window !== "undefined"
      ? window.open("about:blank", "_blank", popupFeatures())
      : null;
  if (!w) {
    try {
      sessionStorage.setItem(POPUP_BLOCKED_KEY, "pending");
    } catch {
      /* ignore */
    }
  }
  return {
    adopt(sessionId, projectId) {
      if (!w || w.closed) return;
      try {
        w.name = assistantChannelName(sessionId);
      } catch {
        /* cross-origin guard — same-origin here, but stay safe */
      }
      w.location.href = assistantTabUrl(sessionId, projectId);
      handles.set(sessionId, w);
    },
    discard() {
      w?.close();
    },
  };
}

/** One-shot read of the popup-blocked hint flag. */
export function consumePopupBlockedFlag(): boolean {
  try {
    const v = sessionStorage.getItem(POPUP_BLOCKED_KEY);
    if (v) {
      sessionStorage.removeItem(POPUP_BLOCKED_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Close the assistant window for a session (no-op if never opened or
 *  already closed). Belt-and-braces beside broadcastAssistantEnd: the
 *  broadcast lets a loaded assistant window close itself; this handle
 *  close also catches a window still navigating (about:blank → adopt)
 *  that hasn't subscribed to the channel yet. */
export function closeAssistantTab(sessionId: string): void {
  const w = handles.get(sessionId);
  handles.delete(sessionId);
  if (w && !w.closed) {
    try {
      w.close();
    } catch {
      /* already gone */
    }
  }
}

/** Broadcast "session ended" so the assistant tab can close itself (or
 *  show its end state when the browser refuses the close). */
export function broadcastAssistantEnd(sessionId: string): void {
  try {
    const ch = new BroadcastChannel(assistantChannelName(sessionId));
    ch.postMessage({ type: "session-ended" });
    ch.close();
  } catch {
    // BroadcastChannel unsupported — localStorage event fallback.
    try {
      localStorage.setItem(
        `${assistantChannelName(sessionId)}:ended`,
        String(Date.now())
      );
    } catch {
      /* degraded sync; both surfaces still share the backend session */
    }
  }
}
