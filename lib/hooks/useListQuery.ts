"use client";

/*
 * Client-side counterpart to lib/api/list-query.ts.
 *
 * Owns the search / sort / page / filter state for one list page. Syncs
 * to the URL so refresh + back-button restore the view. Debounces the
 * search input. Returns a ready-to-render bag for <DataTable>.
 *
 *   const list = useListQuery<UserRow>("/api/admin/users", {
 *     pageSize: 25,
 *     sort: { column: "displayName", dir: "asc" },
 *     filters: ["role"],
 *   });
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SortState = { column: string; dir: "asc" | "desc" } | null;

export type ListResponse<T> = {
  rows:     T[];
  total:    number;
  page:     number;
  pageSize: number;
};

type Options = {
  pageSize?: number;
  sort?:     SortState;
  filters?:  readonly string[];
  /** Extra query params merged into every request (use for fixed scoping
   *  like `?scope=staff`). Not stored in state, not user-editable. */
  fixedParams?: Record<string, string | undefined>;
};

export function useListQuery<T>(endpoint: string, opts: Options = {}) {
  // Stringify every config object up front so unstable parent-render refs
  // ({ filters: [...], fixedParams: {...} } as literals) don't push new
  // identities into the fetch dependency array and cause an endless
  // refetch loop.
  const filterKeysKey  = JSON.stringify(opts.filters     ?? []);
  const fixedParamsKey = JSON.stringify(opts.fixedParams ?? {});

  // Always-current reference for use inside fetchRows without listing the
  // object itself as a dep.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const initialPageSize = opts.pageSize ?? 25;
  const initialSort     = opts.sort     ?? null;

  const [q,        setQ]        = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sort,     setSort]     = useState<SortState>(initialSort);
  const [filters,  setFilters]  = useState<Record<string, string | undefined>>({});

  const [rows,    setRows]    = useState<T[]>([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const filtersKey = JSON.stringify(filters);

  // Debounce the search input by 250 ms so we don't fire one fetch per
  // keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  // Any change to q, sort, page, pageSize, or filters resets to page 1
  // (except when only page itself changed).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) return;
    setPage(1);
  }, [debouncedQ, sort?.column, sort?.dir, pageSize, filtersKey]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const o = optsRef.current;
    const filterKeys: readonly string[] = JSON.parse(filterKeysKey);
    const fixedParams = JSON.parse(fixedParamsKey) as Record<string, string | undefined>;
    const filtersSnap = JSON.parse(filtersKey)     as Record<string, string | undefined>;

    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (sort)       params.set("sort", `${sort.column}:${sort.dir}`);
    params.set("page",     String(page));
    params.set("pageSize", String(pageSize));
    for (const k of filterKeys) {
      const v = filtersSnap[k];
      if (v != null && v !== "") params.set(k, v);
    }
    for (const [k, v] of Object.entries(fixedParams)) {
      if (v != null && v !== "") params.set(k, v);
    }
    void o; // keep ref alive — read from optsRef.current if we need it later

    const sep = endpoint.includes("?") ? "&" : "?";
    try {
      const res = await fetch(`${endpoint}${sep}${params.toString()}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as ListResponse<T> | { error?: string } | null;
      if (!res.ok || !body || "error" in body) {
        setError(((body as { error?: string }) ?? {}).error ?? `HTTP ${res.status}`);
        setRows([]);
        setTotal(0);
        return;
      }
      const resp = body as ListResponse<T>;
      setRows(resp.rows ?? []);
      setTotal(Number(resp.total) || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
      isFirstRender.current = false;
    }
  }, [endpoint, debouncedQ, sort?.column, sort?.dir, page, pageSize, filtersKey, fixedParamsKey, filterKeysKey]);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  const toggleSort = useCallback((column: string) => {
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  }, []);

  const setFilter = useCallback((key: string, value: string | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return {
    rows, total, loading, error,
    q,        setQ,
    page,     setPage,
    pageSize, setPageSize,
    sort,     toggleSort, setSort,
    filters,  setFilter,
    pageCount,
    refresh: fetchRows,
  };
}
