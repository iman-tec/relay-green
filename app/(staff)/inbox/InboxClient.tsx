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
import { Check, ChevronLeft, ChevronRight, Folder, Loader2, PhoneIncoming, Search, Sparkles, X } from "lucide-react";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { createClient } from "@/lib/supabase/browser";
import { QuoteRequestsInbox } from "./QuoteRequestsInbox";
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

// "Guest" is the legacy DB default for customer rows that haven't set a
// display name. Engineers asked us to surface these as "Customer" instead
// — better mental model since these ARE customers, not anonymous guests.
// This normalises at render time without touching the underlying data.
function displayCustomerName(raw: string | null | undefined): string {
  if (!raw) return "Customer";
  const trimmed = raw.trim();
  if (!trimmed) return "Customer";
  if (trimmed.toLowerCase() === "guest") return "Customer";
  return trimmed;
}

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
    // Channel is hoisted to the effect scope so the useEffect cleanup
    // (not the discarded async-IIFE return) can call removeChannel. Same
    // pair-of-bugs that the dashboard had: IIFE-return cleanup was lost
    // AND the channel name was stable per user, so Supabase's name-based
    // dedupe yelled "cannot add postgres_changes after subscribe()" when
    // a stale leaked channel collided with a fresh mount.
    let ch: ReturnType<typeof sb.channel> | null = null;
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

      // Per-mount UUID suffix on the channel name — defends against
      // Supabase's name-based dedupe when a leaked subscription from a
      // previous mount is still hanging around.
      const suffix = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      // Realtime — fan-in inserts and status updates so the list mirrors
      // the database without polling.
      ch = sb
        .channel(`inbox-requests-${me}-${suffix}`)
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
    })();
    return () => {
      alive = false;
      if (ch) sb.removeChannel(ch);
    };
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
          name:     displayCustomerName(c.guest_name),
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
  // Searches over two axes — customer (name/email) OR project (name).
  // A "newest first" sort is the default (engineers asked); other sorts
  // available via the dropdown. The default view shows the last 30 calls
  // (engineer-side ask), with an optional from–to date range to dig
  // further back. 90-day retention is a server-side concern handled by a
  // separate sweeper edge function; from the UI we expose whatever the
  // server returns.
  const [logSearch, setLogSearch] = useState("");
  const [logSearchMode, setLogSearchMode] = useState<"customer" | "project">("customer");
  const [logSort, setLogSort] = useState<"newest" | "oldest" | "name" | "status">("newest");
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [logFromDate, setLogFromDate] = useState<string>("");
  const [logToDate, setLogToDate] = useState<string>("");
  const [logShowAll, setLogShowAll] = useState(false);  // toggle: 30 default → all

  // Default cap when no filters are applied — 30 most-recent calls.
  const DEFAULT_LOG_CAP = 30;

  const logRows = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    let arr: typeof recent = recent;

    // Date range filter — interpret empty strings as "no bound."
    if (logFromDate) {
      const fromMs = new Date(`${logFromDate}T00:00:00`).getTime();
      arr = arr.filter((c) => new Date(c.created_at).getTime() >= fromMs);
    }
    if (logToDate) {
      const toMs = new Date(`${logToDate}T23:59:59.999`).getTime();
      arr = arr.filter((c) => new Date(c.created_at).getTime() <= toMs);
    }

    // Search filter — split by axis. Customer mode looks at guest_name +
    // guest_email; project mode looks at project_name.
    if (q) {
      if (logSearchMode === "customer") {
        arr = arr.filter((c) =>
          (c.guest_name ?? "").toLowerCase().includes(q) ||
          (c.guest_email ?? "").toLowerCase().includes(q),
        );
      } else {
        arr = arr.filter((c) =>
          (c.project_name ?? "").toLowerCase().includes(q),
        );
      }
    }

    // Sort (defaults newest-first).
    arr = [...arr].sort((a, b) => {
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

    // Apply default cap only when no filters are active and the engineer
    // hasn't asked to see everything.
    const hasFilters = q.length > 0 || logFromDate.length > 0 || logToDate.length > 0;
    if (!hasFilters && !logShowAll && arr.length > DEFAULT_LOG_CAP) {
      arr = arr.slice(0, DEFAULT_LOG_CAP);
    }

    return arr;
  }, [recent, logSearch, logSearchMode, logSort, logFromDate, logToDate, logShowAll]);

  const totalRecentCount = recent.length;
  const hasAnyFilter = logSearch.length > 0 || logFromDate.length > 0 || logToDate.length > 0;

  // Column-gradient palette — left → right increases in light, then drops
  // back dark on the rightmost rail. Visual cue that the three lists are
  // distinct surfaces, not one continuous panel.
  //
  //   Sidebar (left of inbox, owned by StaffShell)  → dark (var(--surface))
  //   People (left aside)                           → light
  //   Center (sessions)                             → lighter
  //   Call log (right aside)                        → dark (matches sidebar)
  //
  // The shades are tinted from the canvas with low-alpha text mixes so
  // they read correctly under all 3 themes (light / dark / espresso).
  const COL_PEOPLE_BG  = "color-mix(in srgb, var(--text) 3%, var(--surface))";
  const COL_CENTER_BG  = "color-mix(in srgb, var(--text) 6%, var(--surface))";
  const COL_CALLLOG_BG = "var(--surface)";

  // Tramline divider — vertical strip rendered as its own grid column
  // between content columns. 1px border line · ~8px green-tinted fill ·
  // 1px border line. Lives in the grid template (not as a border on the
  // aside) so the green fill can be opaque, which `border-style: double`
  // can't do (its gap is always transparent).
  const DIVIDER_W = 10;
  const dividerStyle: React.CSSProperties = {
    borderLeft: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
    backgroundColor: `color-mix(in srgb, ${BRAND_GREEN} 32%, var(--surface))`,
  };

  return (
    <div
      className="grid h-screen transition-[grid-template-columns] duration-200"
      style={{
        gridTemplateColumns: `280px ${DIVIDER_W}px 1fr ${DIVIDER_W}px ${logCollapsed ? 40 : 320}px`,
        backgroundColor: "var(--surface)",
      }}
    >
      {/* ── Left rail: People (light shade) ───────────────────────── */}
      <aside
        className="flex min-h-0 flex-col overflow-hidden"
        style={{ backgroundColor: COL_PEOPLE_BG }}
      >
        <div className="border-b p-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
            Customer name
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
              placeholder="Search customers…"
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
                    // Strong selected-state tint — was too subtle (text 4%);
                    // now uses the brand soft so the row visually pops out
                    // and reads as "this is the row driving the right
                    // pane's contents."
                    backgroundColor: active ? BRAND_GREEN_SOFT : "transparent",
                  }}
                >
                  {active && (
                    <>
                      {/* Left edge bar — wider + full-bleed for a clearer
                          marker than the prior 2px inset bar. */}
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px]"
                        style={{ backgroundColor: BRAND_GREEN }}
                      />
                      {/* Right-edge "tab" — visually bridges into the
                          center pane so the eye reads "this row → that
                          panel." Sticks out a hair past the column border. */}
                      <span
                        aria-hidden
                        className="absolute right-0 top-1/2 h-3 w-1.5 -translate-y-1/2 translate-x-[3px] rounded-l-sm"
                        style={{ backgroundColor: BRAND_GREEN }}
                      />
                    </>
                  )}
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
                    style={{
                      backgroundColor: active ? BRAND_GREEN : BRAND_GREEN_SOFT,
                      color: active ? "#fff" : BRAND_GREEN,
                    }}
                  >
                    {(p.name || "?")[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-sm font-medium"
                        style={{ color: active ? BRAND_GREEN : "var(--text)" }}
                      >
                        {p.name}
                      </span>
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

      {/* ── Tramline divider (People → Sessions) ──────────────────── */}
      <div aria-hidden style={dividerStyle} />

      {/* ── Center: Person's sessions (lighter shade) ──────────────── */}
      <section
        className="flex min-h-0 flex-col overflow-hidden"
        style={{ backgroundColor: COL_CENTER_BG }}
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

        {/* Incoming go-live / maintenance quote requests → bid prep.
            Locked to 45% of the column height so the section is static
            regardless of how many bids land — internal scroll inside
            QuoteRequestsInbox handles overflow. min-h-0 lets the inner
            flex layout actually scroll instead of stretching the wrapper.
            flex 0 0 enforces the basis (no grow, no shrink) so a busy
            PersonHistory below can't squeeze it. */}
        <div
          className="px-4 pb-3 pt-3"
          style={{ flex: "0 0 45%", minHeight: 0 }}
        >
          <QuoteRequestsInbox />
        </div>

        {selectedPerson ? (
          <PersonHistory person={selectedPerson} onOpen={(id) => router.push(`/session-review/${id}`)} />
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

      {/* ── Tramline divider (Sessions → Call log) ────────────────── */}
      <div aria-hidden style={dividerStyle} />

      {/* ── Right rail: Call log (dark, matches StaffShell sidebar) ── */}
      <aside
        className="flex min-h-0 flex-col overflow-hidden"
        style={{ backgroundColor: COL_CALLLOG_BG }}
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
              {/* Search axis toggle — Customer vs Project. */}
              <div
                className="mb-2 inline-flex rounded-md border p-0.5"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
              >
                <button
                  type="button"
                  onClick={() => setLogSearchMode("customer")}
                  aria-pressed={logSearchMode === "customer"}
                  className="rounded px-2 py-0.5 text-[10px] font-semibold transition-colors"
                  style={{
                    backgroundColor: logSearchMode === "customer" ? BRAND_GREEN : "transparent",
                    color: logSearchMode === "customer" ? "#fff" : "var(--text-muted)",
                  }}
                >
                  Customer
                </button>
                <button
                  type="button"
                  onClick={() => setLogSearchMode("project")}
                  aria-pressed={logSearchMode === "project"}
                  className="rounded px-2 py-0.5 text-[10px] font-semibold transition-colors"
                  style={{
                    backgroundColor: logSearchMode === "project" ? BRAND_GREEN : "transparent",
                    color: logSearchMode === "project" ? "#fff" : "var(--text-muted)",
                  }}
                >
                  Project
                </button>
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
                  placeholder={logSearchMode === "customer" ? "Search by customer…" : "Search by project…"}
                  className="w-full bg-transparent text-xs outline-none"
                  style={{ color: "var(--text)" }}
                />
              </div>

              {/* Date range — dig deeper into history without scrolling. */}
              <div className="mb-2 flex items-center gap-1.5">
                <input
                  type="date"
                  value={logFromDate}
                  onChange={(e) => setLogFromDate(e.target.value)}
                  title="Start date"
                  className="flex-1 rounded-md border px-2 py-1 text-[11px] outline-none"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
                />
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>→</span>
                <input
                  type="date"
                  value={logToDate}
                  onChange={(e) => setLogToDate(e.target.value)}
                  title="End date"
                  className="flex-1 rounded-md border px-2 py-1 text-[11px] outline-none"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
                />
                {(logFromDate || logToDate) && (
                  <button
                    type="button"
                    onClick={() => { setLogFromDate(""); setLogToDate(""); }}
                    title="Clear date range"
                    className="rounded-md p-0.5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <X size={11} />
                  </button>
                )}
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

              {/* Show-all toggle — visible only when the default 30-cap
                  is hiding more rows and the engineer hasn't already
                  applied a filter to narrow things down. */}
              {!hasAnyFilter && totalRecentCount > 30 && (
                <button
                  type="button"
                  onClick={() => setLogShowAll((v) => !v)}
                  className="mt-2 w-full rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  {logShowAll
                    ? `Show last 30 only (currently ${totalRecentCount})`
                    : `Show all ${totalRecentCount} calls`}
                </button>
              )}
            </div>

            <div className="hide-scrollbar flex-1 overflow-y-auto">
              {logRows.length === 0 ? (
                <EmptyHint text={
                  hasAnyFilter
                    ? `No calls match the current filters.`
                    : "No calls yet."
                } />
              ) : (
                logRows.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/session-review/${c.id}`)}
                    className="flex w-full items-center justify-between gap-2 border-b px-5 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{displayCustomerName(c.guest_name)}</div>
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

/* ──────── Center pane: project-grouped session history for one person ───
 * Sessions are bucketed by project_id (with a fallback "No project"
 * bucket for orphans). Each bucket renders as a collapsible accordion;
 * expanded buckets show the sessions sorted newest-first. Clicking a
 * session opens the full session detail view (AI summary + files +
 * chat transcript) at /staff/session/<id>.
 * ───────────────────────────────────────────────────────────────────── */

type ProjectBucket = {
  key: string;            // project_id or "__none__"
  name: string;           // display name (project_name) or "No project"
  sessions: GuestCall[];
  latestAt: number;       // for sort
};

function PersonHistory({
  person, onOpen,
}: {
  person: Person;
  onOpen: (sessionId: string) => void;
}) {
  // Bucket by project. Sessions without a project fall into a single
  // "No project" group so they're not lost — but the bucket only
  // renders when it has content, so a clean person with everything
  // attached to a project never sees it.
  const buckets = useMemo(() => {
    const map = new Map<string, ProjectBucket>();
    for (const s of person.sessions) {
      const key = s.project_id ?? "__none__";
      const name = s.project_name ?? "No project";
      const bucket = map.get(key) ?? { key, name, sessions: [], latestAt: 0 };
      bucket.sessions.push(s);
      const t = new Date(s.created_at).getTime();
      if (t > bucket.latestAt) bucket.latestAt = t;
      map.set(key, bucket);
    }
    const arr = Array.from(map.values()).map((b) => ({
      ...b,
      sessions: [...b.sessions].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    }));
    arr.sort((a, b) => b.latestAt - a.latestAt);
    return arr;
  }, [person.sessions]);

  // Track which projects are expanded. Default: the most-recent project
  // is open on first render so the engineer doesn't have to click to see
  // anything; other projects are collapsed.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (buckets[0]) s.add(buckets[0].key);
    return s;
  });
  // Keep the "newest project open by default" behaviour stable when the
  // person changes — re-open whatever the new newest is.
  useEffect(() => {
    if (buckets[0]) setOpenKeys(new Set([buckets[0].key]));
    else setOpenKeys(new Set());
  }, [person.key, buckets]);

  const toggle = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Context banner — visually announces "you're looking at this
          customer's sessions" so the right column doesn't read as just
          another list. Brand-tinted background + eyebrow label + a larger
          avatar than the left column's row chip. The chevron at the
          left edge points back to the People list as a visual bridge. */}
      <header
        className="relative flex items-center gap-4 border-b px-6 py-3"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)",
        }}
      >
        {/* Leading brand bar — mirrors the active-row marker on the left
            column so the eye reads continuity from selected row → banner. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: BRAND_GREEN }}
        />
        {/* Large avatar — bigger than the left-column chips so the
            "this is the customer in focus" reading is automatic. */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold uppercase shadow-sm"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {(person.name || "?")[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: BRAND_GREEN }}
          >
            Viewing sessions for
          </p>
          <h2
            className="mt-0.5 truncate text-lg font-semibold"
            style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
          >
            {person.name}
          </h2>
          <p className="mt-0.5 truncate text-[12px]" style={{ color: "var(--text-muted)" }}>
            {person.email || "—"}
            <span className="mx-1.5" style={{ color: "var(--text-faint)" }}>·</span>
            {person.sessions.length} session{person.sessions.length === 1 ? "" : "s"}
            <span className="mx-1.5" style={{ color: "var(--text-faint)" }}>·</span>
            {buckets.length} project{buckets.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <div className="hide-scrollbar flex-1 overflow-y-auto">
        {buckets.map((b) => {
          const open = openKeys.has(b.key);
          return (
            <ProjectBucketRow
              key={b.key}
              bucket={b}
              open={open}
              onToggle={() => toggle(b.key)}
              onOpenSession={onOpen}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProjectBucketRow({
  bucket, open, onToggle, onOpenSession,
}: {
  bucket: ProjectBucket;
  open: boolean;
  onToggle: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div className="border-b" style={{ borderColor: "var(--border)" }}>
      {/* Project header — clickable accordion toggle */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      >
        <ChevronRight
          size={12}
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
        <Folder size={12} style={{ color: open ? BRAND_GREEN : "var(--text-muted)" }} />
        <span className="flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--text)" }}>
          {bucket.name}
        </span>
        <span
          className="rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
            color: "var(--text-muted)",
          }}
        >
          {bucket.sessions.length}
        </span>
        <span
          className="shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--text-faint)" }}
        >
          {new Date(bucket.latestAt).toLocaleDateString([], { month: "short", day: "numeric" })}
        </span>
      </button>

      {/* Sessions under this project — only rendered when expanded so
          collapsed groups don't pay layout cost. */}
      {open && (
        <ul>
          {bucket.sessions.map((s) => {
            const summaryTitle = (s as { ai_summary_title?: string | null }).ai_summary_title;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenSession(s.id)}
                  className="flex w-full items-center justify-between gap-3 border-t px-8 py-2 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]" style={{ color: "var(--text)" }}>
                      {summaryTitle ?? "Session"}
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
      )}
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
