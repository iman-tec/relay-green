/*
 * Server-side helper for paginated list endpoints.
 *
 * Every list API route accepts the same query string contract:
 *
 *   ?q=<search>&sort=<col:asc|desc>&page=<n>&pageSize=<n>&role=<filter>
 *
 * The handler validates `sort` against an allowlist + clamps page/pageSize,
 * then returns:
 *
 *   { rows: T[], total: number, page: number, pageSize: number }
 *
 * Keeping this centralized means every list page has the same affordances
 * (search, sort, pagination, filter) and the same wire format — the
 * client hook + DataTable just plug in.
 */

export type ListQuery<F extends string = never> = {
  q: string;
  page: number;
  pageSize: number;
  sort: { column: string; dir: "asc" | "desc" } | null;
  /** Extra single-value filters parsed from the query string. */
  filters: Record<F, string | undefined>;
  /** Range tuple ready to feed straight into `.range(from, to)`. */
  range: [number, number];
};

export type ListQuerySpec<S extends string, F extends string = never> = {
  /** Whitelisted columns the caller may sort by. First entry is the default. */
  sortable: readonly S[];
  /** Default sort direction when the client omits one. */
  defaultSort?: { column: S; dir: "asc" | "desc" };
  /** Extra named filter params we accept (e.g. ["role"]). */
  filters?: readonly F[];
  /** Hard upper bound on pageSize, to protect against bad clients. */
  maxPageSize?: number;
  /** Default pageSize when the client omits one. */
  defaultPageSize?: number;
};

export function parseListQuery<S extends string, F extends string = never>(
  url: URL | string,
  spec: ListQuerySpec<S, F>
): ListQuery<F> {
  const u = typeof url === "string" ? new URL(url) : url;

  const q = (u.searchParams.get("q") ?? "").trim();

  const defaultPageSize = spec.defaultPageSize ?? 25;
  const maxPageSize = spec.maxPageSize ?? 100;
  const page = clampInt(
    u.searchParams.get("page"),
    1,
    1,
    Number.MAX_SAFE_INTEGER
  );
  const pageSize = clampInt(
    u.searchParams.get("pageSize"),
    defaultPageSize,
    1,
    maxPageSize
  );

  const sort =
    parseSort(u.searchParams.get("sort"), spec.sortable as readonly string[]) ??
    (spec.defaultSort
      ? { column: spec.defaultSort.column as string, dir: spec.defaultSort.dir }
      : null);

  const filters = {} as Record<F, string | undefined>;
  for (const name of spec.filters ?? []) {
    const v = u.searchParams.get(name as string);
    filters[name] = v && v.trim() ? v.trim() : undefined;
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return { q, page, pageSize, sort, filters, range: [from, to] };
}

function clampInt(
  raw: string | null,
  fallback: number,
  lo: number,
  hi: number
): number {
  const n = raw == null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function parseSort(raw: string | null, allowed: readonly string[]) {
  if (!raw) return null;
  const [colRaw, dirRaw = "asc"] = raw.split(":");
  const col = (colRaw ?? "").trim();
  const dir = (dirRaw ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";
  if (!allowed.includes(col)) return null;
  return { column: col, dir: dir as "asc" | "desc" };
}

/**
 * Apply an ilike '%q%' search across the given columns. Wraps in OR for
 * the supabase-js query builder. No-op when q is empty.
 */
export function applySearch<B extends { or: (filter: string) => B }>(
  qb: B,
  q: string,
  columns: readonly string[]
): B {
  const trimmed = q.trim();
  if (!trimmed || columns.length === 0) return qb;
  // ilike pattern. supabase-js .or expects "col.ilike.pattern,col2.ilike.pattern"
  const safe = trimmed.replace(/[%,]/g, " ");
  const expr = columns.map((c) => `${c}.ilike.%${safe}%`).join(",");
  return qb.or(expr);
}

/** Build the canonical { rows, total, page, pageSize } payload. */
export function listResponse<T>(
  rows: T[],
  total: number,
  page: number,
  pageSize: number
) {
  return { rows, total, page, pageSize };
}
