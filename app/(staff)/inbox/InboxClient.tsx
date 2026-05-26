"use client";

/*
 * Engineer inbox.
 *
 * Three columns:
 *
 *   left (280px)   People — searchable list of every customer who's had
 *                  a session, with how many sessions each.
 *
 *   center (1fr)   When a person is selected, all their sessions in
 *                  chronological order (oldest first). Each row is
 *                  clickable and opens the session page.
 *
 *   right (320px)  Call log — every recent call across customers, with
 *                  its own search + sort. Clicking a row opens the
 *                  session.
 *
 * The legacy "Chats" tab was removed — the queue lives on /dashboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Loader2, PhoneIncoming, Search, Sparkles, X } from "lucide-react";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

type ConnectRequest = {
  id: string;
  customerUserId: string;
  projectId: string | null;
  message: string | null;
  createdAt: string;
  customerName: string | null;
  customerEmail: string | null;
  projectName: string | null;
};

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
const URGENT_AMBER      = "#d4a017";

type Person = {
  key:      string;
  email:    string;
  name:     string;
  sessions: GuestCall[];
};

export function InboxClient() {
  const router = useRouter();
  useRequireEngineerProfile();
  const { queue, recent, myActive, loading, error } = useEngineerWorkspace();

  // ── Pending connect requests (engineer is Busy → customer pinged) ────
  // Real-time subscribed so a new request appears without refresh; rows
  // disappear from the list when the engineer accepts / declines or the
  // customer cancels.
  const [requests, setRequests] = useState<ConnectRequest[]>([]);
  const [reqBusyId, setReqBusyId] = useState<string | null>(null);
  const sbRef = useRef(createClient());

  const enrichRequest = useCallback(async (row: {
    id: string;
    customer_user_id: string;
    project_id: string | null;
    message: string | null;
    created_at: string;
  }): Promise<ConnectRequest> => {
    const sb = sbRef.current;
    const [custRes, projRes] = await Promise.all([
      sb.from("customer_profiles")
        .select("display_name, email")
        .eq("user_id", row.customer_user_id)
        .maybeSingle(),
      row.project_id
        ? sb.from("projects").select("name").eq("id", row.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const cust = (custRes.data ?? null) as { display_name: string | null; email: string | null } | null;
    const proj = (projRes.data ?? null) as { name: string | null } | null;
    return {
      id: row.id,
      customerUserId: row.customer_user_id,
      projectId: row.project_id,
      message: row.message,
      createdAt: row.created_at,
      customerName: cust?.display_name ?? null,
      customerEmail: cust?.email ?? null,
      projectName: proj?.name ?? null,
    };
  }, []);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) return;
      const { data } = await sb
        .from("engineer_connect_requests")
        .select("id, customer_user_id, project_id, message, created_at")
        .eq("engineer_user_id", me)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (!alive) return;
      const rows = (data ?? []) as Array<{
        id: string;
        customer_user_id: string;
        project_id: string | null;
        message: string | null;
        created_at: string;
      }>;
      const enriched = await Promise.all(rows.map(enrichRequest));
      if (!alive) return;
      setRequests(enriched);

      // Realtime — fan-in inserts and status updates so the list mirrors
      // the database without polling.
      const ch = sb
        .channel(`inbox-requests-${me}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_connect_requests",
            filter: `engineer_user_id=eq.${me}`,
          },
          (payload) => {
            const next = payload.new as typeof rows[number] & { status?: string } | null;
            const old = payload.old as { id?: string; status?: string } | null;
            const oldId = old?.id;
            if (!next && oldId) {
              setRequests((prev) => prev.filter((r) => r.id !== oldId));
              return;
            }
            if (!next) return;
            if (next.status !== "pending") {
              setRequests((prev) => prev.filter((r) => r.id !== next.id));
              return;
            }
            void enrichRequest(next).then((enrichedRow) => {
              if (!alive) return;
              setRequests((prev) => {
                const without = prev.filter((r) => r.id !== enrichedRow.id);
                return [enrichedRow, ...without].sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                );
              });
            });
          },
        )
        .subscribe();

      return () => { sb.removeChannel(ch); };
    })();
    return () => { alive = false; };
  }, [enrichRequest]);

  const onAccept = useCallback(async (req: ConnectRequest) => {
    if (reqBusyId) return;
    setReqBusyId(req.id);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("accept_connect_request", { _id: req.id });
      if (error) {
        window.alert(`Couldn't accept: ${error.message}`);
        return;
      }
      // Realtime will remove the row from the list when status flips.
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } finally {
      setReqBusyId(null);
    }
  }, [reqBusyId]);

  const onDecline = useCallback(async (req: ConnectRequest) => {
    if (reqBusyId) return;
    setReqBusyId(req.id);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("decline_connect_request", { _id: req.id });
      if (error) {
        window.alert(`Couldn't decline: ${error.message}`);
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } finally {
      setReqBusyId(null);
    }
  }, [reqBusyId]);

  // ── People list (left rail) ───────────────────────────────────────────
  const [peopleSearch, setPeopleSearch] = useState("");
  const [selectedKey, setSelectedKey]   = useState<string | null>(null);

  const peopleMap = useMemo(() => {
    // queue/myActive/recent can overlap on the same session id (a live one
    // appears in both myActive and recent during the assigned→ended window).
    // Dedupe up front so each person's sessions list has unique ids — the
    // <li key={s.id}> below otherwise warns "two children with the same key".
    const seen = new Set<string>();
    const all: GuestCall[] = [];
    for (const c of [...queue, ...myActive, ...recent]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      all.push(c);
    }
    const map = new Map<string, Person>();
    for (const c of all) {
      const k = c.guest_email || c.guest_name || c.id;
      if (!k) continue;
      const existing = map.get(k);
      if (existing) {
        existing.sessions.push(c);
      } else {
        map.set(k, {
          key:      k,
          email:    c.guest_email ?? "",
          name:     c.guest_name ?? "Customer",
          sessions: [c],
        });
      }
    }
    return map;
  }, [queue, recent, myActive]);

  const people = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    const list = Array.from(peopleMap.values());
    const filtered = !q
      ? list
      : list.filter((p) =>
          p.name.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q),
        );
    return filtered.sort((a, b) => {
      const am = Math.max(...a.sessions.map((s) => new Date(s.created_at).getTime()));
      const bm = Math.max(...b.sessions.map((s) => new Date(s.created_at).getTime()));
      return bm - am;
    });
  }, [peopleMap, peopleSearch]);

  // Auto-select the first person once data lands.
  useEffect(() => {
    if (!selectedKey && people.length > 0) setSelectedKey(people[0].key);
  }, [people, selectedKey]);

  const selectedPerson = selectedKey ? peopleMap.get(selectedKey) ?? null : null;

  // ── Call log (right rail) ─────────────────────────────────────────────
  const [logSearch, setLogSearch] = useState("");
  const [logSort, setLogSort]     = useState<"newest" | "oldest" | "name" | "status">("newest");
  const [logCollapsed, setLogCollapsed] = useState(false);

  const logRows = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    let arr = q
      ? recent.filter((c) =>
          (c.guest_name  ?? "").toLowerCase().includes(q) ||
          (c.guest_email ?? "").toLowerCase().includes(q) ||
          (c.status      ?? "").toLowerCase().includes(q),
        )
      : recent;
    arr = [...arr];
    arr.sort((a, b) => {
      switch (logSort) {
        case "oldest":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name":
          return (a.guest_name ?? "").localeCompare(b.guest_name ?? "");
        case "status":
          return (a.status ?? "").localeCompare(b.status ?? "");
        case "newest":
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return arr;
  }, [recent, logSearch, logSort]);

  return (
    <div
      className="grid h-screen transition-[grid-template-columns] duration-200"
      style={{
        gridTemplateColumns: `280px 1fr ${logCollapsed ? 40 : 320}px`,
        backgroundColor: "var(--surface)",
      }}
    >
      {/* ── Left rail: People ──────────────────────────────────────── */}
      <aside
        className="flex min-h-0 flex-col overflow-hidden border-r"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div className="border-b p-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
            People
          </h3>
          <div
            className="flex items-center gap-2 rounded-md border px-3 py-2"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
          >
            <Search size={12} style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              value={peopleSearch}
              onChange={(e) => setPeopleSearch(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-transparent text-xs outline-none"
              style={{ color: "var(--text)" }}
            />
          </div>
        </div>

        <div className="hide-scrollbar flex-1 overflow-y-auto">
          {loading ? (
            <EmptyHint text="Loading…" />
          ) : people.length === 0 ? (
            <EmptyHint text={peopleSearch ? `No people match "${peopleSearch}".` : "No people yet — sessions will populate this list."} />
          ) : (
            people.map((p) => {
              const active = p.key === selectedKey;
              const hasQueued = p.sessions.some((s) => s.status === "queued");
              return (
                <button
                  key={p.key}
                  onClick={() => setSelectedKey(p.key)}
                  className="relative flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
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
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
                    style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
                  >
                    {(p.name || "?")[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{p.name}</span>
                      {hasQueued && (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: URGENT_AMBER }} />
                      )}
                    </div>
                    <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.sessions.length} session{p.sessions.length !== 1 ? "s" : ""}
                      {p.email ? ` · ${p.email}` : ""}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Center: Person's sessions ──────────────────────────────── */}
      <section
        className="flex min-h-0 flex-col overflow-hidden border-r"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        {error && (
          <div
            className="mx-6 mt-4 rounded-md border px-4 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
              color: "var(--accent-red)",
            }}
          >
            {error}
          </div>
        )}

        {requests.length > 0 && (
          <PendingRequests
            requests={requests}
            busyId={reqBusyId}
            onAccept={onAccept}
            onDecline={onDecline}
          />
        )}

        {selectedPerson ? (
          <PersonHistory person={selectedPerson} onOpen={(id) => router.push(`/staff/session/${id}`)} />
        ) : requests.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="flex max-w-md flex-col items-center gap-5">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl"
                style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
              >
                <Sparkles size={26} />
              </div>
              <div>
                <h2 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
                  Welcome back
                </h2>
                <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  Pick a customer on the left to see their session history.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Right rail: Call log ───────────────────────────────────── */}
      <aside
        className="flex min-h-0 flex-col overflow-hidden border-l"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        {logCollapsed ? (
          /* Collapsed rail — narrow vertical strip with a toggle. */
          <button
            type="button"
            onClick={() => setLogCollapsed(false)}
            title="Expand call log"
            className="flex h-full w-full flex-col items-center justify-start gap-3 px-2 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
            style={{ color: "var(--text-muted)" }}
          >
            <ChevronLeft size={14} />
            <span
              className="select-none text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ writingMode: "vertical-rl" }}
            >
              Call log
            </span>
          </button>
        ) : (
          <>
            <div className="border-b p-3" style={{ borderColor: "var(--border)" }}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                  Call log
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {logRows.length} of {recent.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLogCollapsed(true)}
                    title="Collapse call log"
                    className="rounded-md p-0.5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
              <div
                className="mb-2 flex items-center gap-2 rounded-md border px-3 py-2"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
              >
                <Search size={12} style={{ color: "var(--text-muted)" }} />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Search calls…"
                  className="w-full bg-transparent text-xs outline-none"
                  style={{ color: "var(--text)" }}
                />
              </div>
              <select
                value={logSort}
                onChange={(e) => setLogSort(e.target.value as typeof logSort)}
                className="w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--background)",
                  color: "var(--text)",
                }}
              >
                <option value="newest">Sort: Newest first</option>
                <option value="oldest">Sort: Oldest first</option>
                <option value="name">Sort: Customer name</option>
                <option value="status">Sort: Status</option>
              </select>
            </div>

            <div className="hide-scrollbar flex-1 overflow-y-auto">
              {logRows.length === 0 ? (
                <EmptyHint text={logSearch ? `No calls match "${logSearch}".` : "No calls yet."} />
              ) : (
                logRows.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/staff/session/${c.id}`)}
                    className="flex w-full items-center justify-between gap-2 border-b px-5 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{c.guest_name || "Customer"}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {new Date(c.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/* ──────── Center pane: full session history for one person ─────────── */

function PersonHistory({
  person, onOpen,
}: {
  person: Person;
  onOpen: (sessionId: string) => void;
}) {
  // Newest first — same direction as the right-rail Call log, so the
  // whole page reads consistently.
  const ordered = useMemo(
    () => [...person.sessions].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [person.sessions],
  );

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          {(person.name || "?")[0]}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
            {person.name}
          </h2>
          <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
            {person.email || "—"} · {person.sessions.length} session{person.sessions.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <ul className="hide-scrollbar flex-1 overflow-y-auto">
        {ordered.map((s) => {
          const summaryTitle = (s as { ai_summary_title?: string | null }).ai_summary_title;
          return (
            <li key={s.id} className="border-b" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => onOpen(s.id)}
                className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: "var(--text)" }}>
                    {summaryTitle ?? s.project_name ?? "Session"}
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <span className="lowercase">{s.status}</span>
                    {s.duration_minutes != null && <span> · {Math.round(Number(s.duration_minutes))}m</span>}
                    {s.agent_name && <span> · w/ {s.agent_name}</span>}
                  </div>
                </div>
                <span
                  className="shrink-0 text-[11px] tabular-nums"
                  style={{ color: "var(--text-muted)" }}
                >
                  {new Date(s.created_at).toLocaleString([], {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>{text}</p>;
}

// ──────────────────────────────────────────────────────────────────────────
// PendingRequests — list of customer-initiated connect requests at the top
// of the center pane. Realtime-driven; rows clear on Accept / Decline /
// customer-cancel. Accept flips status → customer-side picks up the change
// and routes the customer into a session via the normal new-session flow.
// ──────────────────────────────────────────────────────────────────────────
function PendingRequests({
  requests, busyId, onAccept, onDecline,
}: {
  requests: ConnectRequest[];
  busyId: string | null;
  onAccept: (req: ConnectRequest) => void;
  onDecline: (req: ConnectRequest) => void;
}) {
  return (
    <section
      className="shrink-0 border-b px-5 py-4"
      style={{ borderColor: "var(--border)", backgroundColor: "color-mix(in srgb, var(--warn) 5%, var(--surface))" }}
    >
      <header className="mb-3 flex items-center gap-2">
        <PhoneIncoming size={14} style={{ color: URGENT_AMBER }} />
        <h2 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text)" }}>
          Pending requests · {requests.length}
        </h2>
      </header>
      <ul className="flex flex-col gap-2">
        {requests.map((r) => {
          const busy = busyId === r.id;
          return (
            <li
              key={r.id}
              className="flex items-start gap-3 rounded-lg border bg-[var(--surface)] px-3 py-2.5"
              style={{ borderColor: "var(--border)" }}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
                style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
              >
                {(r.customerName || r.customerEmail || "?")[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                    {r.customerName ?? r.customerEmail ?? "Customer"}
                  </span>
                  {r.projectName && (
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      · {r.projectName}
                    </span>
                  )}
                </div>
                {r.message && (
                  <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                    &ldquo;{r.message}&rdquo;
                  </p>
                )}
                <div className="mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAccept(r)}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: BRAND_GREEN }}
                  title="Accept request"
                >
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecline(r)}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                  title="Decline request"
                >
                  <X size={10} />
                  Decline
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = status === "live"
    ? { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN }
    : status === "queued" || status === "assigned" || status === "joining"
    ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER }
    : { bg: "color-mix(in srgb, var(--text) 8%, transparent)", fg: "var(--text-muted)" };
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {status}
    </span>
  );
}
