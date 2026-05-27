"use client";

/*
 * Super-admin bench — expertise matrix (F1) + onboarding tracker (F4).
 * Read-only view of every engineer's expertise axes, pod, presence, and how
 * far through the 6-step intake they are. Editing (F2) + pod-holiday bulk-set
 * (B4) land in follow-up commits.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Users, CheckCircle2, CircleDashed } from "lucide-react";

type Engineer = {
  userId: string; name: string; email: string; pod: string;
  presenceState: string; isAvailable: boolean;
  expertise: string[]; technologies: string[]; issues: string[]; environments: string[];
  experienceLevel: string | null; onboardingComplete: boolean; onboardingPct: number;
};

const PRESENCE_DOT: Record<string, string> = { online: "var(--ok)", busy: "var(--warn)", offline: "var(--text-faint)" };

export function BenchTab() {
  const [view, setView] = useState<"matrix" | "onboarding">("matrix");
  const [rows, setRows] = useState<Engineer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/engineers", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { engineers?: Engineer[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn't load the bench.");
      setRows(body.engineers ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load the bench."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>
            <Users size={20} /> Bench
          </h1>
          <div className="flex gap-1">
            {(["matrix", "onboarding"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className="rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors"
                style={{ borderColor: view === v ? "var(--primary)" : "var(--border)", background: view === v ? "var(--primary-tint)" : "transparent", color: view === v ? "var(--primary-hover)" : "var(--text-muted)" }}>
                {v === "matrix" ? "Expertise matrix" : "Onboarding"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>
        ) : error ? (
          <p className="py-6 text-sm" style={{ color: "var(--risk)" }}>{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm" style={{ color: "var(--text-muted)" }}>No engineers found.</p>
        ) : view === "matrix" ? (
          <Matrix rows={rows} />
        ) : (
          <Onboarding rows={rows} />
        )}
      </div>
    </div>
  );
}

function Matrix({ rows }: { rows: Engineer[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            {["Engineer", "Pod", "Level", "Expertise", "Technologies", "Issues", "Environments"].map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.userId} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: PRESENCE_DOT[e.presenceState] ?? "var(--text-faint)" }} />
                  <div className="min-w-0">
                    <div className="truncate" style={{ color: "var(--text)" }}>{e.name}</div>
                    <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{e.email}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3" style={{ color: "var(--text-muted)" }}>{e.pod}</td>
              <td className="px-3 py-3" style={{ color: "var(--text-muted)" }}>{e.experienceLevel ?? "—"}</td>
              <td className="px-3 py-3"><Tags items={e.expertise} /></td>
              <td className="px-3 py-3"><Tags items={e.technologies} /></td>
              <td className="px-3 py-3"><Tags items={e.issues} /></td>
              <td className="px-3 py-3"><Tags items={e.environments} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Onboarding({ rows }: { rows: Engineer[] }) {
  const incomplete = rows.filter((e) => !e.onboardingComplete);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {rows.length - incomplete.length} of {rows.length} engineers fully onboarded · {incomplete.length} need a nudge
      </p>
      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        {rows.map((e) => (
          <div key={e.userId} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--border)" }}>
            {e.onboardingComplete
              ? <CheckCircle2 size={16} style={{ color: "var(--ok)" }} />
              : <CircleDashed size={16} style={{ color: "var(--warn)" }} />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm" style={{ color: "var(--text)" }}>{e.name}</div>
              <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{e.pod} · {e.email}</div>
            </div>
            <div className="flex w-40 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-raised)" }}>
                <div className="h-full rounded-full" style={{ width: `${e.onboardingPct}%`, background: e.onboardingComplete ? "var(--ok)" : "var(--warn)" }} />
              </div>
              <span className="w-9 text-right text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{e.onboardingPct}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tags({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span key={i} className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>{t}</span>
      ))}
    </div>
  );
}
