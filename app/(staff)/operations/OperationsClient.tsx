"use client";

/*
 * Supervisor operations roster — compact, read-only table of every
 * engineer in the caller's pod. Columns: name, email, currently working
 * with, last call. Search by name or email.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";

type Engineer = {
  userId:          string;
  displayName:     string;
  email:           string;
  primaryRole:     string;
  currentCustomer: string | null;
  lastCustomer:    string | null;
  lastCallAt:      string | null;
};

type Pod = { id: string; name: string } | null;

export function OperationsClient() {
  const [pod, setPod]         = useState<Pod>(null);
  const [rows, setRows]       = useState<Engineer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/supervisor/team", { cache: "no-store" });
      const body = await res.json().catch(() => ({ engineers: [] }));
      setPod((body.pod ?? null) as Pod);
      setRows((body.engineers ?? []) as Engineer[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.currentCustomer ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="mx-auto max-w-screen-xl space-y-5 px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>Operations</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {pod ? `Pod ${pod.name} — engineers under your watch.` : "Engineers under your watch."}
          </p>
        </div>
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search engineers…"
            className="rounded-md border py-1 pl-7 pr-2 text-xs outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
              width: 240,
            }}
          />
        </div>
      </div>

      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={16} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {rows.length === 0
              ? "No engineers in your pod yet."
              : `No engineers match “${query}”.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Currently working with</Th>
                  <Th>Last call</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={r.userId}
                    style={{
                      borderTop: i === 0 ? undefined : "1px solid var(--border)",
                    }}
                  >
                    <Td>
                      <span style={{ color: "var(--text)", fontWeight: 500 }}>{r.displayName}</span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--text-muted)" }}>{r.email || "—"}</span>
                    </Td>
                    <Td>
                      {r.currentCustomer ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: BRAND_GREEN }}
                          />
                          <span style={{ color: "var(--text)" }}>{r.currentCustomer}</span>
                          <span
                            className="ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
                            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
                          >
                            Live
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>Idle</span>
                      )}
                    </Td>
                    <Td>
                      {r.lastCallAt ? (
                        <span>
                          <span style={{ color: "var(--text)" }}>{r.lastCustomer ?? "—"}</span>
                          <span className="ml-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                            {new Date(r.lastCallAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-2 text-left text-[12px] font-semibold uppercase tracking-[0.08em]">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="h-11 px-5 py-2.5 align-middle whitespace-nowrap">{children}</td>;
}
