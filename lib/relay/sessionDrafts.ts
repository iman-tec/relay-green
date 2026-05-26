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
 * // TODO(schema): promote drafts to the `guest_calls` table with a
 * new `draft` status once we want cross-device parity. The
 * read/write/delete API surface here stays the same so call sites
 * don't change; only the implementation flips from localStorage to a
 * Supabase RPC.
 */

export interface SessionDraft {
  /** Local UUID. Stable across edits so the sidebar row identity
   *  doesn't churn. */
  id: string;
  projectId: string;
  /** The problem write-up. Plain text; markdown / formatting deferred. */
  text: string;
  createdAt: number;   // ms epoch
  updatedAt: number;   // ms epoch — bumped on every save
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
    id: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `draft-${now}-${Math.random().toString(36).slice(2, 9)}`,
    projectId: args.projectId,
    text: args.text,
    createdAt: now,
    updatedAt: now,
  };
  map[created.id] = created;
  safeWrite(map);
  return created;
}

/** Delete a draft by id. No-op if not found. */
export function deleteDraft(id: string): void {
  if (!id) return;
  const map = safeRead();
  if (!map[id]) return;
  delete map[id];
  safeWrite(map);
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
