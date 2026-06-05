"use client";

/*
 * Project detail — engineer's 3-pane project workspace.
 *
 *   LEFT   customer header → project dropdown (current project selected) →
 *          every session in the selected project.
 *   CENTER project AI summary (read-more) → docs → files (aggregated across
 *          ALL of the project's sessions).
 *   RIGHT  AI project assistant (self-contained Q&A).
 *
 * NOTE ON DATA: the LEFT/RIGHT panes and the FILES pane are wired to real
 * Supabase data. The CENTER **project summary** is intentionally a placeholder
 * (ProjectSummaryCard) — it renders projects.summary as a fallback, but the
 * real summary is meant to be wired to the vector/Qdrant backend separately.
 * Look for the `WIRE-UP` marker in ProjectSummaryCard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Folder,
  FileText,
  Image as ImageIcon,
  PlayCircle,
  Download,
  Sparkles,
  Loader2,
  FileSpreadsheet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { signedDownloadUrl } from "@/lib/relay/chatAttachments";
import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { ProjectAIAssistant } from "@/app/_components/ProjectAIAssistant";

const BRAND_GREEN = "#3f5c2e";

// Phone-width viewport — drives the project view's mobile collapse defaults.
function isMobileViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

type SessionRow = {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  status: string;
  created_at: string;
  duration_minutes: number | null;
  ai_summary_title: string | null;
  ai_summary_overview: string | null;
  summary: string | null;
  ai_next_steps: unknown;
  agent_name: string | null;
  customer_user_id: string | null;
  project_id: string | null;
  project_name: string | null;
};

type ProjectRow = {
  id: string;
  name: string | null;
  summary: string | null;
  ai_summary_overview: string | null;
  ai_summary_title: string | null;
  summary_updated_at: string | null;
};

type FileRow = {
  id: string;
  path: string;
  name: string;
  mime: string;
  size_bytes: number;
  kind: "image" | "document" | "audio" | string;
  created_at: string;
  sessionId: string; // which session (guest_call) this file was shared in
};

type Loaded = {
  sessions: SessionRow[];
  project: ProjectRow | null;
  projectName: string;
  customerName: string;
  customerEmail: string | null;
  customerProjects: { id: string; name: string }[];
  totalSessions: number;
  files: FileRow[];
};

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  useRequireEngineerProfile();
  const router = useRouter();
  const [sb] = useState(() => createClient());
  const [data, setData] = useState<Loaded | null>(null);
  // Track which project the loaded data belongs to so `loading` can be derived
  // (navigating project→project changes projectId without remounting).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // Center tabs: the project-level summary, or a specific session's summary
  // (selected from the left sidebar).
  const [tab, setTab] = useState<"project" | "session">("project");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  // Resizable right (AI assistant) pane — drag its left edge to widen/narrow.
  const [rightWidth, setRightWidth] = useState(384);
  // Mobile: the desktop AI panel is hidden, so a FAB opens it as a full-screen
  // overlay instead.
  const [mobileAiOpen, setMobileAiOpen] = useState(false);
  const draggingRight = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRight.current) return;
      setRightWidth(
        Math.min(760, Math.max(320, window.innerWidth - e.clientX))
      );
    };
    const onUp = () => {
      if (!draggingRight.current) return;
      draggingRight.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Every session in this project (also the source of customer identity).
      const { data: sessRaw } = await sb
        .from("guest_calls")
        .select(
          "id, guest_name, guest_email, status, created_at, duration_minutes, ai_summary_title, ai_summary_overview, summary, ai_next_steps, agent_name, customer_user_id, project_id, project_name"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      const sessions = (sessRaw ?? []) as SessionRow[];

      // 2. Project row (name + fallback summary).
      const { data: proj } = await sb
        .from("projects")
        .select(
          "id, name, summary, ai_summary_overview, ai_summary_title, summary_updated_at"
        )
        .eq("id", projectId)
        .maybeSingle();

      const customerId = sessions[0]?.customer_user_id ?? null;
      const customerName = sessions[0]?.guest_name ?? "Customer";
      const customerEmail = sessions[0]?.guest_email ?? null;
      const projectName =
        (proj as ProjectRow | null)?.name ??
        sessions[0]?.project_name ??
        "Project";

      // 3. The customer's other projects (for the switcher) + total sessions.
      let customerProjects: { id: string; name: string }[] = [];
      let totalSessions = sessions.length;
      if (customerId) {
        const { data: all } = await sb
          .from("guest_calls")
          .select("id, project_id, project_name")
          .eq("customer_user_id", customerId);
        const rows = (all ?? []) as {
          id: string;
          project_id: string | null;
          project_name: string | null;
        }[];
        totalSessions = rows.length;
        const map = new Map<string, string>();
        for (const r of rows) {
          if (!r.project_id) continue;
          if (!map.has(r.project_id))
            map.set(r.project_id, r.project_name ?? "Untitled project");
        }
        customerProjects = Array.from(map, ([id, name]) => ({ id, name }));
      }

      // 4. Files across ALL the project's sessions (guest_message_attachments
      //    joined to guest_messages by session). Dedup by id.
      let files: FileRow[] = [];
      const sessionIds = sessions.map((s) => s.id);
      if (sessionIds.length > 0) {
        const { data: fr } = await sb
          .from("guest_message_attachments")
          .select(
            "id, path, name, mime, size_bytes, kind, created_at, guest_messages!inner(guest_call_id)"
          )
          .in("guest_messages.guest_call_id", sessionIds);
        type RawFile = {
          id: string;
          path: string;
          name: string;
          mime: string;
          size_bytes: number;
          kind: string;
          created_at: string;
          guest_messages?:
            | { guest_call_id?: string }
            | { guest_call_id?: string }[]
            | null;
        };
        const seen = new Set<string>();
        files = ((fr ?? []) as unknown as RawFile[])
          .filter((f) => {
            if (!f.id || seen.has(f.id)) return false;
            seen.add(f.id);
            return true;
          })
          .map((f) => {
            const gm = f.guest_messages;
            const sessionId = Array.isArray(gm)
              ? (gm[0]?.guest_call_id ?? "")
              : (gm?.guest_call_id ?? "");
            return {
              id: f.id,
              path: f.path,
              name: f.name,
              mime: f.mime,
              size_bytes: f.size_bytes,
              kind: f.kind,
              created_at: f.created_at,
              sessionId,
            };
          });
      }

      if (cancelled) return;
      setData({
        sessions,
        project: (proj as ProjectRow | null) ?? null,
        projectName,
        customerName,
        customerEmail,
        customerProjects,
        totalSessions,
        files,
      });
      setLoadedFor(projectId);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, sb]);

  const loading = !data || loadedFor !== projectId;
  if (loading || !data) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: "var(--background)", color: "var(--text-muted)" }}
      >
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const selectedSession =
    data.sessions.find((s) => s.id === selectedSessionId) ?? null;
  // Fall back to the project tab if the selected session is gone (e.g. after a
  // project switch) so we never show an empty session tab.
  const activeTab =
    tab === "session" && selectedSession ? "session" : "project";

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      {/* ── LEFT ─────────────────────────────────────────────── */}
      <ProjectLeftSidebar
        projectId={projectId}
        projectName={data.projectName}
        customerName={data.customerName}
        customerEmail={data.customerEmail}
        customerProjects={data.customerProjects}
        totalSessions={data.totalSessions}
        sessions={data.sessions}
        selectedSessionId={selectedSession?.id ?? null}
        onBack={() => router.push("/inbox")}
        onSelectProject={(id) => router.push(`/staff/project/${id}`)}
        onSelectSession={(id) => {
          setSelectedSessionId(id);
          setTab("session");
        }}
      />

      {/* ── CENTER ───────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
          {/* Tabs — Project summary always; the selected session as a second
              tab once one is picked from the left. */}
          <div
            className="mb-5 flex gap-1 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <CenterTab
              active={activeTab === "project"}
              onClick={() => setTab("project")}
            >
              Project summary
            </CenterTab>
            {selectedSession && (
              <CenterTab
                active={activeTab === "session"}
                onClick={() => setTab("session")}
              >
                {selectedSession.ai_summary_title ?? "Session summary"}
              </CenterTab>
            )}
          </div>

          {activeTab === "session" && selectedSession ? (
            <div className="space-y-5">
              <SessionSummaryCard
                session={selectedSession}
                onOpenFull={() =>
                  router.push(`/session-review/${selectedSession.id}`)
                }
              />
              <DocsCard />
              <FilesPane
                files={data.files.filter(
                  (f) => f.sessionId === selectedSession.id
                )}
                sb={sb}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <ProjectSummaryCard project={data.project} />
              <DocsCard />
              <FilesPane files={data.files} sb={sb} />
            </div>
          )}
        </div>
      </main>

      {/* ── RIGHT (resizable) ────────────────────────────────── */}
      <aside
        className="relative hidden shrink-0 flex-col border-l lg:flex"
        style={{
          width: rightWidth,
          borderColor: "var(--border)",
          background: "var(--surface)",
        }}
      >
        {/* Drag handle on the left edge to stretch the pane. */}
        <div
          aria-hidden
          onMouseDown={() => {
            draggingRight.current = true;
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
          }}
          className="absolute top-0 left-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-[var(--primary-soft)]"
        />
        <ProjectAIAssistant
          projectId={projectId}
          projectName={data.projectName}
        />
      </aside>

      {/* ── Mobile: FAB to open the AI assistant (desktop panel is hidden) ── */}
      {!mobileAiOpen && (
        <button
          type="button"
          onClick={() => setMobileAiOpen(true)}
          aria-label="Open AI project assistant"
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 lg:hidden"
          style={{ background: BRAND_GREEN, color: "#fff" }}
        >
          <Sparkles size={20} />
        </button>
      )}

      {/* ── Mobile: AI assistant as a full-screen sheet ── */}
      {mobileAiOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex flex-col lg:hidden"
          style={{ background: "var(--surface)" }}
        >
          <div
            className="flex shrink-0 items-center justify-between border-b px-4 py-2"
            style={{ borderColor: "var(--border)" }}
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              AI project assistant
            </span>
            <button
              type="button"
              onClick={() => setMobileAiOpen(false)}
              aria-label="Close AI assistant"
              className="inline-flex size-7 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-raised)]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ProjectAIAssistant projectId={projectId} projectName={data.projectName} />
          </div>
        </div>
      )}
    </div>
  );
}

function CenterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="max-w-[220px] truncate px-3 py-2 text-sm font-medium transition-colors"
      style={{
        color: active ? "var(--text)" : "var(--text-muted)",
        borderBottom: `2px solid ${active ? BRAND_GREEN : "transparent"}`,
        marginBottom: "-1px",
      }}
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// LEFT — customer header + project switcher + sessions
// ──────────────────────────────────────────────────────────────────────────
function ProjectLeftSidebar({
  projectId,
  projectName,
  customerName,
  customerEmail,
  customerProjects,
  totalSessions,
  sessions,
  selectedSessionId,
  onBack,
  onSelectProject,
  onSelectSession,
}: {
  projectId: string;
  projectName: string;
  customerName: string;
  customerEmail: string | null;
  customerProjects: { id: string; name: string }[];
  totalSessions: number;
  sessions: SessionRow[];
  selectedSessionId: string | null;
  onBack: () => void;
  onSelectProject: (id: string) => void;
  onSelectSession: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Collapsible on mobile so the center summary is the main view.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (isMobileViewport()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(true);
    }
  }, []);

  if (collapsed) {
    return (
      <aside
        className="flex w-10 shrink-0 flex-col border-r"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand customer / sessions"
          className="flex h-full w-full flex-col items-center justify-start gap-3 px-2 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronRight size={14} />
          <span
            className="select-none text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{ writingMode: "vertical-rl" }}
          >
            Customer
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-r"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      {/* Customer header */}
      <header
        className="border-b px-5 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Merge: escalations branch added the rail-collapse button. */}
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} /> Back to inbox
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Collapse"
            className="rounded-md p-0.5"
            style={{ color: "var(--text-muted)" }}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
        <p
          className="text-[10px] font-semibold tracking-[0.12em] uppercase"
          style={{ color: BRAND_GREEN }}
        >
          Customer
        </p>
        <h1
          className="mt-0.5 truncate text-lg font-semibold"
          style={{
            color: "var(--text)",
            fontFamily: "var(--font-source-serif)",
          }}
        >
          {customerName}
        </h1>
        {customerEmail && (
          <p
            className="truncate text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            {customerEmail}
          </p>
        )}
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
          {customerProjects.length} project
          {customerProjects.length === 1 ? "" : "s"} · {totalSessions} session
          {totalSessions === 1 ? "" : "s"}
        </p>
      </header>

      {/* Project switcher */}
      <div
        className="relative border-b px-3 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
          style={{ borderColor: "var(--border)" }}
        >
          <Folder size={14} style={{ color: BRAND_GREEN }} />
          <span
            className="flex-1 truncate text-[13px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            {projectName}
          </span>
          <ChevronDown
            size={14}
            style={{
              color: "var(--text-muted)",
              transform: menuOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          />
        </button>
        {menuOpen && customerProjects.length > 0 && (
          <div
            className="absolute right-3 left-3 z-10 mt-1 overflow-hidden rounded-lg border shadow-lg"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface)",
            }}
          >
            {customerProjects.map((p) => {
              const active = p.id === projectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (!active) onSelectProject(p.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                  style={{ color: active ? BRAND_GREEN : "var(--text)" }}
                >
                  <Folder
                    size={12}
                    style={{
                      color: active ? BRAND_GREEN : "var(--text-muted)",
                    }}
                  />
                  <span className="flex-1 truncate font-medium">{p.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sessions in this project */}
      <div className="px-5 pt-3 pb-1.5">
        <p
          className="text-[10px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Sessions · {sessions.length}
        </p>
      </div>
      <div className="hide-scrollbar flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p
            className="px-5 py-6 text-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            No sessions in this project yet.
          </p>
        ) : (
          <ul>
            {sessions.map((s) => {
              const active = s.id === selectedSessionId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSession(s.id);
                      // On mobile, collapse so the session summary takes over.
                      if (isMobileViewport()) setCollapsed(true);
                    }}
                    className="relative flex w-full flex-col gap-0.5 border-b px-5 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    style={{
                      borderColor: "var(--border)",
                      background: active
                        ? "color-mix(in srgb, var(--primary) 8%, transparent)"
                        : "transparent",
                    }}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px]"
                        style={{ background: BRAND_GREEN }}
                      />
                    )}
                    <span
                      className="truncate text-[13px]"
                      style={{ color: "var(--text)" }}
                    >
                      {s.ai_summary_title ?? "Session"}
                    </span>
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span className="lowercase">{s.status}</span>
                      {s.duration_minutes != null && (
                        <span>
                          {" "}
                          · {Math.round(Number(s.duration_minutes))}m
                        </span>
                      )}
                      <span>
                        {" "}
                        ·{" "}
                        {new Date(s.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CENTER — project AI summary (PLACEHOLDER for vector/Qdrant wiring)
// ──────────────────────────────────────────────────────────────────────────
function ProjectSummaryCard({ project }: { project: ProjectRow | null }) {
  const [expanded, setExpanded] = useState(false);

  // WIRE-UP: this currently falls back to the stored projects.summary /
  // ai_summary_overview. Replace `summaryText` with the vector/Qdrant-backed
  // project summary when the backend is ready — the read-more UI below stays
  // the same.
  const summaryText = project?.summary ?? project?.ai_summary_overview ?? null;

  return (
    <section
      className="rounded-2xl border p-5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={14} style={{ color: BRAND_GREEN }} />
        <h2
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Project summary
        </h2>
      </div>
      {summaryText ? (
        <>
          <p
            className={`text-[13px] leading-relaxed whitespace-pre-wrap ${expanded ? "" : "line-clamp-4"}`}
            style={{ color: "var(--text)" }}
          >
            {summaryText}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-2 text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ color: BRAND_GREEN }}
          >
            {expanded ? "Show less" : "Read more…"}
          </button>
        </>
      ) : (
        <p
          className="text-[13px] leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          No project summary yet. This is where the AI summary of every
          conversation and session across the project will appear.
        </p>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CENTER — a single session's summary (shown when a session tab is active)
// ──────────────────────────────────────────────────────────────────────────
function nextStepsToStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((it) => {
      if (typeof it === "string") return it;
      if (it && typeof it === "object") {
        const o = it as { text?: unknown; description?: unknown };
        return String(o.text ?? o.description ?? "");
      }
      return String(it);
    })
    .filter((s) => s.trim().length > 0);
}

function SessionSummaryCard({
  session,
  onOpenFull,
}: {
  session: SessionRow;
  onOpenFull: () => void;
}) {
  const overview = session.ai_summary_overview ?? session.summary ?? null;
  const steps = nextStepsToStrings(session.ai_next_steps);
  return (
    <section
      className="rounded-2xl border p-5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: BRAND_GREEN }} />
          <h2
            className="text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Session summary
          </h2>
        </div>
        <button
          type="button"
          onClick={onOpenFull}
          className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          Open full session →
        </button>
      </div>

      {session.ai_summary_title && (
        <h3
          className="mb-1 text-base leading-tight font-semibold"
          style={{
            color: "var(--text)",
            fontFamily: "var(--font-source-serif)",
          }}
        >
          {session.ai_summary_title}
        </h3>
      )}
      <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
        <span className="lowercase">{session.status}</span>
        {session.duration_minutes != null && (
          <span> · {Math.round(Number(session.duration_minutes))}m</span>
        )}
        {session.agent_name && <span> · w/ {session.agent_name}</span>}
        <span>
          {" "}
          ·{" "}
          {new Date(session.created_at).toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </p>

      {overview ? (
        <p
          className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap"
          style={{ color: "var(--text)" }}
        >
          {overview}
        </p>
      ) : (
        <p className="mt-3 text-[13px]" style={{ color: "var(--text-muted)" }}>
          No summary for this session yet.
        </p>
      )}

      {steps.length > 0 && (
        <div className="mt-4">
          <div
            className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Next steps
          </div>
          <ul className="space-y-1">
            {steps.map((step, i) => (
              <li
                key={i}
                className="flex gap-2 text-[13px] leading-relaxed"
                style={{ color: "var(--text)" }}
              >
                <span style={{ color: BRAND_GREEN }}>→</span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CENTER — docs (PLACEHOLDER — content TBD)
// ──────────────────────────────────────────────────────────────────────────
function DocsCard() {
  return (
    <section
      className="rounded-2xl border p-5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <FileText size={14} style={{ color: BRAND_GREEN }} />
        <h2
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Docs
        </h2>
      </div>
      <p
        className="text-[13px] leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        Project documents will appear here.
      </p>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CENTER — files aggregated across all of the project's sessions
// ──────────────────────────────────────────────────────────────────────────
function FilesPane({
  files,
  sb,
}: {
  files: FileRow[];
  sb: ReturnType<typeof createClient>;
}) {
  const groups = useMemo(() => {
    const g: { images: FileRow[]; documents: FileRow[]; audio: FileRow[] } = {
      images: [],
      documents: [],
      audio: [],
    };
    for (const f of files) {
      if (f.kind === "image") g.images.push(f);
      else if (f.kind === "audio") g.audio.push(f);
      else g.documents.push(f);
    }
    return g;
  }, [files]);

  const download = useCallback(
    async (f: FileRow) => {
      const url = await signedDownloadUrl(sb, f.path, f.name);
      if (url) window.location.href = url;
    },
    [sb]
  );

  return (
    <section
      className="rounded-2xl border p-5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Folder size={14} style={{ color: BRAND_GREEN }} />
        <h2
          className="text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Files · {files.length}
        </h2>
      </div>
      {files.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          No files shared yet.
        </p>
      ) : (
        <div className="space-y-4">
          <FileGroup
            label="Images"
            rows={groups.images}
            onDownload={download}
          />
          <FileGroup
            label="Documents"
            rows={groups.documents}
            onDownload={download}
          />
          <FileGroup
            label="Voice notes"
            rows={groups.audio}
            onDownload={download}
          />
        </div>
      )}
    </section>
  );
}

function FileGroup({
  label,
  rows,
  onDownload,
}: {
  label: string;
  rows: FileRow[];
  onDownload: (f: FileRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p
        className="mb-2 text-[10px] font-semibold tracking-wider uppercase"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </p>
      <ul className="space-y-2">
        {rows.map((f) => (
          <li
            key={f.id}
            className="flex items-center gap-3 rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          >
            <FileKindIcon kind={f.kind} mime={f.mime} />
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[13px]"
                style={{ color: "var(--text)" }}
              >
                {f.name}
              </div>
              <div
                className="text-[11px]"
                style={{ color: "var(--text-faint)" }}
              >
                {(f.size_bytes / 1024).toFixed(0)} KB
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDownload(f)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-muted)",
              }}
            >
              <Download size={12} /> Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileKindIcon({ kind, mime }: { kind: string; mime: string }) {
  const box = (icon: React.ReactNode): React.ReactElement => (
    <span
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg"
      style={{
        background: "var(--primary-tint)",
        color: "var(--primary-hover)",
      }}
    >
      {icon}
    </span>
  );
  if (kind === "image") return box(<ImageIcon size={16} />);
  if (kind === "audio") return box(<PlayCircle size={16} />);
  if (/sheet|excel|csv/.test(mime)) return box(<FileSpreadsheet size={16} />);
  return box(<FileText size={16} />);
}
