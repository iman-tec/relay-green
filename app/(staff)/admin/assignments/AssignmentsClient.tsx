"use client";

/*
 * Super-admin assignments table.
 *
 * One row per engineer. The "Assign to" column is a dropdown listing every
 * supervisor (plus "Unassigned"). Changing the dropdown stages a pending
 * move; rows with pending changes highlight green. The Apply button at
 * the top commits every pending move in one batch via repeated PUTs to
 * /api/admin/assignments.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save, Search } from "lucide-react";

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";

type Row = {
  userId:      string;
  displayName: string;
  email:       string;
  podId:       string | null;
  podName:     string | null;
};

export function AssignmentsClient() {
  const [supervisors, setSupervisors] = useState<Row[]>([]);
  const [engineers,   setEngineers]   = useState<Row[]>([]);
  const [original,    setOriginal]    = useState<Map<string, string | null>>(new Map());
  const [pending,     setPending]     = useState<Map<string, string | null>>(new Map());
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [query,       setQuery]       = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/assignments", { cache: "no-store" });
    const body = await res.json().catch(() => ({ supervisors: [], engineers: [] }));
    if (!res.ok) {
      setError(body.error ?? "Couldn't load assignments.");
      setLoading(false);
      return;
    }
    setSupervisors((body.supervisors ?? []) as Row[]);
    const engs = (body.engineers ?? []) as Row[];
    setEngineers(engs);
    const orig = new Map<string, string | null>();
    for (const e of engs) orig.set(e.userId, e.podId);
    setOriginal(orig);
    setPending(new Map(orig));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const podOptions = useMemo(
    () =>
      supervisors
        .filter((s) => !!s.podId)
        .map((s) => ({ podId: s.podId as string, label: `${s.displayName}${s.podName ? ` — pod ${s.podName}` : ""}` })),
    [supervisors],
  );

  const podNameById = useMemo(() => {
    const map = new Map<string, { supervisor: string; podName: string | null }>();
    for (const s of supervisors) {
      if (s.podId) map.set(s.podId, { supervisor: s.displayName, podName: s.podName });
    }
    return map;
  }, [supervisors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return engineers;
    return engineers.filter(
      (e) =>
        e.displayName.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.podName ?? "").toLowerCase().includes(q),
    );
  }, [engineers, query]);

  const dirty = useMemo(() => {
    const changes: { engineerId: string; podId: string | null }[] = [];
    for (const [eid, pod] of pending) {
      if (original.get(eid) !== pod) changes.push({ engineerId: eid, podId: pod });
    }
    return changes;
  }, [pending, original]);

  const onChange = (engineerId: string, podId: string | null) => {
    setPending((prev) => {
      const next = new Map(prev);
      next.set(engineerId, podId);
      return next;
    });
  };

  const reset = () => setPending(new Map(original));

  const apply = async () => {
    if (dirty.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.all(
        dirty.map((ch) =>
          fetch("/api/admin/assignments", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ch),
          }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })),
        ),
      );
      const failures = results.filter((r) => !r.ok);
      if (failures.length > 0) {
        const msg = (failures[0].body as { error?: string }).error ?? "Some assignments failed.";
        setError(`${failures.length} of ${results.length} failed: ${msg}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-screen-xl space-y-5 px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>Assignments</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Pick a supervisor for each engineer, then Apply to save.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                width: 220,
              }}
            />
          </div>
          <button
            type="button"
            onClick={reset}
            disabled={dirty.length === 0 || saving}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <RotateCcw size={12} />
            Reset
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={dirty.length === 0 || saving}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? "Applying…" : `Apply${dirty.length > 0 ? ` (${dirty.length})` : ""}`}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border px-4 py-2 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={16} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        ) : engineers.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            No engineers found.
          </p>
        ) : podOptions.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            No supervisors with pods yet. Create a supervisor + pod first.
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
                  <Th>Current pod</Th>
                  <Th>Assign to</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((eng, i) => {
                  const originalPod = original.get(eng.userId) ?? null;
                  const pendingPod  = pending.get(eng.userId) ?? null;
                  const moved       = pendingPod !== originalPod;
                  const pendingInfo = pendingPod ? podNameById.get(pendingPod) : null;
                  return (
                    <tr
                      key={eng.userId}
                      style={{
                        borderTop: i === 0 ? undefined : "1px solid var(--border)",
                        backgroundColor: moved ? BRAND_GREEN_SOFT : undefined,
                      }}
                    >
                      <Td>
                        <span style={{ color: "var(--text)", fontWeight: 500 }}>{eng.displayName}</span>
                      </Td>
                      <Td>
                        <span style={{ color: "var(--text-muted)" }}>{eng.email || "—"}</span>
                      </Td>
                      <Td>
                        {eng.podName ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
                          >
                            {eng.podName}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>Unassigned</span>
                        )}
                      </Td>
                      <Td>
                        <select
                          value={pendingPod ?? ""}
                          onChange={(e) =>
                            onChange(eng.userId, e.target.value === "" ? null : e.target.value)
                          }
                          disabled={saving}
                          className="rounded-md border px-2 py-1 text-xs outline-none"
                          style={{
                            borderColor: moved ? BRAND_GREEN : "var(--border)",
                            backgroundColor: "var(--background)",
                            color: "var(--text)",
                            minWidth: 220,
                          }}
                        >
                          <option value="">Unassigned</option>
                          {podOptions.map((o) => (
                            <option key={o.podId} value={o.podId}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {moved && (
                          <span
                            className="ml-2 text-[10px]"
                            style={{ color: BRAND_GREEN }}
                          >
                            → {pendingInfo ? pendingInfo.supervisor : "Unassigned"} (pending)
                          </span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && dirty.length > 0 && (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {dirty.length} change{dirty.length === 1 ? "" : "s"} pending — click Apply to save.
        </p>
      )}
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
