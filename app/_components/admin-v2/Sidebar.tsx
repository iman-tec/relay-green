"use client";

/*
 * Master-list sidebar used throughout the redesigned super-admin panel.
 *
 * Layout: search box on top, scrollable item list in the middle, action
 * button pinned to the bottom. Used 2× in Enterprise tab, 3× in Reseller
 * tab, 1× in Pods tab.
 *
 * The renderer for each item is supplied by the caller (so different
 * tabs can surface different metadata — minutes bar, status dot, badge,
 * etc.).
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

export type SidebarItem = {
  id:    string;
  label: string;
  /** Lowercase haystack the search box filters on. Falls back to label. */
  search?: string;
};

export function Sidebar<T extends SidebarItem>({
  title,
  searchPlaceholder = "Search…",
  items,
  selectedId,
  onSelect,
  renderRow,
  footer,
  width = 280,
  emptyMessage = "No items.",
}: {
  title?:             string;
  searchPlaceholder?: string;
  items:              readonly T[];
  selectedId:         string | null;
  onSelect:           (item: T) => void;
  renderRow:          (item: T, selected: boolean) => React.ReactNode;
  /** Pinned to the bottom. Typically an "+ Add …" button. */
  footer?:            React.ReactNode;
  width?:             number;
  emptyMessage?:      string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return items;
    return items.filter((it) =>
      (it.search ?? it.label).toLowerCase().includes(q),
    );
  }, [items, q]);

  return (
    <aside
      className="flex shrink-0 flex-col border-r"
      style={{ width, borderColor: "var(--border)", background: "var(--surface)" }}
    >
      {title && (
        <header
          className="px-4 pt-3 pb-2 text-xs font-semibold tracking-wide uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          {title}
        </header>
      )}

      <div className="px-3 pt-1 pb-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 size-4"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border bg-transparent py-2 pr-2 pl-8 text-sm outline-none"
            style={{
              borderColor: "var(--border)",
              color:       "var(--text)",
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {q ? "No matches." : emptyMessage}
          </p>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((it) => {
              const selected = it.id === selectedId;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(it)}
                    className="w-full px-3 py-2.5 text-left transition-colors"
                    style={{
                      background: selected
                        ? "color-mix(in srgb, var(--primary) 10%, transparent)"
                        : "transparent",
                      borderLeft: selected
                        ? "2px solid var(--primary)"
                        : "2px solid transparent",
                    }}
                  >
                    {renderRow(it, selected)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {footer && (
        <footer
          className="border-t px-3 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          {footer}
        </footer>
      )}
    </aside>
  );
}
