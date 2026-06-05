"use client";

/*
 * Generic, paginated, sortable, searchable table. Every list surface in
 * the app uses this so we get one consistent UX (search top-left, filter
 * chips top-right, sortable headers, skeleton during load, footer pager).
 *
 * Pair with `useListQuery<T>(endpoint, opts)` from lib/hooks/useListQuery.
 *
 *   <DataTable
 *     list={list}
 *     columns={[
 *       { key: "displayName", header: "Name",  sortable: true, render: (r) => r.displayName },
 *       { key: "email",       header: "Email", sortable: true, render: (r) => r.email },
 *     ]}
 *     getRowKey={(r) => r.userId}
 *     searchPlaceholder="Search users…"
 *   />
 */

import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Search,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { useListQuery } from "@/lib/hooks/useListQuery";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";

export type Column<T> = {
  /** Column id. Sortable columns must match the server's sortable allowlist. */
  key: string;
  header: ReactNode;
  /** Whether the user can sort by this column. */
  sortable?: boolean;
  /** Right-align the cell (numbers / actions). */
  align?: "left" | "right" | "center";
  /** Render the cell. */
  render: (row: T) => ReactNode;
  /** Width hint (e.g. "260px", "20%"). */
  width?: string;
};

export type FilterControl = {
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
};

export function DataTable<T>({
  list,
  columns,
  getRowKey,
  searchPlaceholder = "Search…",
  filters = [],
  onRowClick,
  emptyText = "Nothing here yet.",
  lockPageSize = false,
}: {
  list: ReturnType<typeof useListQuery<T>>;
  columns: ReadonlyArray<Column<T>>;
  getRowKey: (row: T) => string;
  searchPlaceholder?: string;
  filters?: ReadonlyArray<FilterControl>;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  /** Hide the page-size selector and pin to the hook's pageSize. */
  lockPageSize?: boolean;
}) {
  const showingFrom =
    list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const showingTo = Math.min(list.page * list.pageSize, list.total);

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={list.q}
            onChange={(e) => list.setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="rounded-md border py-1.5 pr-2 pl-7 text-xs outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
              width: 260,
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <select
              key={f.key}
              value={list.filters[f.key] ?? ""}
              onChange={(e) =>
                list.setFilter(f.key, e.target.value || undefined)
              }
              className="rounded-md border px-2 py-1.5 text-xs outline-none"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--background)",
                color: "var(--text)",
              }}
            >
              <option value="">{f.label}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
        </div>
      </div>

      {list.error && (
        <div
          className="rounded-md border px-3 py-1.5 text-[12px]"
          style={{
            borderColor:
              "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor:
              "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {list.error}
        </div>
      )}

      {/* Table */}
      <div
        className="overflow-hidden rounded-xl border"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                {columns.map((c) => {
                  const active = list.sort?.column === c.key;
                  const isSortable = !!c.sortable;
                  return (
                    <th
                      key={c.key}
                      style={{
                        textAlign: c.align ?? "left",
                        width: c.width,
                        cursor: isSortable ? "pointer" : "default",
                      }}
                      onClick={() => isSortable && list.toggleSort(c.key)}
                      className="px-5 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase select-none"
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.header}
                        {isSortable &&
                          active &&
                          (list.sort!.dir === "asc" ? (
                            <ArrowUp size={10} style={{ color: BRAND_GREEN }} />
                          ) : (
                            <ArrowDown
                              size={10}
                              style={{ color: BRAND_GREEN }}
                            />
                          ))}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {list.loading && list.rows.length === 0 ? (
                Array.from({ length: list.pageSize }).map((_, i) => (
                  <SkeletonRow key={`sk-${i}`} cols={columns.length} />
                ))
              ) : list.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-5 py-10 text-center text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {list.q || hasAnyFilter(list.filters)
                      ? "No matches for the current filters."
                      : emptyText}
                  </td>
                </tr>
              ) : (
                <>
                  {list.rows.map((row, i) => {
                    const key = getRowKey(row);
                    return (
                      <tr
                        key={key}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        style={{
                          borderTop:
                            i === 0 ? undefined : "1px solid var(--border)",
                          cursor: onRowClick ? "pointer" : undefined,
                        }}
                        className={
                          onRowClick
                            ? "transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                            : ""
                        }
                      >
                        {columns.map((c) => (
                          <td
                            key={c.key}
                            className="h-11 px-5 py-2.5 align-middle whitespace-nowrap"
                            style={{ textAlign: c.align ?? "left" }}
                          >
                            {c.render(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {/* Pad to pageSize so every page is the same height —
                     keeps the footer anchored at the bottom of the card. */}
                  {Array.from({
                    length: Math.max(0, list.pageSize - list.rows.length),
                  }).map((_, i) => (
                    <tr
                      key={`filler-${i}`}
                      aria-hidden
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      {columns.map((c) => (
                        <td key={c.key} className="h-11 px-5 py-2.5" />
                      ))}
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / pager */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="flex items-center gap-2 text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            {list.loading && (
              <Loader2
                size={11}
                className="animate-spin"
                style={{ color: BRAND_GREEN }}
              />
            )}
            <span>
              {list.total > 0
                ? `Showing ${showingFrom}–${showingTo} of ${list.total}`
                : "0 results"}
            </span>
            {!lockPageSize && (
              <>
                <span className="opacity-50">·</span>
                <label className="inline-flex items-center gap-1.5">
                  <span>Rows per page</span>
                  <select
                    value={list.pageSize}
                    onChange={(e) =>
                      list.setPageSize(parseInt(e.target.value, 10) || 25)
                    }
                    className="cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors outline-none hover:border-[color:var(--text-muted)]"
                    style={{
                      borderColor: "var(--border)",
                      backgroundColor: "var(--background)",
                      color: "var(--text)",
                    }}
                  >
                    {[10, 25, 50, 100].map((n) => (
                      <option
                        key={n}
                        value={n}
                        style={{
                          backgroundColor: "var(--surface)",
                          color: "var(--text)",
                        }}
                      >
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          <div className="flex items-center gap-1">
            <PagerButton
              onClick={() => list.setPage(1)}
              disabled={list.page <= 1}
              aria="First page"
            >
              <ChevronsLeft size={12} />
            </PagerButton>
            <PagerButton
              onClick={() => list.setPage(list.page - 1)}
              disabled={list.page <= 1}
              aria="Previous page"
            >
              <ChevronLeft size={12} />
            </PagerButton>
            <span
              className="px-2 text-[11px] tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              {list.page} / {list.pageCount}
            </span>
            <PagerButton
              onClick={() => list.setPage(list.page + 1)}
              disabled={list.page >= list.pageCount}
              aria="Next page"
            >
              <ChevronRight size={12} />
            </PagerButton>
            <PagerButton
              onClick={() => list.setPage(list.pageCount)}
              disabled={list.page >= list.pageCount}
              aria="Last page"
            >
              <ChevronsRight size={12} />
            </PagerButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function PagerButton({
  onClick,
  disabled,
  aria,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  aria: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="flex h-6 w-6 items-center justify-center rounded-md border transition-colors hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="h-11 px-5 py-2.5">
          <span
            className="block h-3 w-full animate-pulse rounded"
            style={{ backgroundColor: BRAND_GREEN_SOFT }}
          />
        </td>
      ))}
    </tr>
  );
}

function hasAnyFilter(filters: Record<string, string | undefined>) {
  for (const v of Object.values(filters)) {
    if (v != null && v !== "") return true;
  }
  return false;
}
