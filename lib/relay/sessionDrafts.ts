/*
 * Session drafts — saved-for-later problem write-ups.
 *
 * When a customer hits the + next to a project they enter the Session
 * Prep view where they can draft their problem before ringing the
 * engineer. If they're not ready to call yet, they can "Save for
 * later" — that promotes the draft into a persistent entry that shows
 * up in the sidebar under its project, ready to be re-opened any time.
 *
 * Storage: `localStorage` keyed `relay-session-drafts-v1`. Value is a
 * JSON map keyed by draft id → SessionDraft row. localStorage (not
 * sessionStorage) because drafts are explicitly long-lived — the
 * customer might draft something today and come back to it next week.
 *
 * Server mirror: every save also fires a best-effort write into the
 * `customer_session_drafts` table so the engineer-side handoff (engineer
 * fetches the customer's draft on session mount to use as the opening
 * chat message) can work cross-browser. The local copy stays
 * authoritative for the customer's own edits — server failure is
 * swallowed silently so the customer's "Save for later" never fails
 * because of a network blip.
 */

import { createClient } from "@/lib/supabase/browser";

export interface SessionDraft {
  /** Local UUID. Stable across edits so the sidebar row identity
   *  doesn't churn. */
  id: string;
  projectId: string;
  /** The problem write-up. Plain text; markdown / formatting deferred. */
  text: string;
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch — bumped on every save
}

const STORAGE_KEY = "relay-session-drafts-v1";
const MAX_DRAFTS = 100; // hard cap so a runaway loop can't blow up localStorage

function safeRead(): Record<string, SessionDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, SessionDraft>)
      : {};
  } catch {
    return {};
  }
}

function safeWrite(map: Record<string, SessionDraft>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / privacy mode — local-only, swallow */
  }
}

/** Read one draft by id. Returns null if not found. */
export function readDraft(id: string): SessionDraft | null {
  if (!id) return null;
  return safeRead()[id] ?? null;
}

/** Read every draft belonging to a project. Sorted by updatedAt DESC
 *  so most-recently-edited surfaces first in the sidebar. */
export function listDraftsForProject(projectId: string): SessionDraft[] {
  if (!projectId) return [];
  const all = safeRead();
  const out: SessionDraft[] = [];
  for (const draft of Object.values(all)) {
    if (draft.projectId === projectId) out.push(draft);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Read every draft across all projects. Used for sidebar flat view +
 *  search. Sorted DESC by updatedAt. */
export function listAllDrafts(): SessionDraft[] {
  const out = Object.values(safeRead());
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Upsert: create a new draft or update an existing one. Pass null `id`
 *  to create; the new draft's id is returned. */
export function saveDraft(args: {
  id?: string | null;
  projectId: string;
  text: string;
}): SessionDraft {
  const map = safeRead();
  const now = Date.now();
  if (args.id && map[args.id]) {
    const existing = map[args.id];
    const updated: SessionDraft = {
      ...existing,
      text: args.text,
      updatedAt: now,
    };
    map[args.id] = updated;
    safeWrite(map);
    void mirrorDraftToServer(updated);
    return updated;
  }
  // New draft. Guard against runaway growth — if we're at the cap,
  // drop the oldest before adding the new one.
  const all = Object.values(map);
  if (all.length >= MAX_DRAFTS) {
    all.sort((a, b) => a.updatedAt - b.updatedAt);
    const oldest = all[0];
    if (oldest) delete map[oldest.id];
  }
  const created: SessionDraft = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `draft-${now}-${Math.random().toString(36).slice(2, 9)}`,
    projectId: args.projectId,
    text: args.text,
    createdAt: now,
    updatedAt: now,
  };
  map[created.id] = created;
  safeWrite(map);
  void mirrorDraftToServer(created);
  return created;
}

/** Fire-and-forget server mirror so the engineer side can read the draft
 *  on session mount. Swallows every failure mode (auth, network, RLS) —
 *  the local copy is the authoritative one for the customer's own usage,
 *  and a missing server mirror just means the engineer won't get the
 *  prep-text handoff (which is graceful: their chat just opens empty). */
async function mirrorDraftToServer(draft: SessionDraft): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const sb = createClient();
    const { data: u } = await sb.auth.getUser();
    const customerUserId = u.user?.id;
    if (!customerUserId) return;
    await sb.from("customer_session_drafts").upsert(
      {
        customer_user_id: customerUserId,
        project_id: draft.projectId,
        local_id: draft.id,
        text: draft.text,
        updated_at: new Date(draft.updatedAt).toISOString(),
      },
      { onConflict: "customer_user_id,project_id,local_id" }
    );
  } catch {
    /* best-effort; local copy remains authoritative */
  }
}

