"use client";

/*
 * Resellers tab — master-detail layout matching the Enterprise tab.
 *
 *   left pane          right pane
 *   ────────────────   ─────────────────────────────────────
 *   • Acme Reselling   Acme Reselling · RLC-AB12CD
 *   • Northwind        ────────────────────────────────────
 *   • …                Allocated  10000   Used  3210
 *                      Remaining   6790   Commission 12%
 *                      Total enterprises 7  ·  Active 6
 *
 * Super-admin-only surface (page already gated). Creates resellers, sends
 * the Supabase invite email, refills minute pools, and deactivates
 * (which converts the reseller's inorganic enterprises to organic).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Power,
  PowerOff,
  Search,
  X,
  CheckCircle2,
  Copy as CopyIcon,
  Coins,
  Pencil,
  Building2,
} from "lucide-react";
import { useConfirmDialog } from "@/app/_components/ConfirmDialog";

const BRAND_GREEN = "#3f5c2e";

type Enterprise = {
  id:                string;
  name:              string;
  primaryDomain:     string | null;
  status:            string;
  enterpriseCode:    string;
  allocatedMinutes:  number;
  usedMinutes:       number;
  remainingMinutes:  number;
  createdAt:         string;
};

type Reseller = {
  id:                string;
  name:              string;
  email:             string | null;
  resellerCode:      string;
  commission:        number;
  allocatedMinutes:  number;
  usedMinutes:       number;
  remainingMinutes:  number;
  status:            "active" | "suspended";
  ownerUserId:       string | null;
  totalEnterprises:  number;
  activeEnterprises: number;
  enterprises:       Enterprise[];
  createdAt:         string;
};

export function ResellersTab() {
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), 3000);
    return () => clearTimeout(t);
  }, [info]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/resellers", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        resellers?: Reseller[]; error?: string;
      };
      if (!res.ok) { setError(body.error ?? "Couldn't load resellers."); return; }
      setResellers(body.resellers ?? []);
      setSelectedId((curr) => curr ?? (body.resellers?.[0]?.id ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load resellers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createReseller = async (input: {
    name: string; email: string; commission: number; allocatedMinutes: number;
  }) => {
    const res = await fetch("/api/admin/resellers", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { reseller?: Reseller; error?: string };
    if (!res.ok) return { ok: false as const, error: body.error ?? "Couldn't create reseller." };
    await load();
    if (body.reseller?.id) setSelectedId(body.reseller.id);
    setInfo(`Invitation email sent to ${input.email}.`);
    return { ok: true as const };
  };

  const refill = async (r: Reseller, amount: number) => {
    const res = await fetch(`/api/admin/resellers/${r.id}/refill`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ amount }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false as const, error: body.error ?? "Refill failed." };
    setInfo(`Added ${amount} minutes to ${r.name}.`);
    await load();
    return { ok: true as const };
  };

  const toggleStatus = async (r: Reseller) => {
    const next = r.status === "active" ? "suspended" : "active";
    if (next === "suspended") {
      const ok = await confirmDialog.ask({
        title: `Deactivate "${r.name}"?`,
        message:
          "All inorganic enterprises owned by this reseller will be converted to organic " +
          "(superadmin becomes direct owner). Data is preserved.",
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (!ok) return;
    }
    const res = await fetch(`/api/admin/resellers/${r.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(body.error ?? "Update failed."); return; }
    setInfo(next === "active" ? `Reactivated ${r.name}.` : `Deactivated ${r.name}.`);
    await load();
  };

  const editReseller = async (
    r: Reseller,
    patch: { name?: string; email?: string; commission?: number },
  ) => {
    const res = await fetch(`/api/admin/resellers/${r.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(patch),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false as const, error: body.error ?? "Update failed." };
    setInfo(`Updated ${r.name}.`);
    await load();
    return { ok: true as const };
  };

  const selected = resellers.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorLine message={error} dismiss={() => setError(null)} />}
      {info && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm font-medium"
          style={{
            backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
            color: BRAND_GREEN,
            borderColor: "color-mix(in srgb, " + BRAND_GREEN + " 35%, transparent)",
            animation: "relay-toast-in 180ms ease-out",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 size={14} />
            {info}
          </span>
          <button type="button" onClick={() => setInfo(null)} aria-label="Dismiss" className="rounded-md p-1">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-[300px_1fr] gap-4">
        <ResellerList
          resellers={resellers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          createReseller={createReseller}
        />

        <div>
          {!selected ? (
            <EmptyDetail />
          ) : (
            <ResellerDetail
              key={selected.id}
              reseller={selected}
              refill={refill}
              toggleStatus={() => void toggleStatus(selected)}
              edit={editReseller}
            />
          )}
        </div>
      </div>
      {confirmDialog.element}
    </div>
  );
}

/* ──────── Left pane: reseller list + create ──────── */

