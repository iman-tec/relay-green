"use client";

/*
 * Projects center-pane view — opened from the sidebar's "All projects" footer.
 * Modeled on Claude's Projects page (title + Sort-by + New project + a central
 * search), adapted to Relay: no tabs, just search + sort over the customer's
 * projects, in a narrow centered column. Opening a project shows its session
 * list; picking a session jumps to it in the room.
 *
 * Rendered IN the room's center area (the sidebar + any live call stay put);
 * a Back affordance clears the view and "Return to call" jumps to a live call.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  PhoneCall,
  MessageSquare,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type ProjectItem = {
  id: string;
  name: string;
  createdAt: string;
  completionStatus: "active" | "completed" | "archived";
  aiSummaryTitle: string | null;
  aiSummaryOverview: string | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
};

type SessionRow = {
  id: string;
  createdAt: string;
  status: string;
  agentName: string | null;
};

type SortKey = "activity" | "name" | "created";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "name", label: "Name" },
  { key: "created", label: "Created" },
];

const activityMs = (p: ProjectItem) =>
  new Date(p.summaryUpdatedAt ?? p.createdAt).getTime();

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const statusLabel = (s: string) =>
  ({
    live: "Live",
    grace: "Live",
    assigned: "Connecting",
    joining: "Connecting",
    queued: "Waiting",
    ended: "Ended",
    cancelled: "Cancelled",
    abandoned: "Ended",
    expired_free: "Ended",
  })[s] ?? s;

export function ProjectsCenterView({
  projects,
  customerUserId,
  hasActiveSession,
  onSelectProject,
  onViewPast,
  onNewProject,
  onReturnToCall,
  onClose,
}: {
  projects: ProjectItem[];
  customerUserId: string | null;
  hasActiveSession: boolean;
  onSelectProject: (projectId: string) => void;
  onViewPast: (sessionId: string) => void;
  onNewProject: () => void;
  onReturnToCall: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("activity");
  const [sortOpen, setSortOpen] = useState(false);
  const [detail, setDetail] = useState<ProjectItem | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.aiSummaryOverview ?? p.summary ?? "").toLowerCase().includes(q)
        )
      : projects;
    const sorted = [...filtered];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "created")
      sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    else sorted.sort((a, b) => activityMs(b) - activityMs(a));
    return sorted;
  }, [projects, query, sort]);

  // ── Back / return-to-call bar (shared by both views) ───────────────────
  const topBar = (
    <div className="flex items-center gap-2 px-6 pt-5">
      <button
        type="button"
        onClick={detail ? () => setDetail(null) : onClose}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: "var(--text-muted)" }}
      >
        <ArrowLeft size={15} /> {detail ? "All projects" : "Back"}
      </button>
      {hasActiveSession && (
        <button
          type="button"
          onClick={onReturnToCall}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--green-dot)" }}
        >
          <PhoneCall size={13} /> Return to call
        </button>
      )}
    </div>
  );

  if (detail) {
    return (
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
        {topBar}
        <ProjectDetail
          project={detail}
          customerUserId={customerUserId}
          onOpenSession={(id) => {
            onViewPast(id);
            onClose();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
      {topBar}

      {/* Title + sort + new project */}
      <div className="flex items-center justify-between gap-3 px-6 pt-3">
        <h1 className="font-serif text-3xl" style={{ color: "var(--text)" }}>
          Projects
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Sort by
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              {SORTS.find((s) => s.key === sort)?.label}
              <ChevronDown
                size={13}
                className={
                  sortOpen
                    ? "rotate-180 transition-transform"
                    : "transition-transform"
                }
              />
            </button>
            {sortOpen && (
              <div
                className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-lg border shadow-xl"
                style={{
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                }}
              >
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setSort(s.key);
                      setSortOpen(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={{
                      color: "var(--text)",
                      background:
                        s.key === sort ? "var(--primary-soft)" : "transparent",
                      fontWeight: s.key === sort ? 600 : 400,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            <Plus size={14} /> New project
          </button>
        </div>
      </div>

      {/* Central search */}
      <div className="px-6 pt-4">
        <div
          className="flex items-center gap-2 rounded-xl border px-3.5 py-2.5"
          style={{
            borderColor: "var(--border)",
            background: "var(--background)",
          }}
        >
          <Search size={16} style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60"
            style={{ color: "var(--text)" }}
          />
        </div>
      </div>

      {/* List */}
      <div className="hide-scrollbar mt-3 flex-1 overflow-y-auto px-6 pb-6">
        {projects.length === 0 ? (
          <Empty onNewProject={onNewProject} />
        ) : visible.length === 0 ? (
          <p
            className="py-12 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            No projects match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((p) => {
              const overview = p.aiSummaryOverview ?? p.summary ?? null;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProject(p.id);
                      setDetail(p);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-[var(--primary)] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "var(--primary-soft)",
                        color: "var(--primary)",
                      }}
                    >
                      <FolderOpen size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate text-[14px] font-semibold"
                          style={{ color: "var(--text)" }}
                        >
                          {p.name}
                        </span>
                        {p.completionStatus !== "active" && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0 text-[9px] font-semibold tracking-wider uppercase"
                            style={{
                              background:
                                "color-mix(in srgb, var(--text) 8%, transparent)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {p.completionStatus}
                          </span>
                        )}
                      </div>
                      {overview && (
                        <p
                          className="mt-0.5 line-clamp-1 text-[12px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {overview}
                        </p>
                      )}
                    </div>
                    <ChevronRight
                      size={16}
                      className="shrink-0"
                      style={{ color: "var(--text-faint)" }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Project detail — the project's session list ──────────────────────────────
function ProjectDetail({
  project,
  customerUserId,
  onOpenSession,
}: {
  project: ProjectItem;
  customerUserId: string | null;
  onOpenSession: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!customerUserId) {
        setLoading(false);
        return;
      }
      const sb = createClient();
      const { data } = await sb
        .from("guest_calls")
        .select("id, created_at, status, agent_name")
        .eq("customer_user_id", customerUserId)
        .eq("project_id", project.id)
        .order("created_at", { ascending: false });
      if (!alive) return;
      setSessions(
        (
          (data ?? []) as Array<{
            id: string;
            created_at: string;
            status: string;
            agent_name: string | null;
          }>
        ).map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          status: r.status,
          agentName: r.agent_name,
        }))
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [project.id, customerUserId]);

  return (
    <>
      <div className="px-6 pt-3">
        <h1 className="font-serif text-3xl" style={{ color: "var(--text)" }}>
          {project.name}
        </h1>
        <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="hide-scrollbar mt-3 flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <p
            className="py-12 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            Loading sessions…
          </p>
        ) : sessions.length === 0 ? (
          <p
            className="py-12 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            No sessions in this project yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenSession(s.id)}
                  className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-[var(--primary)] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: "var(--primary-soft)",
                      color: "var(--primary)",
                    }}
                  >
                    <MessageSquare size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[14px] font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      {s.agentName ? `Session with ${s.agentName}` : "Session"}
                    </div>
                    <div
                      className="text-[12px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {fmtDate(s.createdAt)} · {statusLabel(s.status)}
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className="shrink-0"
                    style={{ color: "var(--text-faint)" }}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Empty({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div
        className="mb-4 flex size-14 items-center justify-center rounded-2xl"
        style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
      >
        <FolderOpen size={26} />
      </div>
      <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        Looking to start a project?
      </h2>
      <p
        className="mt-1 max-w-sm text-[13px]"
        style={{ color: "var(--text-muted)" }}
      >
        Create a project to organize your sessions, files, and engineers in one
        space.
      </p>
      <button
        type="button"
        onClick={onNewProject}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--primary)" }}
      >
        <Plus size={14} /> New project
      </button>
    </div>
  );
}