/** Awaitable server mirror for the engineer handoff.
 *
 *  saveDraft's mirror is fire-and-forget and only runs for drafts the
 *  customer explicitly "saved for later". When the customer hits "Call
 *  engineer" we instead need to guarantee the prep text is queryable
 *  BEFORE the engineer's session-mount fetch runs — including for a fresh
 *  draft that was never saved. This upserts the row and resolves once the
 *  write lands so the caller can ring without racing the engineer's read.
 *
 *  Best-effort: resolves `false` (never throws) on auth/network/RLS
 *  failure so the call flow is never blocked by a mirror blip — the worst
 *  case is the engineer's chat opens without the prep text, same as today.
 *  Returns the `local_id` used so the caller can clean up the matching
 *  local row without touching the server copy. */
export async function ensureDraftMirrored(args: {
  id?: string | null;
  projectId: string;
  text: string;
}): Promise<{ ok: boolean; localId: string | null }> {
  if (typeof window === "undefined") return { ok: false, localId: null };
  const text = args.text.trim();
  if (!text || !args.projectId) return { ok: false, localId: null };
  const localId = args.id
    ?? (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  try {
    const sb = createClient();
    const { data: u } = await sb.auth.getUser();
    const customerUserId = u.user?.id;
    if (!customerUserId) return { ok: false, localId };
    const { error } = await sb.from("customer_session_drafts").upsert(
      {
        customer_user_id: customerUserId,
        project_id: args.projectId,
        local_id: localId,
        text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "customer_user_id,project_id,local_id" },
    );
    return { ok: !error, localId };
  } catch {
    return { ok: false, localId };
  }
}

/** Remove a draft from localStorage only, leaving any server mirror
 *  intact. Used when "Call engineer" promotes a draft into a live session:
 *  the sidebar row should disappear, but the engineer still needs to fetch
 *  the mirrored prep text (and consumes the server row itself afterwards
 *  via engineer_consume_draft). Contrast with deleteDraft, which also
 *  tears down the server mirror. */
export function deleteDraftLocalOnly(id: string): void {
  if (!id) return;
  const map = safeRead();
  if (!map[id]) return;
  delete map[id];
  safeWrite(map);
}

/** Delete a draft by id. No-op if not found. */
export function deleteDraft(id: string): void {
  if (!id) return;
  const map = safeRead();
  if (!map[id]) return;
  delete map[id];
  safeWrite(map);
  // Best-effort server-side cleanup so the engineer never re-reads a
  // ghost draft. The customer's RLS policy lets them delete their own
  // rows directly.
  void (async () => {
    try {
      const sb = createClient();
      await sb.from("customer_session_drafts").delete().eq("local_id", id);
    } catch {
      /* swallow */
    }
  })();
}

/** Delete every draft for a project. Useful when a project is itself
 *  archived/deleted — leftover drafts would be confusing. */
export function deleteDraftsForProject(projectId: string): void {
  if (!projectId) return;
  const map = safeRead();
  let touched = false;
  for (const id of Object.keys(map)) {
    if (map[id].projectId === projectId) {
      delete map[id];
      touched = true;
    }
  }
  if (touched) safeWrite(map);
}

/** Generate a short, scannable title for a draft from its text. Used
 *  as the sidebar row label when no explicit title exists. Returns
 *  "(empty draft)" when text is blank so empty rows still render
 *  legibly while the user is mid-edit. */
export function deriveDraftTitle(draft: SessionDraft, maxLen = 36): string {
  const trimmed = draft.text.trim();
  if (!trimmed) return "(empty draft)";
  const firstLine = trimmed.split(/\r?\n/)[0] || "";
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 1).trimEnd() + "…";
}
