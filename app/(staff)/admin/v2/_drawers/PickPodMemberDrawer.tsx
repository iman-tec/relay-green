"use client";

/*
 * Pick a user (engineer or supervisor) and add them to a pod.
 *
 * Lists users from /api/admin/pods/eligible-users?role=engineer|supervisor
 * — that endpoint already filters down to users holding the right role
 * and not already in any pod. Picking one POSTs to
 * /api/admin/pods/:podId/members.
 */

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

type Candidate = { id: string; email: string; displayName: string };

export function PickPodMemberDrawer({
  open,
  podId,
  role,
  onClose,
  onAdded,
}: {
  open:     boolean;
  podId:    string | null;
  role:     "engineer" | "supervisor";
  onClose:  () => void;
  onAdded:  (userId: string) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [query, setQuery]           = useState("");
  const [adding, setAdding]         = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/pods/eligible-users?role=${role}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { users?: Candidate[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.users) {
          setError(body.error ?? "Couldn't load candidates.");
          return;
        }
        setCandidates(body.users);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load candidates.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, role]);

  const filtered = candidates.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.email.toLowerCase().includes(q) || c.displayName.toLowerCase().includes(q);
  });

  const add = async (userId: string) => {
    if (!podId) return;
    setAdding(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pods/${podId}/members`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userId, podRole: role }),
      });
      const body = (await res.json().catch(() => ({}))) as { member?: { id: string }; error?: string };
      if (!res.ok || !body.member) {
        setError(body.error ?? "Couldn't add.");
        return;
      }
      onAdded(userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add.");
    } finally {
      setAdding(null);
    }
  };

  const verb  = role === "engineer" ? "engineer" : "supervisor";
  const title = role === "engineer" ? "Add Engineer to Pod" : "Add Supervisor to Pod";

  return (
    <Drawer open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 size-4"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${verb}s by name or email…`}
            className="w-full rounded-md border bg-transparent py-2 pr-2 pl-8 text-sm outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          />
        </div>

        {error && <ErrorBanner message={error} />}

        {loading && (
          <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Loading {verb}s…
          </p>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {candidates.length === 0
              ? `No unassigned ${verb}s available.`
              : `No matches for "${query}".`}
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="flex flex-col gap-1">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => add(c.id)}
                  disabled={adding !== null}
                  className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                      color:      "var(--primary)",
                    }}
                  >
                    {initials(c)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: "var(--text)" }}>
                      {c.displayName || "—"}
                    </div>
                    <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.email}
                    </div>
                  </div>
                  <span className="text-xs" style={{ color: "var(--primary)" }}>
                    {adding === c.id ? "Adding…" : "Add"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

function initials(c: Candidate): string {
  const src = c.displayName || c.email;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      className="rounded-md border px-3 py-2 text-xs"
      style={{
        borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
        background:  "color-mix(in srgb, var(--primary) 8%, transparent)",
        color:       "var(--primary)",
      }}
    >
      {message}
    </p>
  );
}
