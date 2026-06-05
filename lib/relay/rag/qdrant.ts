/*
 * Minimal Qdrant REST client (no SDK). Used by the RAG indexer (write) and
 * project-qa (read). Reads QDRANT_ENDPOINT + QDRANT_KEY from the environment.
 *
 * One collection holds every project's chunks; each point carries a
 * `project_id` payload so search is always scoped to a single project.
 */
import { createHash } from "node:crypto";

const ENDPOINT = (process.env.QDRANT_ENDPOINT ?? "").replace(/\/$/, "");
const KEY = process.env.QDRANT_KEY ?? "";

export const COLLECTION = "relay_project_chunks";
const VECTOR_SIZE = 1536; // text-embedding-3-small

export type QPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};
export type QFilter = Record<string, unknown>;

function qfetch(path: string, init: RequestInit): Promise<Response> {
  if (!ENDPOINT || !KEY) {
    throw new Error(
      "QDRANT_ENDPOINT / QDRANT_KEY are not set in the environment"
    );
  }
  return fetch(`${ENDPOINT}${path}`, {
    ...init,
    headers: {
      "api-key": KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** A deterministic UUID derived from a stable key, so re-indexing the same
 *  source upserts (replaces) its points instead of duplicating them. */
export function pointId(key: string): string {
  const h = createHash("md5").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Equality filter builder: `{ project_id: "x" }` → Qdrant `must` match. */
export function matchFilter(
  eq: Record<string, string | null | undefined>
): QFilter {
  const must = Object.entries(eq)
    .filter(([, v]) => v != null)
    .map(([key, value]) => ({ key, match: { value } }));
  return { must };
}

let ensured = false;
export async function ensureCollection(): Promise<void> {
  if (ensured) return;
  const get = await qfetch(`/collections/${COLLECTION}`, { method: "GET" });
  if (get.ok) {
    ensured = true;
    return;
  }
  const res = await qfetch(`/collections/${COLLECTION}`, {
    method: "PUT",
    body: JSON.stringify({
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(
      `Qdrant create collection ${res.status}: ${await res.text().catch(() => "")}`
    );
  }
  // Payload indexes make filtered search fast.
  for (const field of ["project_id", "session_id", "source_type"]) {
    await qfetch(`/collections/${COLLECTION}/index`, {
      method: "PUT",
      body: JSON.stringify({ field_name: field, field_schema: "keyword" }),
    }).catch(() => {});
  }
  ensured = true;
}

export async function upsertPoints(points: QPoint[]): Promise<void> {
  if (points.length === 0) return;
  const res = await qfetch(`/collections/${COLLECTION}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points }),
  });
  if (!res.ok)
    throw new Error(
      `Qdrant upsert ${res.status}: ${await res.text().catch(() => "")}`
    );
}

export async function deleteByFilter(filter: QFilter): Promise<void> {
  const res = await qfetch(
    `/collections/${COLLECTION}/points/delete?wait=true`,
    {
      method: "POST",
      body: JSON.stringify({ filter }),
    }
  );
  if (!res.ok)
    throw new Error(
      `Qdrant delete ${res.status}: ${await res.text().catch(() => "")}`
    );
}

export type QHit = {
  id: string;
  score: number;
  payload: Record<string, unknown>;
};
export async function search(
  vector: number[],
  filter: QFilter,
  limit = 24
): Promise<QHit[]> {
  const res = await qfetch(`/collections/${COLLECTION}/points/search`, {
    method: "POST",
    body: JSON.stringify({ vector, filter, limit, with_payload: true }),
  });
  if (!res.ok)
    throw new Error(
      `Qdrant search ${res.status}: ${await res.text().catch(() => "")}`
    );
  const j = (await res.json()) as { result?: QHit[] };
  return j.result ?? [];
}