function ResellerList({
  resellers, selectedId, onSelect, loading, createReseller,
}: {
  resellers: Reseller[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  loading: boolean;
  createReseller: (input: {
    name: string; email: string; commission: number; allocatedMinutes: number;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resellers;
    return resellers.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        r.resellerCode.toLowerCase().includes(q),
    );
  }, [resellers, query]);

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
          Resellers ({resellers.length})
        </h3>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Plus size={11} />
          New
        </button>
      </div>

      {creating && (
        <ResellerCreateInline
          submit={async (input) => {
            const r = await createReseller(input);
            if (r.ok) setCreating(false);
            return r;
          }}
          cancel={() => setCreating(false)}
        />
      )}

      {!loading && resellers.length > 0 && (
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
            placeholder="Search resellers…"
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
      ) : resellers.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No resellers yet. Create your first reseller to start onboarding inorganic enterprises.
        </p>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No resellers match “{query}”.
        </p>
      ) : (
        <div className="max-h-[600px] overflow-y-auto">
          {filtered.map((r) => {
            const active = r.id === selectedId;
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
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
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                    {r.name}
                  </div>
                  <StatusChip status={r.status} />
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {r.resellerCode}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {r.totalEnterprises} enterprise{r.totalEnterprises === 1 ? "" : "s"} · {fmt(r.remainingMinutes)} min remaining
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
        Select a reseller on the left, or create a new one.
      </p>
    </div>
  );
}

function ResellerCreateInline({
  submit, cancel,
}: {
  submit: (input: {
    name: string; email: string; commission: number; allocatedMinutes: number;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  cancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [commission, setCommission] = useState("10");
  const [allocatedMinutes, setAllocatedMinutes] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const onSubmit = async () => {
    if (!name.trim() || !email.trim()) {
      setErr("Name and email are required.");
      return;
    }
    const comm = Number(commission);
    const alloc = Number(allocatedMinutes);
    if (Number.isNaN(comm) || comm < 0 || comm > 100) {
      setErr("Commission must be between 0 and 100.");
      return;
    }
    if (Number.isNaN(alloc) || alloc < 0) {
      setErr("Allocation must be non-negative.");
      return;
    }
    setBusy(true); setErr(null);
    const r = await submit({
      name:             name.trim(),
      email:            email.trim(),
      commission:       comm,
      allocatedMinutes: alloc,
    });
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  return (
    <div
      className="border-b p-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
      }}
    >
      <div className="grid grid-cols-1 gap-2">
        <Field label="Reseller name" value={name} onChange={setName} placeholder="Acme Reselling" autoFocus />
        <Field label="Reseller email" value={email} onChange={setEmail} placeholder="contact@acme.com" type="email" />
        <Field label="Commission (%)" value={commission} onChange={setCommission} placeholder="10" type="number" />
        <Field label="Initial minutes" value={allocatedMinutes} onChange={setAllocatedMinutes} placeholder="0" type="number" />
      </div>
      {err && <p className="mt-1 text-[11px]" style={{ color: "var(--accent-red)" }}>{err}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : null}
          {busy ? "Creating…" : "Create reseller"}
        </button>
      </div>
    </div>
  );
}

/* ──────── Right pane: reseller detail ──────── */

function ResellerDetail({
  reseller, refill, toggleStatus, edit,
}: {
  reseller: Reseller;
  refill: (r: Reseller, amount: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  toggleStatus: () => void;
  edit: (
    r: Reseller,
    patch: { name?: string; email?: string; commission?: number },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [refillOpen, setRefillOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [bannerErr, setBannerErr] = useState<string | null>(null);

  const codeFmt = reseller.resellerCode;
  const isActive = reseller.status === "active";

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
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {reseller.name}
          </div>
          <div
            className="mt-0.5 inline-flex items-center gap-1.5 text-[11px]"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
          >
            {codeFmt}
            <CopyButton text={codeFmt} />
          </div>
          {reseller.email && (
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {reseller.email}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={reseller.status} />
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            title="Edit reseller"
          >
            <Pencil size={11} />
            Edit
          </button>
          <button
            onClick={() => setRefillOpen(true)}
            disabled={!isActive}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN }}
            title="Add minutes to this reseller's pool"
          >
            <Coins size={11} />
            Add minutes
          </button>
          <button
            onClick={toggleStatus}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--border)",
              color: isActive ? "var(--accent-red)" : BRAND_GREEN,
            }}
            title={isActive ? "Deactivate reseller" : "Reactivate reseller"}
          >
            {isActive ? <Power size={11} /> : <PowerOff size={11} />}
            {isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
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

      {/* KPI grid */}
      <div
        className="grid grid-cols-3 gap-px"
        style={{ backgroundColor: "var(--border)" }}
      >
        <KpiCell label="Allocated minutes"  value={fmt(reseller.allocatedMinutes)} />
        <KpiCell label="Used minutes"       value={fmt(reseller.usedMinutes)} />
        <KpiCell label="Remaining minutes"  value={fmt(reseller.remainingMinutes)} accent />
        <KpiCell label="Total enterprises"  value={String(reseller.totalEnterprises)} />
        <KpiCell label="Active enterprises" value={String(reseller.activeEnterprises)} />
        <KpiCell label="Commission"         value={`${reseller.commission}%`} />
      </div>

      {/* Enterprises minted by this reseller — read-only list. Day-to-day
          enterprise management still lives on the Enterprise customers tab;
          this is just the visibility cross-link "what did Acme Reselling
          sign up?". */}
      <EnterprisesSection enterprises={reseller.enterprises ?? []} />

      {/* Footer meta */}
      <div className="px-5 py-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
        Created {new Date(reseller.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      </div>

      {refillOpen && (
        <RefillModal
          reseller={reseller}
          cancel={() => setRefillOpen(false)}
          submit={async (amount) => {
            const r = await refill(reseller, amount);
            if (r.ok) setRefillOpen(false);
            else setBannerErr(r.error);
            return r;
          }}
        />
      )}

      {editing && (
        <EditModal
          reseller={reseller}
          cancel={() => setEditing(false)}
          submit={async (patch) => {
            const r = await edit(reseller, patch);
            if (r.ok) setEditing(false);
            else setBannerErr(r.error);
            return r;
          }}
        />
      )}
    </div>
  );
}

function KpiCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="flex flex-col gap-1 px-5 py-4"
      style={{ backgroundColor: "var(--surface)" }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="text-lg font-semibold"
        style={{ color: accent ? BRAND_GREEN : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ──────── Enterprises minted by this reseller ──────── */

function EnterprisesSection({ enterprises }: { enterprises: Enterprise[] }) {
  return (
    <section className="border-t" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <h3
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: "var(--text-muted)" }}
        >
          Enterprises ({enterprises.length})
        </h3>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Created via this reseller
        </span>
      </div>

      {enterprises.length === 0 ? (
        <p className="px-5 pb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No enterprises yet. They appear here as the reseller signs them up.
        </p>
      ) : (
        <ul className="pb-2">
          {enterprises.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 border-t px-5 py-2.5"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
                  color: BRAND_GREEN,
                }}
              >
                <Building2 size={14} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm" style={{ color: "var(--text)" }}>
                  {e.name}
                </div>
                <div
                  className="mt-0.5 truncate text-[11px]"
                  style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                >
                  {e.enterpriseCode}
                  {e.primaryDomain && <> · {e.primaryDomain}</>}
                </div>
              </div>
              <span
                className="text-[11px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
                title={`Allocated ${e.allocatedMinutes}, used ${e.usedMinutes}, remaining ${e.remainingMinutes}`}
              >
                {Math.round(e.remainingMinutes)} / {Math.round(e.allocatedMinutes)} min
              </span>
              <StatusChip status={e.status === "active" ? "active" : "suspended"} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RefillModal({
  reseller, cancel, submit,
}: {
  reseller: Reseller;
  cancel: () => void;
  submit: (amount: number) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setErr("Amount must be > 0."); return; }
    setBusy(true); setErr(null);
    const r = await submit(n);
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  return (
    <ModalShell title={`Add minutes — ${reseller.name}`} onClose={busy ? () => undefined : cancel}>
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        Adds to the reseller's pool. They'll see allocated + remaining bump immediately.
      </p>
      <Field label="Minutes to add" value={amount} onChange={setAmount} type="number" autoFocus />
      {err && <p className="mt-1 text-[11px]" style={{ color: "var(--accent-red)" }}>{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={cancel} disabled={busy} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button
          onClick={() => void onSubmit()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Coins size={11} />}
          {busy ? "Adding…" : "Add minutes"}
        </button>
      </div>
    </ModalShell>
  );
}

function EditModal({
  reseller, cancel, submit,
}: {
  reseller: Reseller;
  cancel: () => void;
  submit: (patch: { name?: string; email?: string; commission?: number }) =>
    Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState(reseller.name);
  const [email, setEmail] = useState(reseller.email ?? "");
  const [commission, setCommission] = useState(String(reseller.commission));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    const patch: { name?: string; email?: string; commission?: number } = {};
    if (name.trim() && name.trim() !== reseller.name) patch.name = name.trim();
    if (email.trim() && email.trim().toLowerCase() !== (reseller.email ?? "")) patch.email = email.trim();
    if (commission.trim()) {
      const n = Number(commission);
      if (Number.isNaN(n) || n < 0 || n > 100) { setErr("Commission must be 0–100."); return; }
      if (n !== reseller.commission) patch.commission = n;
    }
    if (!Object.keys(patch).length) { cancel(); return; }
    setBusy(true); setErr(null);
    const r = await submit(patch);
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  return (
    <ModalShell title={`Edit reseller`} onClose={busy ? () => undefined : cancel}>
      <Field label="Reseller name" value={name} onChange={setName} autoFocus />
      <div className="mt-2"><Field label="Reseller email" value={email} onChange={setEmail} type="email" /></div>
      <div className="mt-2"><Field label="Commission (%)" value={commission} onChange={setCommission} type="number" /></div>
      {err && <p className="mt-1 text-[11px]" style={{ color: "var(--accent-red)" }}>{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={cancel} disabled={busy} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button
          onClick={() => void onSubmit()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : null}
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.40)" }}>
      <div
        className="w-full max-w-md rounded-xl border p-4"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h4>
          <button onClick={onClose} className="rounded-md p-1" style={{ color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ──────── Small helpers ──────── */

function Field({
  label, value, onChange, placeholder, type = "text", autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="rounded-md border px-2.5 py-1.5 text-sm outline-none"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--background)",
          color: "var(--text)",
        }}
      />
    </div>
  );
}

function StatusChip({ status }: { status: "active" | "suspended" }) {
  if (status === "suspended") {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text-muted) 14%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        Suspended
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color: BRAND_GREEN,
      }}
    >
      Active
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard refused — silently ignore */ }
      }}
      className="rounded-md p-0.5 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
      style={{ color: copied ? BRAND_GREEN : "var(--text-muted)" }}
    >
      {copied ? <CheckCircle2 size={11} /> : <CopyIcon size={11} />}
    </button>
  );
}

function ErrorLine({ message, dismiss }: { message: string; dismiss: () => void }) {
  return (
    <div
      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
      style={{
        backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
        color: "var(--accent-red)",
        borderColor: "color-mix(in srgb, var(--accent-red) 25%, transparent)",
      }}
    >
      <span>{message}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-md p-1">
        <X size={14} />
      </button>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined).format(Math.round(n));
}
