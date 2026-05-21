"use client";

/*
 * Internal Users tab — filter tiles + table.
 *
 *   Sidebar: 4 vertical filter tiles (All, Superadmin, Supervisor, Engineer).
 *            "All" = sum of the other three (intentionally narrower than
 *            the platform-wide STAFF_ROLES set, which also includes
 *            enterprise_admin / department_admin / reseller — those are
 *            customer-org concerns, not internal staff).
 *   Main:    breadcrumb + searchable users table with per-row Resend /
 *            Deactivate / Delete actions.
 *
 * No minutes anywhere — internal users are staff, not minute-consuming
 * customer accounts (per spec §1).
 *
 * Same patterns as the other tabs:
 *   • Shared Breadcrumb above the main area
 *   • Per-row icons consistent with Pods / Enterprise tabs
 *   • Confirm dialogs on destructive actions
 *   • Status badge driven by the auth-ban flag from /api/admin/users
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Mail, Power, PowerOff, Trash2, Search } from "lucide-react";
import { Breadcrumb, type Crumb } from "@/app/_components/admin-v2/Breadcrumb";
import { FilterTile } from "@/app/_components/admin-v2/FilterTile";
import { ROLE } from "@/lib/relay/roles";
import { AddInternalUserDrawer } from "./_drawers/AddInternalUserDrawer";

type UserRow = {
  id:                  string;
  email:               string;
  displayName:         string;
  roles:               string[];
  primaryRole:         string | null;
  status:              "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn: boolean;
  createdAt:           string;
};

type TileKey = "all" | typeof ROLE.super_admin | typeof ROLE.supervisor | typeof ROLE.engineer;

const INTERNAL_ROLES = [ROLE.super_admin, ROLE.supervisor, ROLE.engineer] as const;

const ROLE_LABEL: Record<string, string> = {
  [ROLE.super_admin]: "Superadmin",
  [ROLE.supervisor]:  "Supervisor",
  [ROLE.engineer]:    "Engineer",
};

const PAGE_SIZE = 100;  // generous since internal user dataset is small.

export function InternalUsersTab() {
  const [tile, setTile]               = useState<TileKey>("all");
  const [counts, setCounts]           = useState<Record<string, number>>({});
  const [rows, setRows]               = useState<UserRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [query, setQuery]             = useState("");
  const [addOpen, setAddOpen]         = useState(false);

  // ─ Counts: 1 call per role in parallel (small response — pageSize=1). ─
  const refreshCounts = useCallback(async () => {
    try {
      const results = await Promise.all(
        INTERNAL_ROLES.map(async (r) => {
          const res  = await fetch(`/api/admin/users?scope=staff&role=${r}&pageSize=1`, { cache: "no-store" });
          const body = (await res.json().catch(() => ({}))) as { total?: number };
          return [r, body.total ?? 0] as const;
        }),
      );
      const map: Record<string, number> = {};
      let total = 0;
      for (const [r, n] of results) {
        map[r] = n;
        total += n;
      }
      map["all"] = total;
      setCounts(map);
    } catch {
      /* non-fatal — tiles just show 0 */
    }
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // ─ Rows: depends on the selected tile. For "all" we union the 3 roles. ─
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tile === "all") {
        const results = await Promise.all(
          INTERNAL_ROLES.map(async (r) => {
            const res = await fetch(
              `/api/admin/users?scope=staff&role=${r}&pageSize=${PAGE_SIZE}`,
              { cache: "no-store" },
            );
            const body = (await res.json().catch(() => ({}))) as { rows?: UserRow[] };
            return body.rows ?? [];
          }),
        );
        // Merge + sort newest first. Dedupe by id (a user could hold
        // multiple staff roles and show up in two responses).
        const seen = new Set<string>();
        const merged: UserRow[] = [];
        for (const arr of results) {
          for (const u of arr) {
            if (!seen.has(u.id)) {
              seen.add(u.id);
              merged.push(u);
            }
          }
        }
        merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setRows(merged);
      } else {
        const res  = await fetch(
          `/api/admin/users?scope=staff&role=${tile}&pageSize=${PAGE_SIZE}`,
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => ({}))) as { rows?: UserRow[]; error?: string };
        if (!res.ok || !body.rows) {
          setError(body.error ?? "Couldn't load users.");
          return;
        }
        setRows(body.rows);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load users.");
    } finally {
      setLoading(false);
    }
  }, [tile]);
  useEffect(() => { refresh(); }, [refresh]);

  // ─ Client-side search filter ───────────────────────────────────────
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) =>
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // ─ Mutations ──────────────────────────────────────────────────────
  const resendInvite = async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}/resend-invite`, { method: "POST" });
    if (res.ok) alert("Invite resent.");
    else alert((await res.json().catch(() => ({}))).error ?? "Resend failed.");
  };
  const toggleStatus = async (id: string, currentlyActive: boolean) => {
    const next = currentlyActive ? "DEACTIVATED" : "ACTIVE";
    const verb = currentlyActive ? "Deactivate" : "Reactivate";
    if (!confirm(`${verb} this user's sign-in access?`)) return;
    const res = await fetch(`/api/admin/users/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    if (res.ok) {
      // Patch the local row so the badge flips immediately.
      setRows((prev) => prev.map((u) =>
        u.id === id ? { ...u, status: next } : u,
      ));
    } else alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };
  const deleteUser = async (id: string) => {
    if (!confirm("Delete this user? This permanently removes their auth account.")) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      refresh();
      refreshCounts();
    } else alert((await res.json().catch(() => ({}))).error ?? "Delete failed.");
  };

  // ─ Render ─────────────────────────────────────────────────────────
  const activeRoleForAdd: typeof ROLE.engineer | typeof ROLE.supervisor | typeof ROLE.super_admin =
    tile === "all" ? ROLE.engineer : tile;

  return (
    <div className="flex h-full min-h-0">
      {/* Filter tiles sidebar */}
      <aside
        className="flex shrink-0 flex-col border-r"
        style={{ width: 220, borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <header
          className="px-4 pt-3 pb-2 text-xs font-semibold tracking-wide uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Filter
        </header>
        <div className="flex flex-col gap-2 p-3">
          <FilterTile
            label="All"
            count={counts["all"] ?? 0}
            selected={tile === "all"}
            onClick={() => setTile("all")}
          />
          {INTERNAL_ROLES.map((r) => (
            <FilterTile
              key={r}
              label={ROLE_LABEL[r]}
              count={counts[r] ?? 0}
              selected={tile === r}
              onClick={() => setTile(r)}
            />
          ))}
        </div>
        <div className="mt-auto border-t p-3" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <Plus className="size-3.5" /> Add Internal User
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Breadcrumb
          items={(() => {
            const crumbs: Crumb[] = [{
              label:   "Internal users",
              onClick: () => setTile("all"),
            }];
            if (tile !== "all") {
              crumbs.push({ label: ROLE_LABEL[tile] });
            }
            return crumbs;
          })()}
        />

        <section
          className="overflow-hidden rounded-lg border"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <header
            className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="relative flex-1 max-w-xs">
              <Search
                className="pointer-events-none absolute top-2 left-2 size-4"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-md border bg-transparent py-1.5 pr-2 pl-7 text-xs outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {loading ? "Loading…" : `${visible.length} of ${rows.length}`}
            </span>
          </header>

          {error && (
            <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--primary)" }}>
              {error}
            </p>
          )}

          {!loading && !error && visible.length === 0 && (
            <p className="px-4 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {query
                ? `No matches for "${query}".`
                : tile === "all"
                  ? "No internal users yet."
                  : `No ${ROLE_LABEL[tile].toLowerCase()}s yet.`}
            </p>
          )}

          {!loading && !error && visible.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[11px] tracking-wider uppercase"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>
                        {u.displayName || "—"}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                        {u.email}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>
                        {ROLE_LABEL[u.primaryRole ?? ""] ?? (u.primaryRole ?? "—")}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                          style={{
                            color: u.status === "ACTIVE" ? "#3dcb7e" : "var(--text-muted)",
                            background: u.status === "ACTIVE"
                              ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                              : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                          }}
                        >
                          {u.status === "ACTIVE" ? "active" : "suspended"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <RowIcon title="Resend invite email" onClick={() => resendInvite(u.id)}>
                            <Mail className="size-3.5" />
                          </RowIcon>
                          <RowIcon
                            title={u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                            onClick={() => toggleStatus(u.id, u.status === "ACTIVE")}
                          >
                            {u.status === "ACTIVE"
                              ? <PowerOff className="size-3.5" />
                              : <Power className="size-3.5" />}
                          </RowIcon>
                          <RowIcon title="Delete user" danger onClick={() => deleteUser(u.id)}>
                            <Trash2 className="size-3.5" />
                          </RowIcon>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <AddInternalUserDrawer
        open={addOpen}
        defaultRole={activeRoleForAdd}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          refresh();
          refreshCounts();
        }}
      />
    </div>
  );
}

function RowIcon({
  title, onClick, children, danger,
}: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-white/5"
      style={{ color: danger ? "var(--primary)" : "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}
