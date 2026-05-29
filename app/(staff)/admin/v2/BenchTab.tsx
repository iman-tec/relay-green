"use client";

/*
 * Super-admin bench — expertise matrix (F1) + onboarding tracker (F4).
 * Read-only view of every engineer's expertise axes, pod, presence, and how
 * far through the 6-step intake they are. Editing (F2) + pod-holiday bulk-set
 * (B4) land in follow-up commits.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";
import { Loader2, Users, CheckCircle2, CircleDashed, Pencil, CalendarOff, X, Inbox, Check, Ban, Siren, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Engineer = {
  userId: string; name: string; email: string; nickname: string | null; pod: string;
  presenceState: string; isAvailable: boolean;
  projectTypes: string[]; aiTools: string[]; backendStacks: string[]; frontendStacks: string[];
  experienceLevel: string | null; onboardingComplete: boolean; onboardingPct: number;
};
type Pod = { id: string; name: string };

const PRESENCE_DOT: Record<string, string> = { online: "var(--ok)", busy: "var(--warn)", offline: "var(--text-faint)" };

export function BenchTab() {
  const [view, setView] = useState<"matrix" | "onboarding" | "requests">("matrix");
  const [rows, setRows] = useState<Engineer[]>([]);
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Engineer | null>(null);
  const [holidayOpen, setHolidayOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/engineers", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { engineers?: Engineer[]; pods?: Pod[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn't load the bench.");
      setRows(body.engineers ?? []);
      setPods(body.pods ?? []);
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
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setHolidayOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              <CalendarOff size={13} /> Set pod holiday
            </button>
            <div className="flex gap-1">
              {(["matrix", "onboarding", "requests"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className="rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors"
                  style={{ borderColor: view === v ? "var(--primary)" : "var(--border)", background: view === v ? "var(--primary-tint)" : "transparent", color: view === v ? "var(--primary-hover)" : "var(--text-muted)" }}>
                  {v === "matrix" ? "Expertise matrix" : v === "onboarding" ? "Onboarding" : "Requests"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <OpsBanner />

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>
        ) : error ? (
          <p className="py-6 text-sm" style={{ color: "var(--risk)" }}>{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm" style={{ color: "var(--text-muted)" }}>No engineers found.</p>
        ) : view === "matrix" ? (
          <Matrix rows={rows} onEdit={setEditing} />
        ) : view === "onboarding" ? (
          <Onboarding rows={rows} />
        ) : (
          <RequestsInbox />
        )}
      </div>

      {editing && <EditDrawer engineer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {holidayOpen && <PodHolidayModal pods={pods} onClose={() => setHolidayOpen(false)} onDone={() => { setHolidayOpen(false); void load(); }} />}
    </div>
  );
}

function Matrix({ rows, onEdit }: { rows: Engineer[]; onEdit: (e: Engineer) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            {["Engineer", "Alias", "Pod", "Level", "Project types", "AI tools", "Backend", "Frontend", ""].map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.userId} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: PRESENCE_DOT[e.presenceState] ?? "var(--text-faint)" }} title={e.isAvailable ? "On duty" : "Off duty"} />
                  <div className="min-w-0">
                    <div className="truncate" style={{ color: "var(--text)" }}>{e.name}</div>
                    <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{e.email}</div>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-3" style={{ color: "var(--text-muted)" }}>{e.nickname ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3" style={{ color: "var(--text-muted)" }}>{e.pod}</td>
              <td className="whitespace-nowrap px-3 py-3" style={{ color: "var(--text-muted)" }}>{e.experienceLevel ?? "—"}</td>
              <td className="px-3 py-3"><Tags items={e.projectTypes} /></td>
              <td className="px-3 py-3"><Tags items={e.aiTools} /></td>
              <td className="px-3 py-3"><Tags items={e.backendStacks} /></td>
              <td className="px-3 py-3"><Tags items={e.frontendStacks} /></td>
              <td className="px-3 py-3 text-right">
                <button type="button" onClick={() => onEdit(e)} title="Edit" aria-label="Edit"
                  className="inline-flex size-7 items-center justify-center rounded-md border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                  <Pencil size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── F2: super-admin edits expertise axes + on/off-duty ─────────────────────
function EditDrawer({ engineer, onClose, onSaved }: { engineer: Engineer; onClose: () => void; onSaved: () => void }) {
  const [projectTypes, setProjectTypes] = useState(engineer.projectTypes.join(", "));
  const [aiTools, setAiTools] = useState(engineer.aiTools.join(", "));
  const [backendStacks, setBackendStacks] = useState(engineer.backendStacks.join(", "));
  const [frontendStacks, setFrontendStacks] = useState(engineer.frontendStacks.join(", "));
  const [level, setLevel] = useState(engineer.experienceLevel ?? "");
  const [available, setAvailable] = useState(engineer.isAvailable);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialogRef = useOverlayDismiss<HTMLDivElement>(onClose);

  const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/engineers/${engineer.userId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_types: csv(projectTypes), ai_tools: csv(aiTools), backend_stacks: csv(backendStacks), frontend_stacks: csv(frontendStacks), experienceLevel: level.trim() || null, isAvailable: available }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Save failed.");
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-[var(--z-modal)]" style={{ backgroundColor: "var(--scrim)" }} onClick={() => !busy && onClose()} />
      <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed right-0 top-0 z-[var(--z-modal)] flex h-full w-full max-w-md flex-col gap-3 overflow-y-auto border-l p-5 shadow-2xl"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Edit {engineer.name}</h2>
          <button type="button" onClick={() => !busy && onClose()} className="ml-auto" style={{ color: "var(--text-muted)" }}><X size={16} /></button>
        </div>
        <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
          On duty (matcher rings them)
          <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
        </label>
        {([["Project types", projectTypes, setProjectTypes], ["AI tools", aiTools, setAiTools], ["Backend stacks", backendStacks, setBackendStacks], ["Frontend stacks", frontendStacks, setFrontendStacks]] as const).map(([label, val, set]) => (
          <label key={label} className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            {label} <span style={{ color: "var(--text-faint)" }}>(comma-separated)</span>
            <input value={val} onChange={(e) => set(e.target.value)} className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
          Experience level
          <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="senior" className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
        </label>
        {err && <p className="text-[12px]" style={{ color: "var(--risk)" }}>{err}</p>}
        <div className="mt-auto flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => !busy && onClose()} disabled={busy} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </>
  );
}

// ── B4: bulk pod-holiday — set + review + edit + delete ────────────────────
type PodHoliday = { holiday_date: string; label: string | null; kind: string; engineer_count: number };

function PodHolidayModal({ pods, onClose, onDone }: { pods: Pod[]; onClose: () => void; onDone: () => void }) {
  const [podId, setPodId] = useState(pods[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [editingDate, setEditingDate] = useState<string | null>(null); // the holiday being edited (its original date)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<PodHoliday[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [touched, setTouched] = useState(false); // whether we changed anything (drives parent refresh on close)
  const dialogRef = useOverlayDismiss<HTMLDivElement>(() => { if (touched) onDone(); else onClose(); });
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // When an edit starts, bring the form (top of the scroll area) into view and
  // focus the date field — otherwise clicking a row's pencil silently fills a
  // form that may be scrolled out of view, and looks like nothing happened.
  useEffect(() => {
    if (!editingDate) return;
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    dateRef.current?.focus();
  }, [editingDate]);

  // Load the selected pod's declared holidays whenever the pod changes.
  const loadList = useCallback(async (pid: string) => {
    if (!pid) { setHolidays([]); return; }
    setListLoading(true);
    try {
      const { data, error } = await createClient().rpc("pod_list_holidays", { _pod_id: pid });
      if (error) throw new Error(error.message);
      setHolidays(Array.isArray(data) ? (data as PodHoliday[]) : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load pod holidays.");
    } finally {
      setListLoading(false);
    }
  }, []);
  useEffect(() => { void loadList(podId); }, [podId, loadList]);

  // Local "today" as YYYY-MM-DD — used to block past dates in the picker + guard.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const resetForm = () => { setDate(""); setLabel(""); setEditingDate(null); };

  const submit = async () => {
    if (!podId || !date) { setErr("Pick a pod and a date."); return; }
    // Block past dates. Allow a same-date label/kind edit of an already-passed
    // holiday (date unchanged); only reject creating or moving onto a past date.
    const movingToNewDate = !editingDate || date !== editingDate;
    if (movingToNewDate && date < todayStr) {
      setErr("Holidays can only be set for today or a future date.");
      return;
    }
    setBusy(true); setErr(null); setNotice(null);
    try {
      const sb = createClient();
      if (editingDate) {
        const { data, error } = await sb.rpc("pod_edit_holiday", {
          _pod_id: podId, _old_date: editingDate, _new_date: date,
          _label: label.trim() || null, _kind: "holiday",
        });
        if (error) throw new Error(error.message);
        setNotice(`Updated — ${typeof data === "number" ? data : 0} engineer${data === 1 ? "" : "s"} affected.`);
      } else {
        const { data, error } = await sb.rpc("pod_set_holiday", {
          _pod_id: podId, _date: date, _label: label.trim() || null, _kind: "holiday",
        });
        if (error) throw new Error(error.message);
        setNotice(`Blocked the date for ${typeof data === "number" ? data : 0} engineer${data === 1 ? "" : "s"}.`);
      }
      setTouched(true);
      resetForm();
      await loadList(podId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't save the holiday.";
      setErr(/DATE_IN_PAST/.test(msg) ? "Holidays can only be set for today or a future date." : msg);
    }
    finally { setBusy(false); }
  };

  const startEdit = (h: PodHoliday) => {
    setEditingDate(h.holiday_date);
    setDate(h.holiday_date);
    setLabel(h.label ?? "");
    setErr(null); setNotice(null);
  };

  const remove = async (h: PodHoliday) => {
    if (!window.confirm(`Remove the pod holiday on ${fmtDate(h.holiday_date)}? This unblocks the date for the pod.`)) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const { data, error } = await createClient().rpc("pod_remove_holiday", { _pod_id: podId, _date: h.holiday_date });
      if (error) throw new Error(error.message);
      setNotice(`Removed — unblocked ${typeof data === "number" ? data : 0} engineer${data === 1 ? "" : "s"}.`);
      setTouched(true);
      if (editingDate === h.holiday_date) resetForm();
      await loadList(podId);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't remove the holiday."); }
    finally { setBusy(false); }
  };

  const close = () => { if (busy) return; if (touched) onDone(); else onClose(); };

  return (
    <>
      <div className="fixed inset-0 z-[var(--z-modal)]" style={{ backgroundColor: "var(--scrim)" }} onClick={close} />
      <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed left-1/2 top-1/2 z-[var(--z-modal)] flex max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <div className="mb-3 flex items-center gap-2">
          <CalendarOff size={16} style={{ color: "var(--primary-hover)" }} />
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Pod holidays</h2>
          <button type="button" onClick={close} className="ml-auto" style={{ color: "var(--text-muted)" }}><X size={16} /></button>
        </div>

        <div ref={scrollRef} className="flex flex-col gap-3 overflow-y-auto">
          {/* Edit-mode banner so it's unmistakable which holiday is being changed. */}
          {editingDate && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]"
              style={{ borderColor: "var(--primary)", background: "var(--primary-tint)", color: "var(--primary-hover)" }}>
              <Pencil size={13} /> Editing {fmtDate(editingDate)} — change the date or label, then <strong>Save changes</strong>.
            </div>
          )}
          {/* Set / edit form */}
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Pod
            <select value={podId} disabled={!!editingDate} onChange={(e) => { setPodId(e.target.value); resetForm(); }} className="h-10 rounded-lg border px-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}>
              {pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Date
            <input ref={dateRef} type="date" min={todayStr} value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Label (optional)
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Public holiday" className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          {err && <p className="text-[12px]" style={{ color: "var(--risk)" }}>{err}</p>}
          {notice && <p className="text-[12px]" style={{ color: "var(--ok)" }}>{notice}</p>}
          <div className="flex justify-end gap-2">
            {editingDate && (
              <button type="button" onClick={resetForm} disabled={busy} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>Cancel edit</button>
            )}
            <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null} {editingDate ? "Save changes" : "Block date"}
            </button>
          </div>

          {/* Declared holidays — review + edit + delete */}
          <div className="mt-1 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Declared holidays
            </div>
            {listLoading ? (
              <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>
            ) : holidays.length === 0 ? (
              <p className="py-3 text-center text-[12px]" style={{ color: "var(--text-faint)" }}>No holidays declared for this pod yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {holidays.map((h) => (
                  <li key={`${h.holiday_date}-${h.label ?? ""}`} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                    style={{ borderColor: editingDate === h.holiday_date ? "var(--primary)" : "var(--border)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]" style={{ color: "var(--text)" }}>{fmtDate(h.holiday_date)}</div>
                      <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {h.label || "—"} · {h.engineer_count} engineer{h.engineer_count === 1 ? "" : "s"} blocked
                      </div>
                    </div>
                    <button type="button" onClick={() => startEdit(h)} disabled={busy} title="Edit" aria-label="Edit holiday"
                      className="inline-flex size-7 items-center justify-center rounded-md border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" onClick={() => void remove(h)} disabled={busy} title="Remove" aria-label="Remove holiday"
                      className="inline-flex size-7 items-center justify-center rounded-md border" style={{ borderColor: "var(--border)", color: "var(--risk)" }}>
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function fmtDate(iso: string): string {
  // iso is a plain date string (YYYY-MM-DD); render without TZ drift.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
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

// ── H2: escalations that fell through to ops ───────────────────────────────
type OpsEsc = { id: string; sessionId: string; engineer: string; customer: string; reason: string; createdAt: string; opsEscalatedAt: string };

function OpsBanner() {
  const router = useRouter();
  const [rows, setRows] = useState<OpsEsc[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/ops-escalations", { cache: "no-store" });
        if (res.ok && alive) setRows(((await res.json()) as { escalations: OpsEsc[] }).escalations ?? []);
      } catch { /* ignore */ }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--risk)", background: "color-mix(in srgb, var(--risk) 8%, transparent)" }}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--risk)" }}>
        <Siren size={15} /> {rows.length} escalation{rows.length === 1 ? "" : "s"} fell through to ops — no supervisor picked up
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>
              <span className="font-medium">{e.engineer}</span> · {e.reason} <span style={{ color: "var(--text-muted)" }}>(on {e.customer})</span>
            </span>
            <button type="button" onClick={() => router.push(`/staff/session/${e.sessionId}`)}
              className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Watch</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 6c: availability/leave relay inbox (super-admin) ───────────────────────
type Req = { id: string; engineer: string; raisedBy: string; pod: string | null; kind: string; detail: string | null; createdAt: string };

function RequestsInbox() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/availability-requests", { cache: "no-store" });
      if (res.ok) setRows(((await res.json()) as { requests: Req[] }).requests ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const resolve = async (id: string, status: "approved" | "rejected" | "actioned") => {
    setActing(id);
    const note = status === "rejected" ? (window.prompt("Reason (optional):") ?? "") : "";
    try { await createClient().rpc("resolve_availability_request", { _id: id, _status: status, _note: note }); await load(); }
    finally { setActing(null); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>;
  if (rows.length === 0) return (
    <div className="flex items-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
      <Inbox size={16} /> No open availability or leave requests.
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "var(--primary-tint)", color: "var(--primary-hover)" }}>{r.kind}</span>
              <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{r.engineer}</span>
              {r.pod && <span className="text-xs" style={{ color: "var(--text-muted)" }}>· {r.pod}</span>}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>raised by {r.raisedBy} · {new Date(r.createdAt).toLocaleDateString()}</div>
            {r.detail && <p className="mt-1 text-[12px]" style={{ color: "var(--text-faint)" }}>{r.detail}</p>}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button type="button" disabled={acting === r.id} onClick={() => resolve(r.id, "approved")}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white" style={{ background: "var(--ok)" }}><Check size={12} /> Approve</button>
            <button type="button" disabled={acting === r.id} onClick={() => resolve(r.id, "actioned")}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Actioned</button>
            <button type="button" disabled={acting === r.id} onClick={() => resolve(r.id, "rejected")}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium" style={{ borderColor: "var(--border)", color: "var(--risk)" }}><Ban size={12} /> Reject</button>
          </div>
        </div>
      ))}
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
