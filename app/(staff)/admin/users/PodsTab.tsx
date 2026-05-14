"use client";

/*
 * Pods tab — super_admin-only UI for managing the supervisor/engineer
 * hierarchy. Two-pane: left list of pods, right detail of the selected pod.
 *
 * Constraints enforced by the DB:
 *   - One user belongs to AT MOST one pod (UNIQUE(user_id) on pod_members)
 *   - pod_role ∈ ('supervisor', 'engineer')
 *
 * All writes go through /api/admin/pods/* routes that gate with
 * requireSuperAdmin, so the UI itself trusts the role check at the page
 * level (admin/users/page.tsx already redirects non-super_admin).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X, Archive, Edit2, Check, Save, Undo2, RotateCcw, Search } from "lucide-react";

const BRAND_GREEN       = "#3f5c2e";
const BRAND_GREEN_SOFT  = "rgba(63, 92, 46, 0.10)";
// Neutral monogram tint — paired with text-muted so role accents don't
// shout. Supervisor + engineer use the same calm chip; the section header
// already disambiguates the role, so the avatar doesn't need to.
const NEUTRAL_CHIP_BG   = "color-mix(in srgb, var(--text-muted) 14%, transparent)";
const NEUTRAL_CHIP_FG   = "var(--text-muted)";

type Member = {
  id: string;
  userId: string;
  podRole: "supervisor" | "engineer";
  email: string;
  displayName: string;
  addedAt: string;
};

type Pod = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  supervisors: Member[];
  engineers: Member[];
};

type EligibleUser = {
  id: string;
  email: string;
  displayName: string;
};

type PodRole = "supervisor" | "engineer";

export function PodsTab() {
  const [pods, setPods]         = useState<Pod[]>([]);
  const [selectedId, setSel]    = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pods", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load pods.");
      setPods(body.pods as Pod[]);
      // Auto-select first pod if nothing selected
      setSel((curr) => curr ?? (body.pods?.[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load pods.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const selected = pods.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-[300px_1fr] gap-4">
      <PodList
        pods={pods}
        selectedId={selectedId}
        onSelect={setSel}
        onCreated={async () => { await refresh(); }}
        loading={loading}
        error={error}
      />
      <div>
        {!selected ? (
          <EmptyDetail />
        ) : (
          <PodDetail
            pod={selected}
            onMutated={refresh}
          />
        )}
      </div>
    </div>
  );
}

/* ──────── Left pane: pod list + create ──────── */

