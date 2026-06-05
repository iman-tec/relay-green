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
import {
  Loader2,
  Users,
  CheckCircle2,
  CircleDashed,
  Pencil,
  CalendarOff,
  X,
  Inbox,
  Check,
  Ban,
  Siren,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Calendar,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Engineer = {
  userId: string;
  name: string;
  email: string;
  nickname: string | null;
  pod: string;
  presenceState: string;
  isAvailable: boolean;
  projectTypes: string[];
  aiTools: string[];
  backendStacks: string[];
  frontendStacks: string[];
  experienceLevel: string | null;
  onboardingComplete: boolean;
  onboardingPct: number;
};
type Pod = { id: string; name: string };

const PRESENCE_DOT: Record<string, string> = {
  online: "var(--ok)",
  busy: "var(--warn)",
  offline: "var(--text-faint)",
};

export function BenchTab() {
  const [view, setView] = useState<"matrix" | "onboarding" | "requests">(
    "matrix"
  );
  const [rows, setRows] = useState<Engineer[]>([]);
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Engineer | null>(null);
  const [holidayOpen, setHolidayOpen] = useState(false);
  // Pending items across both inboxes — drives the red dot on the Requests tab.
  const [pendingRequests, setPendingRequests] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/engineers", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        engineers?: Engineer[];
        pods?: Pod[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Couldn't load the bench.");
      setRows(body.engineers ?? []);
      setPods(body.pods ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the bench.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Count pending leave requests + availability relay requests so the Requests
  // tab carries a dot while anything awaits the super-admin.
  const loadPending = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/admin/leave-requests", { cache: "no-store" }),
        fetch("/api/admin/availability-requests", { cache: "no-store" }),
      ]);
      let n = 0;
      if (a.ok)
        n += (((await a.json()) as { requests?: unknown[] }).requests ?? [])
          .length;
      if (b.ok)
        n += (((await b.json()) as { requests?: unknown[] }).requests ?? [])
          .length;
      setPendingRequests(n);
    } catch {
      /* ignore — dot just won't update this cycle */
    }
  }, []);
  useEffect(() => {
    void loadPending();
    const id = setInterval(() => void loadPending(), 20_000);
    return () => clearInterval(id);
  }, [loadPending]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1
            className="flex items-center gap-2 font-serif text-2xl font-medium"
            style={{ color: "var(--text)" }}
          >
            <Users size={20} /> Bench
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHolidayOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              <CalendarOff size={13} /> Set pod holiday
            </button>
            <div className="flex gap-1">
              {(["matrix", "onboarding", "requests"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className="relative rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors"
                  style={{
                    borderColor:
                      view === v ? "var(--primary)" : "var(--border)",
                    background:
                      view === v ? "var(--primary-tint)" : "transparent",
                    color:
                      view === v ? "var(--primary-hover)" : "var(--text-muted)",
                  }}
                >
                  {v === "matrix"
                    ? "Expertise matrix"
                    : v === "onboarding"
                      ? "Onboarding"
                      : "Requests"}
                  {v === "requests" && pendingRequests > 0 && (
                    <span
                      className="absolute -top-1 -right-1 size-2.5 rounded-full ring-2"
                      style={{
                        background: "var(--risk)",
                        boxShadow: "0 0 0 2px var(--background)",
                      }}
                      title={`${pendingRequests} pending request${pendingRequests === 1 ? "" : "s"}`}
                      aria-label={`${pendingRequests} pending requests`}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <OpsBanner />

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2
              size={20}
              className="animate-spin"
              style={{ color: "var(--text-muted)" }}
            />
          </div>
        ) : error ? (
          <p className="py-6 text-sm" style={{ color: "var(--risk)" }}>
            {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            No engineers found.
          </p>
        ) : view === "matrix" ? (
          <Matrix rows={rows} onEdit={setEditing} />
        ) : view === "onboarding" ? (
          <Onboarding rows={rows} />
        ) : (
          <div className="flex flex-col gap-6">
            <LeaveRequestsInbox onChanged={loadPending} />
            <RequestsInbox onChanged={loadPending} />
          </div>
        )}
      </div>

      {editing && (
        <EditDrawer
          engineer={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {holidayOpen && (
        <PodHolidayModal
          pods={pods}
          onClose={() => setHolidayOpen(false)}
          onDone={() => {
            setHolidayOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Matrix({
  rows,
  onEdit,
}: {
  rows: Engineer[];
  onEdit: (e: Engineer) => void;
}) {
  return (
    <div
      className="overflow-x-auto rounded-2xl border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            {[
              "Engineer",
              "Alias",
              "Pod",
              "Level",
              "Project types",
              "AI tools",
              "Backend",
              "Frontend",
              "",
            ].map((h, i) => (
              <th
                key={i}
                className="px-3 py-2.5 text-left text-[11px] font-medium tracking-wide whitespace-nowrap uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr
              key={e.userId}
              className="border-t align-top"
              style={{ borderColor: "var(--border)" }}
            >
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      background:
                        PRESENCE_DOT[e.presenceState] ?? "var(--text-faint)",
                    }}
                    title={e.isAvailable ? "On duty" : "Off duty"}
                  />
                  <div className="min-w-0">
                    <div className="truncate" style={{ color: "var(--text)" }}>
                      {e.name}
                    </div>
                    <div
                      className="truncate text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {e.email}
                    </div>
                  </div>
                </div>
              </td>
              <td
                className="px-3 py-3 whitespace-nowrap"
                style={{ color: "var(--text-muted)" }}
              >
                {e.nickname ?? "—"}
              </td>
              <td
                className="px-3 py-3 whitespace-nowrap"
                style={{ color: "var(--text-muted)" }}
              >
                {e.pod}
              </td>
              <td
                className="px-3 py-3 whitespace-nowrap"
                style={{ color: "var(--text-muted)" }}
              >
                {e.experienceLevel ?? "—"}
              </td>
              <td className="px-3 py-3">
                <Tags items={e.projectTypes} />
              </td>
              <td className="px-3 py-3">
                <Tags items={e.aiTools} />
              </td>
              <td className="px-3 py-3">
                <Tags items={e.backendStacks} />
              </td>
              <td className="px-3 py-3">
                <Tags items={e.frontendStacks} />
              </td>
              <td className="px-3 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(e)}
                  title="Edit"
                  aria-label="Edit"
                  className="inline-flex size-7 items-center justify-center rounded-md border"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-muted)",
                  }}
                >
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
function EditDrawer({
  engineer,
  onClose,
  onSaved,
}: {
  engineer: Engineer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectTypes, setProjectTypes] = useState(
    engineer.projectTypes.join(", ")
  );
  const [aiTools, setAiTools] = useState(engineer.aiTools.join(", "));
  const [backendStacks, setBackendStacks] = useState(
    engineer.backendStacks.join(", ")
  );
  const [frontendStacks, setFrontendStacks] = useState(
    engineer.frontendStacks.join(", ")
  );
  const [level, setLevel] = useState(engineer.experienceLevel ?? "");
  const [available, setAvailable] = useState(engineer.isAvailable);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialogRef = useOverlayDismiss<HTMLDivElement>(onClose);

  const csv = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/engineers/${engineer.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_types: csv(projectTypes),
          ai_tools: csv(aiTools),
          backend_stacks: csv(backendStacks),
          frontend_stacks: csv(frontendStacks),
          experienceLevel: level.trim() || null,
          isAvailable: available,
        }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json().catch(() => ({}))) as { error?: string }).error ||
            "Save failed."
        );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal)]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={() => !busy && onClose()}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="fixed top-0 right-0 z-[var(--z-modal)] flex h-full w-full max-w-md flex-col gap-3 overflow-y-auto border-l p-5 shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div className="flex items-center gap-2">
          <h2
            className="text-[15px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            Edit {engineer.name}
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="ml-auto"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>
        <label
          className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          On duty (matcher rings them)
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
          />
        </label>
        {(
          [
            ["Project types", projectTypes, setProjectTypes],
            ["AI tools", aiTools, setAiTools],
            ["Backend stacks", backendStacks, setBackendStacks],
            ["Frontend stacks", frontendStacks, setFrontendStacks],
          ] as const
        ).map(([label, val, set]) => (
          <label
            key={label}
            className="flex flex-col gap-1 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            {label}{" "}
            <span style={{ color: "var(--text-faint)" }}>
              (comma-separated)
            </span>
            <input
              value={val}
              onChange={(e) => set(e.target.value)}
              className="h-10 rounded-lg border px-3 text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--background)",
                color: "var(--text)",
              }}
            />
          </label>
        ))}
        <label
          className="flex flex-col gap-1 text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          Experience level
          <input
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder="senior"
            className="h-10 rounded-lg border px-3 text-sm"
            style={{
              borderColor: "var(--border)",
              background: "var(--background)",
              color: "var(--text)",
            }}
          />
        </label>
        {err && (
          <p className="text-[12px]" style={{ color: "var(--risk)" }}>
            {err}
          </p>
        )}
        <div className="mt-auto flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="rounded-full px-3.5 py-1.5 text-[13px] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: "var(--primary)" }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </>
  );
}

// ── B4: bulk pod-holiday — set + review + edit + delete ────────────────────
// A holiday declared on the list carries its owning pod so the multi-pod
// review can render + target the right pod on edit/remove.
type PodHoliday = {
  holiday_date: string;
  label: string | null;
  kind: string;
  engineer_count: number;
  podId: string;
  podName: string;
};

function PodHolidayModal({
  pods,
  onClose,
  onDone,
}: {
  pods: Pod[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Multi-pod + multi-date selection for bulk "block a common public holiday".
  const [selectedPodIds, setSelectedPodIds] = useState<string[]>(
    pods[0] ? [pods[0].id] : []
  );
  const [selectedDates, setSelectedDates] = useState<string[]>([]); // YYYY-MM-DD, sorted
  const [label, setLabel] = useState("");
  // While editing an existing holiday we lock to its single pod + date and
  // route through pod_edit_holiday (which can move the date).
  const [editing, setEditing] = useState<{
    podId: string;
    date: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<PodHoliday[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [touched, setTouched] = useState(false); // whether we changed anything (drives parent refresh on close)
  const dialogRef = useOverlayDismiss<HTMLDivElement>(() => {
    if (touched) onDone();
    else onClose();
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const podName = useCallback(
    (id: string) => pods.find((p) => p.id === id)?.name ?? "Pod",
    [pods]
  );

  // Load declared holidays for every selected pod and merge, tagging each row
  // with its pod so the list + edit/remove know which pod they belong to.
  const loadList = useCallback(
    async (pids: string[]) => {
      if (pids.length === 0) {
        setHolidays([]);
        return;
      }
      setListLoading(true);
      try {
        const sb = createClient();
        const merged: PodHoliday[] = [];
        for (const pid of pids) {
          const { data, error } = await sb.rpc("pod_list_holidays", {
            _pod_id: pid,
          });
          if (error) throw new Error(error.message);
          const name = pods.find((p) => p.id === pid)?.name ?? "Pod";
          for (const h of (Array.isArray(data) ? data : []) as Omit<
            PodHoliday,
            "podId" | "podName"
          >[]) {
            merged.push({ ...h, podId: pid, podName: name });
          }
        }
        merged.sort(
          (a, b) =>
            a.holiday_date.localeCompare(b.holiday_date) ||
            a.podName.localeCompare(b.podName)
        );
        setHolidays(merged);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't load pod holidays.");
      } finally {
        setListLoading(false);
      }
    },
    [pods]
  );
  useEffect(() => {
    void loadList(selectedPodIds);
  }, [selectedPodIds, loadList]);

  // Local "today" as YYYY-MM-DD — used to block past dates in the picker + guard.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const resetForm = () => {
    setSelectedDates([]);
    setLabel("");
    setEditing(null);
  };

  const togglePod = (id: string) => {
    if (editing) return; // pods are locked while editing a single holiday
    setSelectedPodIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleDate = (d: string) => {
    if (d < todayStr) return;
    // Editing targets one date — a click just picks the (new) date.
    if (editing) {
      setSelectedDates([d]);
      return;
    }
    setSelectedDates((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const submit = async () => {
    setErr(null);
    setNotice(null);

    // ── Edit an existing holiday (single pod + single date) ──────────────────
    if (editing) {
      const newDate = selectedDates[0];
      if (!newDate) {
        setErr("Pick a date.");
        return;
      }
      setBusy(true);
      try {
        const { data, error } = await createClient().rpc("pod_edit_holiday", {
          _pod_id: editing.podId,
          _old_date: editing.date,
          _new_date: newDate,
          _label: label.trim() || null,
          _kind: "holiday",
        });
        if (error) throw new Error(error.message);
        setNotice(
          `Updated — ${typeof data === "number" ? data : 0} engineer${data === 1 ? "" : "s"} affected.`
        );
        setTouched(true);
        resetForm();
        await loadList(selectedPodIds);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Couldn't save the holiday.";
        setErr(
          /DATE_IN_PAST/.test(msg)
            ? "Holidays can only be set for today or a future date."
            : msg
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    // ── Bulk block: every selected date × every selected pod ─────────────────
    if (selectedPodIds.length === 0 || selectedDates.length === 0) {
      setErr("Pick at least one pod and one date.");
      return;
    }
    setBusy(true);
    try {
      const sb = createClient();
      let affected = 0;
      for (const pid of selectedPodIds) {
        for (const d of selectedDates) {
          const { data, error } = await sb.rpc("pod_set_holiday", {
            _pod_id: pid,
            _date: d,
            _label: label.trim() || null,
            _kind: "holiday",
          });
          if (error) throw new Error(error.message);
          affected += typeof data === "number" ? data : 0;
        }
      }
      const podWord = selectedPodIds.length === 1 ? "pod" : "pods";
      const dateWord = selectedDates.length === 1 ? "date" : "dates";
      setNotice(
        `Blocked ${selectedDates.length} ${dateWord} across ${selectedPodIds.length} ${podWord} — ${affected} engineer-day${affected === 1 ? "" : "s"} affected.`
      );
      setTouched(true);
      setSelectedDates([]);
      setLabel("");
      await loadList(selectedPodIds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't save the holiday.";
      setErr(
        /DATE_IN_PAST/.test(msg)
          ? "Holidays can only be set for today or a future date."
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (h: PodHoliday) => {
    setEditing({ podId: h.podId, date: h.holiday_date });
    setSelectedPodIds([h.podId]);
    setSelectedDates([h.holiday_date]);
    setLabel(h.label ?? "");
    setErr(null);
    setNotice(null);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (h: PodHoliday) => {
    if (
      !window.confirm(
        `Remove the ${h.podName} pod holiday on ${fmtDate(h.holiday_date)}? This unblocks the date for the pod.`
      )
    )
      return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const { data, error } = await createClient().rpc("pod_remove_holiday", {
        _pod_id: h.podId,
        _date: h.holiday_date,
      });
      if (error) throw new Error(error.message);
      setNotice(
        `Removed — unblocked ${typeof data === "number" ? data : 0} engineer${data === 1 ? "" : "s"}.`
      );
      setTouched(true);
      if (
        editing &&
        editing.podId === h.podId &&
        editing.date === h.holiday_date
      )
        resetForm();
      await loadList(selectedPodIds);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't remove the holiday.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    if (touched) onDone();
    else onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal)]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border p-5 shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <CalendarOff size={16} style={{ color: "var(--primary-hover)" }} />
          <h2
            className="text-[15px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            Pod holidays
          </h2>
          <button
            type="button"
            onClick={close}
            className="ml-auto"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div ref={scrollRef} className="flex flex-col gap-3 overflow-y-auto">
          {/* Edit-mode banner so it's unmistakable which holiday is being changed. */}
          {editing && (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]"
              style={{
                borderColor: "var(--primary)",
                background: "var(--primary-tint)",
                color: "var(--primary-hover)",
              }}
            >
              <Pencil size={13} /> Editing {podName(editing.podId)} ·{" "}
              {fmtDate(editing.date)} — pick the new date or change the label,
              then <strong>Save changes</strong>.
            </div>
          )}

          {/* Pods — multi-select dropdown (locked while editing a single holiday) */}
          <div
            className="flex flex-col gap-1.5 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            <span>
              Pods{" "}
              {editing && (
                <span style={{ color: "var(--text-faint)" }}>
                  (locked while editing)
                </span>
              )}
            </span>
            <PodDropdown
              pods={pods}
              selected={selectedPodIds}
              onToggle={togglePod}
              disabled={!!editing}
            />
          </div>

          {/* Dates — calendar-popover multi-select + removable capsules */}
          <div
            className="flex flex-col gap-1.5 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            <span>
              Dates{" "}
              {editing ? (
                <span style={{ color: "var(--text-faint)" }}>
                  (pick the new date)
                </span>
              ) : (
                <span style={{ color: "var(--text-faint)" }}>
                  (click days to select; click again to remove)
                </span>
              )}
            </span>
            <DateField
              selected={selectedDates}
              onToggle={toggleDate}
              todayStr={todayStr}
              single={!!editing}
            />
          </div>

          <label
            className="flex flex-col gap-1 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            Label (optional)
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Public holiday"
              className="h-10 rounded-lg border px-3 text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--background)",
                color: "var(--text)",
              }}
            />
          </label>
          {err && (
            <p className="text-[12px]" style={{ color: "var(--risk)" }}>
              {err}
            </p>
          )}
          {notice && (
            <p className="text-[12px]" style={{ color: "var(--ok)" }}>
              {notice}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {editing && (
              <button
                type="button"
                onClick={resetForm}
                disabled={busy}
                className="rounded-full px-3.5 py-1.5 text-[13px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                Cancel edit
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white"
              style={{ background: "var(--primary)" }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}{" "}
              {editing
                ? "Save changes"
                : selectedDates.length > 1
                  ? "Block dates"
                  : "Block date"}
            </button>
          </div>

          {/* Declared holidays — review + edit + delete (across selected pods) */}
          <div
            className="mt-1 border-t pt-3"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="mb-2 text-[11px] font-semibold tracking-wide uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Declared holidays
            </div>
            {selectedPodIds.length === 0 ? (
              <p
                className="py-3 text-center text-[12px]"
                style={{ color: "var(--text-faint)" }}
              >
                Select at least one pod above.
              </p>
            ) : listLoading ? (
              <div className="flex justify-center py-4">
                <Loader2
                  size={16}
                  className="animate-spin"
                  style={{ color: "var(--text-muted)" }}
                />
              </div>
            ) : holidays.length === 0 ? (
              <p
                className="py-3 text-center text-[12px]"
                style={{ color: "var(--text-faint)" }}
              >
                No holidays declared for the selected pod
                {selectedPodIds.length === 1 ? "" : "s"} yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {holidays.map((h) => {
                  const isEditingRow =
                    !!editing &&
                    editing.podId === h.podId &&
                    editing.date === h.holiday_date;
                  return (
                    <li
                      key={`${h.podId}-${h.holiday_date}-${h.label ?? ""}`}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2"
                      style={{
                        borderColor: isEditingRow
                          ? "var(--primary)"
                          : "var(--border)",
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              background: "var(--surface-raised)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {h.podName}
                          </span>
                          <span
                            className="text-[13px]"
                            style={{ color: "var(--text)" }}
                          >
                            {fmtDate(h.holiday_date)}
                          </span>
                        </div>
                        <div
                          className="truncate text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {h.label || "—"} · {h.engineer_count} engineer
                          {h.engineer_count === 1 ? "" : "s"} blocked
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEdit(h)}
                        disabled={busy}
                        title="Edit"
                        aria-label="Edit holiday"
                        className="inline-flex size-7 items-center justify-center rounded-md border"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-muted)",
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(h)}
                        disabled={busy}
                        title="Remove"
                        aria-label="Remove holiday"
                        className="inline-flex size-7 items-center justify-center rounded-md border"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--risk)",
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Multi-select pod picker styled like the original <select> box: a chevron
// trigger that shows the chosen pods, opening a checklist on click.
function PodDropdown({
  pods,
  selected,
  onToggle,
  disabled,
}: {
  pods: Pod[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const summary =
    selected.length === 0
      ? "Select pods"
      : selected.length === pods.length
        ? "All pods"
        : pods
            .filter((p) => selected.includes(p.id))
            .map((p) => p.name)
            .join(", ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-sm disabled:opacity-60"
        style={{
          borderColor: "var(--border)",
          background: "var(--background)",
          color: selected.length ? "var(--text)" : "var(--text-faint)",
        }}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          size={16}
          style={{ color: "var(--text-muted)" }}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && !disabled && (
        <div
          className="absolute right-0 left-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border p-1 shadow-lg"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          {pods.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onToggle(p.id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors"
                style={{
                  background: on ? "var(--primary-tint)" : "transparent",
                  color: on ? "var(--primary-hover)" : "var(--text)",
                }}
              >
                <span
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded border"
                  style={{
                    borderColor: on ? "var(--primary)" : "var(--border)",
                    background: on ? "var(--primary)" : "transparent",
                    color: "#fff",
                  }}
                >
                  {on && <Check size={11} />}
                </span>
                {p.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Date field styled like the original <input type="date"> box: a calendar
// icon trigger that pops the month grid. Picked dates show as removable
// capsules below. In `single` (edit) mode a pick replaces + closes.
function DateField({
  selected,
  onToggle,
  todayStr,
  single,
}: {
  selected: string[];
  onToggle: (d: string) => void;
  todayStr: string;
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const summary =
    selected.length === 0
      ? "dd-mm-yyyy"
      : selected.length === 1
        ? fmtDate(selected[0])
        : `${selected.length} dates selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-sm"
        style={{
          borderColor: "var(--border)",
          background: "var(--background)",
          color: selected.length ? "var(--text)" : "var(--text-faint)",
        }}
      >
        <span className="truncate">{summary}</span>
        <Calendar
          size={15}
          style={{ color: "var(--text-muted)" }}
          className="shrink-0"
        />
      </button>
      {/* Inline (not absolute) so the modal's scroll container can't clip it —
          opening the calendar expands the form and pushes the rest down. */}
      {open && (
        <div
          className="mt-1.5 rounded-lg border p-2"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-raised, var(--background))",
          }}
        >
          <HolidayCalendar
            selected={selected}
            onToggle={(d) => {
              onToggle(d);
              if (single) setOpen(false);
            }}
            todayStr={todayStr}
          />
        </div>
      )}
      {selected.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {selected.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 rounded-full border py-1 pr-1.5 pl-2.5 text-[11px]"
              style={{
                borderColor: "var(--primary)",
                background: "var(--primary-tint)",
                color: "var(--primary-hover)",
              }}
            >
              {fmtDate(d)}
              <button
                type="button"
                onClick={() => onToggle(d)}
                aria-label={`Remove ${fmtDate(d)}`}
                className="inline-flex items-center"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline month calendar for multi-date selection. A day toggles in/out of
// `selected`; past days (< todayStr) are disabled. No external dep — the
// native <input type="date"> can't do multi-select.
const CAL_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const CAL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function HolidayCalendar({
  selected,
  onToggle,
  todayStr,
}: {
  selected: string[];
  onToggle: (d: string) => void;
  todayStr: string;
}) {
  const init = new Date();
  const [view, setView] = useState<{ y: number; m: number }>({
    y: init.getFullYear(),
    m: init.getMonth(),
  });

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    );
  }

  const prevMonth = () =>
    setView((v) =>
      v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }
    );
  const nextMonth = () =>
    setView((v) =>
      v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }
    );
  // Don't let the user page back before the current month — every day there is
  // already in the past and unselectable.
  const atCurrentMonth =
    view.y === init.getFullYear() && view.m === init.getMonth();

  return (
    <div
      className="rounded-lg border p-2"
      style={{ borderColor: "var(--border)", background: "var(--background)" }}
    >
      <div className="mb-1.5 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={prevMonth}
          disabled={atCurrentMonth}
          aria-label="Previous month"
          className="inline-flex size-6 items-center justify-center rounded-md disabled:opacity-30"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronLeft size={15} />
        </button>
        <span
          className="text-[12px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {CAL_MONTHS[view.m]} {view.y}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="inline-flex size-6 items-center justify-center rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {CAL_WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-[10px] font-medium"
            style={{ color: "var(--text-faint)" }}
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const day = Number(d.slice(-2));
          const isPast = d < todayStr;
          const isToday = d === todayStr;
          const on = selected.includes(d);
          return (
            <button
              key={d}
              type="button"
              disabled={isPast}
              onClick={() => onToggle(d)}
              aria-pressed={on}
              className="flex h-8 items-center justify-center rounded-md text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              style={{
                background: on ? "var(--primary)" : "transparent",
                color: on ? "#fff" : "var(--text)",
                border:
                  isToday && !on
                    ? "1px solid var(--primary)"
                    : "1px solid transparent",
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  // iso is a plain date string (YYYY-MM-DD); render without TZ drift.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Onboarding({ rows }: { rows: Engineer[] }) {
  const incomplete = rows.filter((e) => !e.onboardingComplete);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {rows.length - incomplete.length} of {rows.length} engineers fully
        onboarded · {incomplete.length} need a nudge
      </p>
      <div
        className="overflow-hidden rounded-2xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        {rows.map((e) => (
          <div
            key={e.userId}
            className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
            style={{ borderColor: "var(--border)" }}
          >
            {e.onboardingComplete ? (
              <CheckCircle2 size={16} style={{ color: "var(--ok)" }} />
            ) : (
              <CircleDashed size={16} style={{ color: "var(--warn)" }} />
            )}
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-sm"
                style={{ color: "var(--text)" }}
              >
                {e.name}
              </div>
              <div
                className="truncate text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {e.pod} · {e.email}
              </div>
            </div>
            <div className="flex w-40 items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: "var(--surface-raised)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${e.onboardingPct}%`,
                    background: e.onboardingComplete
                      ? "var(--ok)"
                      : "var(--warn)",
                  }}
                />
              </div>
              <span
                className="w-9 text-right text-xs tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                {e.onboardingPct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── H2: escalations that fell through to ops ───────────────────────────────
type OpsEsc = {
  id: string;
  sessionId: string;
  engineer: string;
  customer: string;
  reason: string;
  createdAt: string;
  opsEscalatedAt: string;
};

function OpsBanner() {
  const router = useRouter();
  const [rows, setRows] = useState<OpsEsc[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/ops-escalations", {
          cache: "no-store",
        });
        if (res.ok && alive)
          setRows(
            ((await res.json()) as { escalations: OpsEsc[] }).escalations ?? []
          );
      } catch {
        /* ignore */
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (rows.length === 0) return null;
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: "var(--risk)",
        background: "color-mix(in srgb, var(--risk) 8%, transparent)",
      }}
    >
      <div
        className="mb-2 flex items-center gap-2 text-sm font-semibold"
        style={{ color: "var(--risk)" }}
      >
        <Siren size={15} /> {rows.length} escalation
        {rows.length === 1 ? "" : "s"} fell through to ops — no supervisor
        picked up
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-xs">
            <span
              className="min-w-0 flex-1 truncate"
              style={{ color: "var(--text)" }}
            >
              <span className="font-medium">{e.engineer}</span> · {e.reason}{" "}
              <span style={{ color: "var(--text-muted)" }}>
                (on {e.customer})
              </span>
            </span>
            <button
              type="button"
              onClick={() => router.push(`/staff/session/${e.sessionId}`)}
              className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Watch
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Self-submitted leave requests (super-admin approves / rejects) ─────────
type LeaveReq = {
  id: string;
  requester: string;
  role: string;
  pod: string | null;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  kind: string;
  createdAt: string;
};

function LeaveRequestsInbox({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<LeaveReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/leave-requests", {
        cache: "no-store",
      });
      if (res.ok)
        setRows(
          ((await res.json()) as { requests: LeaveReq[] }).requests ?? []
        );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, approve: boolean, reason?: string) => {
    // Rejection always needs a reason (shown to the requester).
    if (!approve && !(reason ?? "").trim()) return;
    setActing(id);
    try {
      const { error } = await createClient().rpc("decide_leave_request", {
        _id: id,
        _approve: approve,
        _reason: reason ?? null,
      });
      if (error) throw new Error(error.message);
      setRejectingId(null);
      setRejectReason("");
      await load();
      onChanged?.();
    } catch (e) {
      if (typeof window !== "undefined")
        window.alert(
          e instanceof Error ? e.message : "Couldn't update the request."
        );
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3
        className="text-[13px] font-semibold"
        style={{ color: "var(--text)" }}
      >
        Leave requests
      </h3>
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2
            size={18}
            className="animate-spin"
            style={{ color: "var(--text-muted)" }}
          />
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex items-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <Inbox size={16} /> No pending leave requests.
        </div>
      ) : (
        rows.map((r) => (
          <div
            key={r.id}
            className="flex flex-col gap-2 rounded-2xl border p-4"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface)",
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-sm font-medium"
                style={{ color: "var(--text)" }}
              >
                {r.requester}
              </span>
              <span
                className="text-xs capitalize"
                style={{ color: "var(--text-muted)" }}
              >
                · {r.role}
                {r.pod ? ` · ${r.pod}` : ""}
              </span>
            </div>
            <div className="text-[12px]" style={{ color: "var(--text)" }}>
              {fmtDate(r.startDate)} → {fmtDate(r.endDate)}{" "}
              <span style={{ color: "var(--text-muted)" }}>
                · {r.totalDays} day{r.totalDays === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-[13px]" style={{ color: "var(--text)" }}>
              <span
                className="font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                Reason:{" "}
              </span>
              {r.reason}
            </p>
            {rejectingId === r.id ? (
              <div
                className="flex flex-col gap-1.5 rounded-lg border p-2"
                style={{ borderColor: "var(--risk)" }}
              >
                <input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason for rejection (required — shown to the requester)"
                  className="h-9 rounded-md border px-2 text-[12px] outline-none"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--background)",
                    color: "var(--text)",
                  }}
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={acting === r.id}
                    onClick={() => {
                      setRejectingId(null);
                      setRejectReason("");
                    }}
                    className="rounded-md px-2.5 py-1.5 text-[11px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={acting === r.id || !rejectReason.trim()}
                    onClick={() => void decide(r.id, false, rejectReason)}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--risk)" }}
                  >
                    <Ban size={12} /> Confirm reject
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={acting === r.id}
                  onClick={() => void decide(r.id, true)}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white"
                  style={{ background: "var(--ok)" }}
                >
                  <Check size={12} /> Approve
                </button>
                <button
                  type="button"
                  disabled={acting === r.id}
                  onClick={() => {
                    setRejectingId(r.id);
                    setRejectReason("");
                  }}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--risk)" }}
                >
                  <Ban size={12} /> Reject
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── 6c: availability/leave relay inbox (super-admin) ───────────────────────
type Req = {
  id: string;
  engineer: string;
  raisedBy: string;
  pod: string | null;
  kind: string;
  detail: string | null;
  createdAt: string;
};

function RequestsInbox({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/availability-requests", {
        cache: "no-store",
      });
      if (res.ok)
        setRows(((await res.json()) as { requests: Req[] }).requests ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (
    id: string,
    status: "approved" | "rejected" | "actioned"
  ) => {
    setActing(id);
    const note =
      status === "rejected" ? (window.prompt("Reason (optional):") ?? "") : "";
    try {
      await createClient().rpc("resolve_availability_request", {
        _id: id,
        _status: status,
        _note: note,
      });
      await load();
      onChanged?.();
    } finally {
      setActing(null);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Loader2
          size={18}
          className="animate-spin"
          style={{ color: "var(--text-muted)" }}
        />
      </div>
    );
  if (rows.length === 0)
    return (
      <div
        className="flex items-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-sm"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        <Inbox size={16} /> No open availability or leave requests.
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                style={{
                  background: "var(--primary-tint)",
                  color: "var(--primary-hover)",
                }}
              >
                {r.kind}
              </span>
              <span
                className="truncate text-sm font-medium"
                style={{ color: "var(--text)" }}
              >
                {r.engineer}
              </span>
              {r.pod && (
                <span
                  className="text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  · {r.pod}
                </span>
              )}
            </div>
            <div
              className="mt-0.5 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              raised by {r.raisedBy} ·{" "}
              {new Date(r.createdAt).toLocaleDateString()}
            </div>
            {r.detail && (
              <p
                className="mt-1 text-[12px]"
                style={{ color: "var(--text-faint)" }}
              >
                {r.detail}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              disabled={acting === r.id}
              onClick={() => resolve(r.id, "approved")}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-white"
              style={{ background: "var(--ok)" }}
            >
              <Check size={12} /> Approve
            </button>
            <button
              type="button"
              disabled={acting === r.id}
              onClick={() => resolve(r.id, "actioned")}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Actioned
            </button>
            <button
              type="button"
              disabled={acting === r.id}
              onClick={() => resolve(r.id, "rejected")}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--risk)" }}
            >
              <Ban size={12} /> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Tags({ items }: { items: string[] }) {
  if (!items || items.length === 0)
    return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span
          key={i}
          className="rounded-full border px-2 py-0.5 text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}
