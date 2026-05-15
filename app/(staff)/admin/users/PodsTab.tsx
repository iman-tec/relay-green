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
import { Loader2, Plus, X, Edit2, Check, Save, Undo2, RotateCcw, Search, Mail, Power, Trash2, CheckCircle2 } from "lucide-react";
import { useConfirmDialog } from "@/app/_components/ConfirmDialog";

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
  const [bannerInfo, setBannerInfo] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useEffect(() => {
    if (!bannerInfo) return;
    const t = setTimeout(() => setBannerInfo(null), 3000);
    return () => clearTimeout(t);
  }, [bannerInfo]);

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

  // Direct user-management actions (mirror the Enterprise tab + Internal
  // staff tab). These hit /api/admin/users/:id/* and refresh on success.
  const resendInvite = async (m: Member) => {
    if (!confirm(`Re-send sign-in email to ${m.email}?`)) return;
    const res = await fetch(`/api/admin/users/${m.userId}/resend-invite`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setBannerErr(body.error ?? "Resend failed."); return; }
    await onMutated();
  };

  const toggleStatus = async (m: Member) => {
    // The pod-row Member type doesn't carry status; the API patch is a
    // toggle keyed by user_id, so we just confirm and call. Future: pipe
    // status through /api/admin/pods so the chip reflects reality.
    if (!confirm(`Deactivate ${m.email}? (or reactivate if already deactivated)`)) return;
    // Best-effort: try DEACTIVATED first, on collision the next click
    // flips back.
    const res = await fetch(`/api/admin/users/${m.userId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: "DEACTIVATED" }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setBannerErr(body.error ?? "Update failed."); return; }
    await onMutated();
  };

  const deleteUser = async (m: Member) => {
    if (!confirm(`Permanently delete ${m.email}? Their auth record, profile, and pod membership will be removed.`)) return;
    const res = await fetch(`/api/admin/users/${m.userId}`, { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setBannerErr(body.error ?? "Delete failed."); return; }
    await onMutated();
  };

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
    const ok = await confirmDialog.ask({
      title:        `Delete "${pod.name}"?`,
      message:      "Members will be unassigned and the pod removed from this list.",
      confirmLabel: "Delete pod",
      tone:         "danger",
    });
    if (!ok) return;
    const deletedName = pod.name;
    setBusy(true); setBannerErr(null);
    try {
      const res = await fetch(`/api/admin/pods/${pod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Delete failed.");
      setBannerInfo(`Pod "${deletedName}" deleted.`);
      await onMutated();
    } catch (e) {
      setBannerErr(e instanceof Error ? e.message : "Delete failed.");
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
          style={{ borderColor: "var(--border)", color: "var(--accent-red)" }}
          title="Delete pod"
        >
          <Trash2 size={11} />
          Delete
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

      {bannerInfo && (
        <div
          className="flex items-center gap-2 border-b px-5 py-2 text-xs font-medium"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
            color: BRAND_GREEN,
            animation: "relay-toast-in 180ms ease-out",
          }}
        >
          <CheckCircle2 size={12} />
          {bannerInfo}
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
        onResendInvite={resendInvite}
        onToggleStatus={toggleStatus}
        onDeleteUser={deleteUser}
      />
      <MemberSection
        title="Engineers"
        podRole="engineer"
        members={engineersView}
        accent={{ bg: NEUTRAL_CHIP_BG, fg: NEUTRAL_CHIP_FG }}
        reservedUserIds={reservedUserIds}
        onStageAdd={(user) => stageAdd("engineer", user)}
        onToggleRemove={stageRemove}
        onResendInvite={resendInvite}
        onToggleStatus={toggleStatus}
        onDeleteUser={deleteUser}
      />
      {confirmDialog.element}
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
  title, podRole, members, accent, onStageAdd, onToggleRemove,
  onResendInvite, onToggleStatus, onDeleteUser,
}: {
  title: string;
  podRole: PodRole;
  members: DisplayedMember[];
  accent: { bg: string; fg: string };
  reservedUserIds: Set<string>;
  onStageAdd: (user: EligibleUser) => void;
  onToggleRemove: (member: Member) => void;
  onResendInvite: (member: Member) => void;
  onToggleStatus: (member: Member) => void;
  onDeleteUser:   (member: Member) => void;
}) {
  const [drafting, setDrafting] = useState(false);

  // Effective live count for the header — exclude rows pending removal.
  const liveCount = members.filter((m) => m._pendingKind !== "remove").length;

  // Invite a brand-new supervisor / engineer directly from the pod
  // (Enterprise-style — no picker, no search). Posts to /api/admin/users
  // with the platform role and auto-stages the new user for this pod.
  const inviteAndStage = async ({ email, displayName }: { email: string; displayName: string }) => {
    const platformRole = podRole === "supervisor" ? "pod_lead" : "engineer";
    const res = await fetch("/api/admin/users", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: email.trim().toLowerCase(), displayName: displayName.trim(), role: platformRole }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      user?:    { id: string; email: string; displayName: string };
      invited?: boolean;
      error?:   string;
    };
    if (!res.ok) {
      return { ok: false as const, error: body.error ?? "Invite failed." };
    }
    if (body.user) {
      onStageAdd({ id: body.user.id, email: body.user.email, displayName: body.user.displayName });
    }
    return { ok: true as const };
  };

  return (
    <section className="border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
          {title} ({liveCount})
        </h3>
        <button
          onClick={() => setDrafting(true)}
          disabled={drafting}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Plus size={10} />
          Add {podRole}
        </button>
      </div>

      {drafting && (
        <InviteDraft
          podRole={podRole}
          cancel={() => setDrafting(false)}
          submit={async (input) => {
            const r = await inviteAndStage(input);
            if (r.ok) setDrafting(false);
            return r;
          }}
        />
      )}

      {members.length === 0 && !drafting ? (
        <p className="px-5 pb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No {podRole === "supervisor" ? "supervisors" : "engineers"} assigned yet.
        </p>
      ) : (
        <ul className="pb-2">
          {members.map((m) => (
            <MemberRow
              key={m._tempKey}
              member={m}
              accent={accent}
              podRoleLabel={podRole === "supervisor" ? "Supervisor" : "Engineer"}
              onToggleRemove={onToggleRemove}
              onResendInvite={onResendInvite}
              onToggleStatus={onToggleStatus}
              onDeleteUser={onDeleteUser}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteDraft({
  podRole, cancel, submit,
}: {
  podRole: PodRole;
  cancel: () => void;
  submit: (input: { email: string; displayName: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const onSubmit = async () => {
    if (!email.trim() || !displayName.trim()) {
      setErr("Name and email are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await submit({ email: email.trim(), displayName: displayName.trim() });
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  void podRole; // role is set in the parent; not used in the form copy

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
          autoFocus
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void onSubmit(); if (e.key === "Escape") cancel(); }}
          placeholder="Full name"
          disabled={busy}
          className="flex-1 rounded-md border px-2 py-1.5 text-xs outline-none"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void onSubmit(); if (e.key === "Escape") cancel(); }}
          placeholder="email@company.com"
          disabled={busy}
          className="flex-1 rounded-md border px-2 py-1.5 text-xs outline-none"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
        />
      </div>
      {err && <p className="mb-2 text-[11px]" style={{ color: "var(--accent-red)" }}>{err}</p>}
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={cancel}
          disabled={busy}
          className="rounded-md px-2 py-1 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => void onSubmit()}
          disabled={busy || !email.trim() || !displayName.trim()}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
    </div>
  );
}

function MemberRow({
  member, accent, podRoleLabel,
  onToggleRemove, onResendInvite, onToggleStatus, onDeleteUser,
}: {
  member: DisplayedMember;
  accent: { bg: string; fg: string };
  podRoleLabel: string;
  onToggleRemove: (member: Member) => void;
  onResendInvite: (member: Member) => void;
  onToggleStatus: (member: Member) => void;
  onDeleteUser:   (member: Member) => void;
}) {
  const isAdd    = member._pendingKind === "add";
  const isRemove = member._pendingKind === "remove";

  return (
    <li
      className="flex items-center gap-3 border-t px-5 py-2.5"
      style={{
        borderColor: "var(--border)",
        opacity: isRemove ? 0.55 : 1,
      }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
        style={{ backgroundColor: accent.bg, color: accent.fg }}
      >
        {(member.displayName || member.email || "?")[0]}
      </span>

      <div className="min-w-0 flex-1 leading-tight">
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

      {/* Role chip — mirrors Enterprise's RoleChip */}
      <span
        className="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
          color: BRAND_GREEN,
        }}
      >
        {podRoleLabel}
      </span>

      {/* Status chip — pod members are active by default; once we surface
          banned_until per pod member, this will reflect reality. */}
      <span
        className="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
          color: BRAND_GREEN,
        }}
      >
        Active
      </span>

      <div className="inline-flex shrink-0 items-center gap-1">
        <PodIconBtn
          onClick={() => onResendInvite(member)}
          title="Resend invitation email"
          icon={<Mail size={12} />}
        />
        <PodIconBtn
          onClick={() => onToggleStatus(member)}
          title="Deactivate / reactivate"
          icon={<Power size={12} />}
        />
        <PodIconBtn
          onClick={() => onDeleteUser(member)}
          title="Delete user"
          icon={<Trash2 size={12} />}
          danger
        />
        <PodIconBtn
          onClick={() => onToggleRemove(member)}
          title={
            isAdd    ? "Cancel pending add" :
            isRemove ? "Restore (cancel pending remove)" :
            "Remove from pod"
          }
          icon={isRemove ? <RotateCcw size={12} /> : <X size={12} />}
        />
      </div>
    </li>
  );
}

function PodIconBtn({
  onClick, title, icon, danger,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded-md p-1 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
      style={{ color: danger ? "var(--accent-red)" : "var(--text-muted)" }}
    >
      {icon}
    </button>
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