function PodList({
  pods, selectedId, onSelect, onCreated, loading, error,
}: {
  pods: Pod[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreated: () => Promise<void>;
  loading: boolean;
  error: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filteredPods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pods;
    return pods.filter((p) => p.name.toLowerCase().includes(q));
  }, [pods, query]);

  const submitCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    setCreateErr(null);
    try {
      const res = await fetch("/api/admin/pods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Create failed.");
      setNewName("");
      setCreating(false);
      await onCreated();
      if (body.pod?.id) onSelect(body.pod.id);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Pods ({pods.length})
        </h3>
        <button
          onClick={() => { setCreating(true); setNewName(""); setCreateErr(null); }}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Plus size={11} />
          New
        </button>
      </div>

      {creating && (
        <div
          className="border-b p-3"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
          }}
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              else if (e.key === "Escape") { setCreating(false); setCreateErr(null); }
            }}
            placeholder="Pod name (e.g. Pod Alpha)"
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
            }}
          />
          {createErr && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--accent-red)" }}>{createErr}</p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => { setCreating(false); setCreateErr(null); }}
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Cancel
            </button>
            <button
              onClick={() => void submitCreate()}
              disabled={busy || !newName.trim()}
              className="rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="px-4 py-3 text-xs" style={{ color: "var(--accent-red)" }}>{error}</p>
      )}

      {!loading && pods.length > 0 && (
        <div
          className="relative border-b px-3 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          <Search
            size={12}
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            placeholder="Search pods…"
            className="w-full rounded-md border py-1.5 pl-7 pr-7 text-xs outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-5 top-1/2 -translate-y-1/2 rounded-md p-0.5"
              style={{ color: "var(--text-muted)" }}
              title="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={16} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : pods.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No pods yet. Create your first pod to start organizing supervisors and engineers.
        </p>
      ) : filteredPods.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No pods match “{query}”.
        </p>
      ) : (
        <div className="max-h-[600px] overflow-y-auto">
          {filteredPods.map((p) => {
            const active = p.id === selectedId;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className="relative block w-full border-b px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: active ? "color-mix(in srgb, var(--text) 4%, transparent)" : "transparent",
                }}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-2 left-0 w-[2px] rounded-r-sm"
                    style={{ backgroundColor: BRAND_GREEN }}
                  />
                )}
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{p.name}</div>
                <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {p.supervisors.length} supervisor{p.supervisors.length === 1 ? "" : "s"} · {p.engineers.length} engineer{p.engineers.length === 1 ? "" : "s"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function EmptyDetail() {
  return (
    <div
      className="flex h-[400px] items-center justify-center rounded-xl border"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Select a pod on the left, or create a new one.
      </p>
    </div>
  );
}

/* ──────── Right pane: pod detail ──────── */

// Pending member-mutation shape. Adds + removes stage locally and apply
// together when the supervisor clicks Save. Rename + archive stay
// immediate — they're their own discrete confirm gestures.
type PendingAdd = {
  kind: "add";
  tempId: string;                 // local-only id for keying
  userId: string;
  podRole: PodRole;
  displayName: string;
  email: string;
};
type PendingRemove = {
  kind: "remove";
  memberId: string;               // pod_members row id
  userId: string;
  podRole: PodRole;
};
type PendingChange = PendingAdd | PendingRemove;

function PodDetail({
  pod, onMutated,
}: {
  pod: Pod;
  onMutated: () => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(pod.name);
  const [busy, setBusy] = useState(false);
  const [bannerErr, setBannerErr] = useState<string | null>(null);

  // Staged member changes. Cleared on Save success or on Discard.
  const [pending, setPending] = useState<PendingChange[]>([]);

  // Reset rename draft + staged changes whenever the selected pod changes.
  useEffect(() => {
    setNameDraft(pod.name);
    setRenaming(false);
    setPending([]);
    setBannerErr(null);
  }, [pod.id, pod.name]);

  // ── Pending mutation helpers (memoized so MemberSection deps stay stable) ──
  const stageAdd = (podRole: PodRole, user: EligibleUser) => {
    setPending((p) => [
      ...p,
      {
        kind: "add",
        tempId: `tmp-${user.id}-${Date.now()}`,
        userId: user.id,
        podRole,
        displayName: user.displayName,
        email: user.email,
      },
    ]);
  };

  const stageRemove = (member: Member) => {
    setPending((p) => {
      // If this row is a pending-add, clicking X just unstages it.
      const isPendingAdd = p.some(
        (c) => c.kind === "add" && c.userId === member.userId,
      );
      if (isPendingAdd) {
        return p.filter((c) => !(c.kind === "add" && c.userId === member.userId));
      }
      // Already staged for removal? toggle off.
      const isPendingRemove = p.some(
        (c) => c.kind === "remove" && c.memberId === member.id,
      );
      if (isPendingRemove) {
        return p.filter((c) => !(c.kind === "remove" && c.memberId === member.id));
      }
      return [...p, {
        kind: "remove",
        memberId: member.id,
        userId: member.userId,
        podRole: member.podRole,
      }];
    });
  };

  const discardPending = () => setPending([]);

  const commitPending = async () => {
    if (pending.length === 0) return;
    setBusy(true);
    setBannerErr(null);
    // Apply removes first so a user that's being moved between roles
    // (remove engineer, add as supervisor) doesn't hit the
    // UNIQUE(user_id) constraint mid-batch.
    const removes = pending.filter((c): c is PendingRemove => c.kind === "remove");
    const adds    = pending.filter((c): c is PendingAdd    => c.kind === "add");
    try {
      for (const r of removes) {
        const res = await fetch(`/api/admin/pods/${pod.id}/members/${r.userId}`, {
          method: "DELETE",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Couldn't remove member.");
      }
      for (const a of adds) {
        const res = await fetch(`/api/admin/pods/${pod.id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: a.userId, podRole: a.podRole }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Couldn't add member.");
      }
      setPending([]);
      await onMutated();
    } catch (e) {
      setBannerErr(e instanceof Error ? e.message : "Save failed.");
      // Keep pending list intact so the supervisor can edit + retry.
    } finally {
      setBusy(false);
    }
  };

  // Compute the displayed lists (members + pending overlay) per role.
  const supervisorsView = useMemo(
    () => mergeForDisplay(pod.supervisors, pending, "supervisor"),
    [pod.supervisors, pending],
  );
  const engineersView = useMemo(
    () => mergeForDisplay(pod.engineers, pending, "engineer"),
    [pod.engineers, pending],
  );

  // Set of user_ids already touched by this pod (real members + pending adds).
  // Used to filter the eligible-users picker so we don't show duplicates.
  const reservedUserIds = useMemo(() => {
    const ids = new Set<string>();
    pod.supervisors.forEach((m) => ids.add(m.userId));
    pod.engineers.forEach((m) => ids.add(m.userId));
    pending.forEach((c) => { if (c.kind === "add") ids.add(c.userId); });
    return ids;
  }, [pod.supervisors, pod.engineers, pending]);

  const submitRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === pod.name) { setRenaming(false); return; }
    setBusy(true); setBannerErr(null);
    try {
      const res = await fetch(`/api/admin/pods/${pod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Rename failed.");
      setRenaming(false);
      await onMutated();
    } catch (e) {
      setBannerErr(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!confirm(`Archive "${pod.name}"? Members will be unassigned and the pod removed from this list.`)) return;
    setBusy(true); setBannerErr(null);
    try {
      const res = await fetch(`/api/admin/pods/${pod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Archive failed.");
      await onMutated();
    } catch (e) {
      setBannerErr(e instanceof Error ? e.message : "Archive failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {renaming ? (
            <>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")       void submitRename();
                  else if (e.key === "Escape") { setRenaming(false); setNameDraft(pod.name); }
                }}
                className="flex-1 rounded-md border px-2 py-1 text-sm outline-none"
                style={{
                  borderColor: BRAND_GREEN,
                  backgroundColor: "var(--background)",
                  color: "var(--text)",
                }}
              />
              <button
                onClick={() => void submitRename()}
                disabled={busy}
                className="rounded-md p-1.5"
                style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
              >
                <Check size={13} />
              </button>
              <button
                onClick={() => { setRenaming(false); setNameDraft(pod.name); }}
                disabled={busy}
                className="rounded-md p-1.5"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <h2 className="truncate text-base font-semibold" style={{ color: "var(--text)" }}>
                {pod.name}
              </h2>
              <button
                onClick={() => setRenaming(true)}
                className="rounded-md p-1"
                style={{ color: "var(--text-muted)" }}
                title="Rename pod"
              >
                <Edit2 size={12} />
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => void archive()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          title="Archive pod"
        >
          <Archive size={11} />
          Archive
        </button>
      </div>

      {bannerErr && (
        <div
          className="border-b px-5 py-2 text-xs"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {bannerErr}
        </div>
      )}

      {/* Pending-changes bar. Sits between the header and the member
       *  sections so the supervisor knows what's about to be committed
       *  and can save or discard. */}
      {pending.length > 0 && (
        <div
          className="flex items-center justify-between gap-3 border-b px-5 py-2.5"
          style={{
            borderColor: "var(--border)",
            backgroundColor: BRAND_GREEN_SOFT,
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              {pending.length} unsaved
            </span>
            <span className="truncate text-[11px]" style={{ color: BRAND_GREEN }}>
              {pendingSummary(pending)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={discardPending}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)", backgroundColor: "var(--surface)" }}
            >
              <Undo2 size={11} />
              Discard
            </button>
            <button
              onClick={() => void commitPending()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              {busy
                ? <Loader2 size={11} className="animate-spin" />
                : <Save size={11} />}
              {busy ? "Saving…" : `Save changes`}
            </button>
          </div>
        </div>
      )}

      <MemberSection
        title="Supervisors"
        podRole="supervisor"
        members={supervisorsView}
        accent={{ bg: NEUTRAL_CHIP_BG, fg: NEUTRAL_CHIP_FG }}
        reservedUserIds={reservedUserIds}
        onStageAdd={(user) => stageAdd("supervisor", user)}
        onToggleRemove={stageRemove}
      />
      <MemberSection
        title="Engineers"
        podRole="engineer"
        members={engineersView}
        accent={{ bg: NEUTRAL_CHIP_BG, fg: NEUTRAL_CHIP_FG }}
        reservedUserIds={reservedUserIds}
        onStageAdd={(user) => stageAdd("engineer", user)}
        onToggleRemove={stageRemove}
      />
    </div>
  );
}

// Merge real members + pending mutations into a single display list,
// where each row carries a `_pendingKind` flag so the row component can
// render badges / strike-through.
type DisplayedMember = Member & {
  _pendingKind: "add" | "remove" | null;
  _tempKey: string;
};

function mergeForDisplay(
  real: Member[],
  pending: PendingChange[],
  role: PodRole,
): DisplayedMember[] {
  const pendingRemoves = new Set(
    pending.filter((c): c is PendingRemove => c.kind === "remove" && c.podRole === role)
           .map((c) => c.memberId),
  );

  const out: DisplayedMember[] = [];

  for (const m of real) {
    out.push({
      ...m,
      _pendingKind: pendingRemoves.has(m.id) ? "remove" : null,
      _tempKey: m.id,
    });
  }
  for (const c of pending) {
    if (c.kind === "add" && c.podRole === role) {
      out.push({
        id:         c.tempId,
        userId:     c.userId,
        podRole:    c.podRole,
        email:      c.email,
        displayName: c.displayName,
        addedAt:    new Date().toISOString(),
        _pendingKind: "add",
        _tempKey:   c.tempId,
      });
    }
  }
  return out;
}

function pendingSummary(p: PendingChange[]): string {
  const adds    = p.filter((c) => c.kind === "add").length;
  const removes = p.filter((c) => c.kind === "remove").length;
  const parts: string[] = [];
  if (adds)    parts.push(`+${adds} to add`);
  if (removes) parts.push(`−${removes} to remove`);
  return parts.join(" · ");
}

/* ──────── Member section (supervisors or engineers) ──────── */
// Purely presentational now: receives the merged member list (with
// pending-state flags) and callbacks to stage adds + toggle removes.
// All API work is done at PodDetail level when the supervisor clicks Save.

function MemberSection({
  title, podRole, members, accent, reservedUserIds, onStageAdd, onToggleRemove,
}: {
  title: string;
  podRole: PodRole;
  members: DisplayedMember[];
  accent: { bg: string; fg: string };
  reservedUserIds: Set<string>;
  onStageAdd: (user: EligibleUser) => void;
  onToggleRemove: (member: Member) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [eligible, setEligible] = useState<EligibleUser[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerErr, setPickerErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Effective live count for the header — exclude rows pending removal.
  const liveCount = members.filter((m) => m._pendingKind !== "remove").length;

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerErr(null);
    setQuery("");
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/admin/pods/eligible-users?role=${podRole}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load users.");
      setEligible(body.users as EligibleUser[]);
    } catch (e) {
      setPickerErr(e instanceof Error ? e.message : "Couldn't load users.");
    } finally {
      setPickerLoading(false);
    }
  };

  // Exclude anyone already on this pod (real or staged-add) so the
  // picker can't double-add someone.
  const filteredEligible = eligible.filter((u) => {
    if (reservedUserIds.has(u.id)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q);
  });

  return (
    <section className="border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
          {title} ({liveCount})
        </h3>
        <button
          onClick={() => void openPicker()}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Plus size={10} />
          Add {podRole}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="px-5 pb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No {podRole === "supervisor" ? "supervisors" : "engineers"} assigned yet.
        </p>
      ) : (
        <ul className="pb-2">
          {members.map((m) => (
            <MemberRow key={m._tempKey} member={m} accent={accent} onToggleRemove={onToggleRemove} />
          ))}
        </ul>
      )}

      {pickerOpen && (
        <PickerInline
          loading={pickerLoading}
          error={pickerErr}
          users={filteredEligible}
          query={query}
          setQuery={setQuery}
          podRole={podRole}
          onPick={(user) => {
            onStageAdd(user);
            // Leave the picker open so the supervisor can stage several
            // adds in a row; reservedUserIds filtering hides the chosen
            // user immediately so it can't be picked again.
          }}
          onClose={() => { setPickerOpen(false); setPickerErr(null); }}
        />
      )}
    </section>
  );
}

function MemberRow({
  member, accent, onToggleRemove,
}: {
  member: DisplayedMember;
  accent: { bg: string; fg: string };
  onToggleRemove: (member: Member) => void;
}) {
  const isAdd    = member._pendingKind === "add";
  const isRemove = member._pendingKind === "remove";

  return (
    <li
      className="flex items-center justify-between gap-3 px-5 py-2.5"
      style={{
        opacity: isRemove ? 0.55 : 1,
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
          style={{ backgroundColor: accent.bg, color: accent.fg }}
        >
          {(member.displayName || member.email || "?")[0]}
        </span>
        <div className="min-w-0 leading-tight">
          <div
            className="flex items-center gap-2 truncate text-sm"
            style={{
              color: "var(--text)",
              textDecoration: isRemove ? "line-through" : undefined,
            }}
          >
            {member.displayName || member.email || member.userId}
            {isAdd    && <PendingTag kind="add"    />}
            {isRemove && <PendingTag kind="remove" />}
          </div>
          {member.displayName && member.email && (
            <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
              {member.email}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={() => onToggleRemove(member)}
        className="rounded-md p-1 transition-opacity hover:opacity-80"
        style={{ color: "var(--text-muted)" }}
        title={
          isAdd    ? "Cancel pending add" :
          isRemove ? "Restore (cancel pending remove)" :
          "Remove from pod"
        }
      >
        {isRemove ? <RotateCcw size={13} /> : <X size={13} />}
      </button>
    </li>
  );
}

function PendingTag({ kind }: { kind: "add" | "remove" }) {
  if (kind === "add") {
    return (
      <span
        className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        + Pending
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "color-mix(in srgb, var(--accent-red) 12%, transparent)", color: "var(--accent-red)" }}
    >
      − Will remove
    </span>
  );
}

function PickerInline({
  loading, error, users, query, setQuery, podRole, onPick, onClose,
}: {
  loading: boolean;
  error: string | null;
  users: EligibleUser[];
  query: string;
  setQuery: (q: string) => void;
  podRole: PodRole;
  onPick: (user: EligibleUser) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div
      className="border-t px-5 py-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          placeholder={`Search ${podRole === "supervisor" ? "supervisors" : "engineers"}…`}
          className="flex-1 rounded-md border px-2 py-1.5 text-xs outline-none"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
        />
        <button
          onClick={onClose}
          className="rounded-md p-1"
          style={{ color: "var(--text-muted)" }}
          title="Close picker"
        >
          <X size={13} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : error ? (
        <p className="text-xs" style={{ color: "var(--accent-red)" }}>{error}</p>
      ) : users.length === 0 ? (
        <p className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          {podRole === "supervisor"
            ? "No unassigned supervisors. Create one in the Internal Staff tab first, or remove a supervisor from another pod."
            : "No unassigned engineers. Create one in the Internal Staff tab first, or remove an engineer from another pod."}
        </p>
      ) : (
        <ul className="max-h-60 overflow-y-auto">
          {users.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => onPick(u)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                    {u.displayName || u.email}
                  </div>
                  {u.displayName && u.email && (
                    <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {u.email}
                    </div>
                  )}
                </div>
                <Plus size={11} style={{ color: "var(--text-muted)" }} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
