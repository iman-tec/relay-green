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

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import type { GuestCall } from "@/lib/supabase/types";

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

        {selectedPerson ? (
          <PersonHistory person={selectedPerson} onOpen={(id) => router.push(`/staff/session/${id}`)} />
        ) : (
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
        )}
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
