/*
 * Project-level metadata — per-project skill profile.
 *
 * When a customer creates a project (via "+ Create New Project" or via the
 * connect-flow new-project path), they declare the project's shape: what
 * type of thing it is (Marketing site, SaaS, Mobile app, etc.), which AI
 * tool they're building with, and which backend/frontend tech is in
 * play. We persist that to localStorage keyed by project id so that
 * subsequent sessions started in that project can pre-populate the
 * client_intakes payload — driving engineer matching to the right
 * specialist for THIS project's tech, not the customer's last project's.
 *
 * Storage: `localStorage` keyed `relay-project-metadata-v1`. The value
 * is a JSON object mapping projectId → metadata. SSR-safe (no-op on
 * server, in-memory fallback on first paint).
 *
 * // TODO(schema): promote this to Supabase when the customer base
 * exists across devices. Suggested shape: extend `projects` with
 * columns `developing text`, `ai_tools text[]`, `backend text[]`,
 * `frontend text[]` (nullable). The reads/writes here would then call
 * the table via the supabase client instead of localStorage; the API
 * surface (readProjectMetadata / writeProjectMetadata) stays the same
 * so callers don't change.
 */

export interface ProjectMetadata {
  projectType: string;
  aiTools: string[];
  backend: string[];
  frontend: string[];
  /** Epoch ms of last persist. Lets future migrations know whether to
   *  trust the localStorage row vs hit the source-of-truth column. */
  updatedAt: number;
}

const STORAGE_KEY = "relay-project-metadata-v1";

function safeRead(): Record<string, ProjectMetadata> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, ProjectMetadata>)
      : {};
  } catch {
    return {};
  }
}

function safeWrite(map: Record<string, ProjectMetadata>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / privacy mode — local-only, swallow */
  }
}

/** Read the metadata for a specific project. Returns null if the
 *  project has none stored (older projects pre-dating this flow, or a
 *  fresh browser where the customer is signed in but hasn't created
 *  any projects locally). Callers should treat null as "no preferences
 *  recorded" and fall back to the customer's profile-level stack. */
export function readProjectMetadata(projectId: string): ProjectMetadata | null {
  if (!projectId) return null;
  const map = safeRead();
  return map[projectId] ?? null;
}

/** Persist the metadata for a project. Overwrites any prior entry —
 *  the customer is explicitly declaring this project's shape, so we
 *  don't merge with any older entry for the same id. */
export function writeProjectMetadata(
  projectId: string,
  data: Omit<ProjectMetadata, "updatedAt">
): void {
  if (!projectId) return;
  const map = safeRead();
  map[projectId] = { ...data, updatedAt: Date.now() };
  safeWrite(map);
}

/** Drop a project's metadata from local storage. Called when the
 *  project itself is deleted — without this, a freshly-recreated
 *  project with the same id (unlikely but possible) would inherit
 *  stale stack settings. */
export function deleteProjectMetadata(projectId: string): void {
  if (!projectId) return;
  const map = safeRead();
  if (!map[projectId]) return;
  delete map[projectId];
  safeWrite(map);
}
