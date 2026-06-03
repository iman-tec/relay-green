"use client";

/*
 * Session review — three-column layout shared by engineers (from /inbox)
 * and customers (from project history).
 *
 *   LEFT (280 px)   — customer header + accordion of all their projects
 *                     with sessions nested underneath. Click a session
 *                     to navigate to /session-review/[id].
 *   CENTER (flex)   — AI summary + files + read-only chat transcript for
 *                     the currently-viewed session.
 *   RIGHT (360 px)  — persistent chat. Reads + writes guest_messages on
 *                     this session row. Lets the engineer drop a follow-
 *                     up message or file to the customer even after the
 *                     live call ended — WhatsApp-style "message on a past
 *                     call" affordance.
 *
 * Data fetches are client-side. RLS gates per-row access; queries silently
 * return the empty set if the viewer shouldn't see it.
 *
 * The right-pane composer reuses the existing chatAttachments helpers
 * (uploadAttachment / classify / accepted MIME / size caps) so file
 * handling matches the live in-call composer exactly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, AudioLines, Check, ChevronDown, ChevronRight, Download, FileText,
  FileSpreadsheet, FileType, Folder, Image as ImageIcon, Loader2, Lock,
  MessageSquare, Mic, MoreHorizontal, Paperclip, Pencil, PlayCircle, Send,
  Sparkles, Video, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import {
  classify, MAX_BYTES, MAX_FILES_PER_MESSAGE,
  signedDownloadUrl, uploadOne,
} from "@/lib/relay/chatAttachments";
import { isAiSummaryMessageBody } from "@/app/_components/MeetingSummaryEntry";
import { MessageAttachments } from "@/app/_components/MessageAttachments";
import { ProjectAIAssistant } from "@/app/_components/ProjectAIAssistant";
import { queryMicPermission, speechRecognitionErrorMessage } from "@/app/_components/ChatComposer";
import type { GuestCall, GuestMessage, GuestMessageAttachment } from "@/lib/supabase/types";

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

// "Guest" is the legacy DB default for un-named customer rows. Surface
// them as "Customer" for the engineer / supervisor reading the page.
function displayCustomerName(raw: string | null | undefined): string {
  if (!raw) return "Customer";
  const t = raw.trim();
  if (!t || t.toLowerCase() === "guest") return "Customer";
  return t;
}

// ── Project tree row shapes ────────────────────────────────────────────
type ProjectRow = {
  id: string;
  name: string;
  contract_type: string | null;
  completion_status: string | null;
};
type SessionRow = {
  id: string;
  status: string;
  created_at: string;
  ai_summary_title: string | null;
  duration_minutes: number | null;
};

export function SessionReviewClient({
  sessionId,
  initialSession,
}: {
  sessionId: string;
  initialSession: GuestCall;
}) {
  const router = useRouter();
  const [session] = useState<GuestCall>(initialSession);
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Project tree state (left pane).
  const [tree, setTree] = useState<Array<ProjectRow & { sessions: SessionRow[] }>>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Current viewer identity — used by the right-pane composer so inserted
  // rows are stamped with the correct sender_kind / sender_id. Mirrors the
  // pattern used by EngineerSessionClient + RoomClient.
  const [me, setMe] = useState<{ id: string; email: string | null; name: string | null; kind: "engineer" | "guest" | "system" } | null>(null);

  // ── Load messages + viewer identity ──────────────────────────────────
  useEffect(() => {
    let alive = true;
    void (async () => {
      const sb = createClient();
      // Embed via the FK on guest_message_attachments.message_id → guest_messages.id.
      const [msgRes, userRes] = await Promise.all([
        sb.from("guest_messages")
          .select("*, attachments:guest_message_attachments(*)")
          .eq("guest_call_id", sessionId)
          .order("created_at", { ascending: true }),
        sb.auth.getUser(),
      ]);
      if (!alive) return;
      if (msgRes.error) setError(msgRes.error.message);
      else setMessages((msgRes.data ?? []) as unknown as GuestMessage[]);

      const u = userRes.data.user;
      if (u) {
        // Decide whether this viewer is the engineer or the customer on
        // this call. Anyone else (supervisor/admin) defaults to engineer
        // semantics on send — they're acting in a staff capacity.
        const isCustomer = !!session.customer_user_id && session.customer_user_id === u.id;
        const profileRes = await sb
          .from("profiles")
          .select("full_name")
          .eq("id", u.id)
          .maybeSingle();
        if (!alive) return;
        const full = (profileRes.data as { full_name?: string | null } | null)?.full_name ?? null;
        setMe({
          id: u.id,
          email: u.email ?? null,
          name: full,
          kind: isCustomer ? "guest" : "engineer",
        });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [sessionId, session.customer_user_id]);

  // ── Realtime tail on this session's messages ─────────────────────────
  // Lets either party see a post-call follow-up land immediately, without
  // a manual refresh.
  useEffect(() => {
    const sb = createClient();
    // Effect-scoped alive flag — guards the async attachment fetch in
    // the INSERT branch below. Without this, if the user navigates away
    // during the round-trip, setMessages fires on a dead component.
    let alive = true;
    // Per-mount UUID suffix on the channel name so two tabs of the same
    // /session-review URL don't trip Supabase's name-based dedupe (which
    // would throw "cannot add postgres_changes after subscribe()" on the
    // second tab's .on() call).
    const suffix = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`session-review-msgs-${sessionId}-${suffix}`)
      .on(
        "postgres_changes",
        // event=* picks up INSERTs (new follow-up messages), UPDATEs (the
        // author editing body / setting edited_at / soft-deleting via
        // deleted_at), and DELETEs (hard-delete via retention sweeper).
        // The handler routes each event type to the appropriate state
        // transition so both parties see edits + deletes in realtime.
        { event: "*", schema: "public", table: "guest_messages", filter: `guest_call_id=eq.${sessionId}` },
        async (payload) => {
          if (!alive) return;
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string } | null;
            if (old?.id) setMessages((prev) => prev.filter((m) => m.id !== old.id));
            return;
          }
          const row = payload.new as GuestMessage;
          if (!row?.id) return;
          if (payload.eventType === "UPDATE") {
            // Edit / soft-delete — merge the new fields into the existing
            // row; attachments don't change on UPDATE so we keep the
            // previously-loaded list.
            setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row, attachments: m.attachments } : m)));
            return;
          }
          // INSERT — fetch attachments for this single row (realtime
          // payload doesn't include them; cheap query, usually 0–1 rows).
          const { data: atts } = await sb
            .from("guest_message_attachments")
            .select("*")
            .eq("message_id", row.id);
          if (!alive) return;
          const enriched: GuestMessage = {
            ...row,
            attachments: ((atts ?? []) as GuestMessageAttachment[]),
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === enriched.id)) return prev;
            return [...prev, enriched];
          });
        },
      )
      .subscribe();
    return () => {
      alive = false;
      sb.removeChannel(ch);
    };
  }, [sessionId]);

  // ── Load the customer's project tree ─────────────────────────────────
  useEffect(() => {
    const customerId = session.customer_user_id;
    if (!customerId) {
      setTreeLoading(false);
      return;
    }
    let alive = true;
    void (async () => {
      const sb = createClient();
      const { data: projects, error: pErr } = await sb
        .from("projects")
        .select("id, name, contract_type, completion_status")
        .eq("customer_user_id", customerId)
        .order("created_at", { ascending: false });
      if (!alive) return;
      if (pErr || !projects) {
        setTreeLoading(false);
        return;
      }
      const projList = projects as ProjectRow[];
      const projIds = projList.map((p) => p.id);

      // One pass to fetch every session under any of these projects.
      // Cheaper than per-project; usually < 100 rows total per customer.
      let sessionsByProject = new Map<string, SessionRow[]>();
      if (projIds.length > 0) {
        const { data: sess } = await sb
          .from("guest_calls")
          .select("id, status, created_at, ai_summary_title, duration_minutes, project_id")
          .in("project_id", projIds)
          .order("created_at", { ascending: false });
        if (!alive) return;
        sessionsByProject = new Map();
        for (const s of (sess ?? []) as Array<SessionRow & { project_id: string | null }>) {
          if (!s.project_id) continue;
          const list = sessionsByProject.get(s.project_id) ?? [];
          list.push(s);
          sessionsByProject.set(s.project_id, list);
        }
      }

      setTree(projList.map((p) => ({ ...p, sessions: sessionsByProject.get(p.id) ?? [] })));
      // Auto-expand the project containing the currently-viewed session
      // so the user can see siblings immediately.
      const myProj = session.project_id;
      if (myProj) setExpanded({ [myProj]: true });
      setTreeLoading(false);
    })();
    return () => { alive = false; };
  }, [session.customer_user_id, session.project_id]);

  // Aggregate all attachments across the conversation — deduped by id
  // because PostgREST sometimes returns the same row twice when the join
  // walks via multiple parent rows.
  const allFiles = useMemo(() => {
    const seen = new Set<string>();
    const files: GuestMessageAttachment[] = [];
    for (const m of messages) {
      if (!m.attachments) continue;
      for (const a of m.attachments) {
        if (!a.id || seen.has(a.id)) continue;
        seen.add(a.id);
        files.push(a);
      }
    }
    return files;
  }, [messages]);

  const downloadTranscript = () => {
    const lines: string[] = [];
    lines.push("Relay session transcript");
    lines.push(`Customer: ${displayCustomerName(session.guest_name)}${session.project_name ? ` · ${session.project_name}` : ""}`);
    lines.push(`Engineer: ${session.agent_name ?? "—"}`);
    lines.push(`Date: ${new Date(session.created_at).toLocaleString()}`);
    if (session.duration_minutes != null) {
      lines.push(`Duration: ${Math.round(Number(session.duration_minutes))} min`);
    }
    lines.push(`Status: ${session.status}`);
    lines.push("");
    lines.push("--- conversation ---");
    lines.push("");
    for (const m of messages) {
      if (m.sender_kind === "system") {
        const body = m.body ?? "";
        if (body.includes("Zoom meeting started")) continue;
        if (body.includes("Zoom meeting ended")) continue;
        if (body.includes("Recording available")) continue;
        if (isAiSummaryMessageBody(body)) continue;
      }
      const ts = new Date(m.created_at).toLocaleString();
      const who = m.sender_kind === "engineer"
        ? `Engineer${m.sender_name ? ` (${m.sender_name})` : ""}`
        : m.sender_kind === "guest"
          ? `Customer${m.sender_name ? ` (${m.sender_name})` : ""}`
          : "System";
      lines.push(`[${ts}] ${who}:`);
      if (m.body && m.body.trim()) {
        for (const line of m.body.split(/\r?\n/)) lines.push(`  ${line}`);
      }
      if (m.attachments && m.attachments.length > 0) {
        for (const a of m.attachments) lines.push(`  [attachment] ${a.name}`);
      }
      lines.push("");
    }
    const text = lines.join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const tsStamp = new Date(session.created_at).toISOString().slice(0, 10);
    const slug = (session.guest_name ?? "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    a.download = `relay-transcript-${tsStamp}-${slug}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const customerName = displayCustomerName(session.guest_name);
  const isLive = ["assigned", "joining", "live", "grace", "expired_free"].includes(session.status);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Top bar with Back nav + session title — sits above the columns
          so the user always has a return path regardless of which pane
          they're scrolling. */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-2.5"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-opacity hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: BRAND_GREEN }}>
            Session review
          </div>
          <div className="truncate text-[14px] font-semibold" style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}>
            {session.ai_summary_title ?? session.project_name ?? "Session"}
          </div>
        </div>
        {isLive && (
          <button
            type="button"
            onClick={() => router.push(`/staff/session/${session.id}`)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--warn, #d4a017)" }}
          >
            <Video size={11} />
            Open live room
          </button>
        )}
      </div>

      {/* Three-column body. Left + right are fixed-width; center fills
          the remaining space. On narrow viewports the columns stack;
          we ship the desktop-first layout because session-review is an
          engineer/supervisor workflow where wide displays dominate. */}
      <div className="flex">
        <ProjectTreePane
          customerName={customerName}
          customerEmail={session.guest_email}
          tree={tree}
          loading={treeLoading}
          expanded={expanded}
          onToggleExpand={(projectId) =>
            setExpanded((prev) => ({ ...prev, [projectId]: !prev[projectId] }))
          }
          activeSessionId={sessionId}
        />

        <main className="min-w-0 flex-1 px-5 py-5">
          <SummaryBlock session={session} />
          <FilesBlock files={allFiles} />
          <TranscriptBlock
            messages={messages}
            loading={loading}
            error={error}
            onDownload={downloadTranscript}
          />

          {/* AI project assistant — lets the engineer (or customer)
              ask natural-language questions about this project after
              the call. The same component used in the active-session
              right rail (EngineerSessionClient → MainPane). Wrapped
              in a fixed-height card here because the center column
              flows vertically; the component is internally a flex
              column that needs a bounded parent to render the
              scrollable thread + pinned composer correctly. */}
          {session.project_id && (
            <div
              className="mt-5 overflow-hidden rounded-2xl border"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", height: 480 }}
            >
              <ProjectAIAssistant
                projectId={session.project_id}
                projectName={session.project_name ?? null}
              />
            </div>
          )}
        </main>

        <ChatPane
          sessionId={sessionId}
          messages={messages}
          loading={loading}
          me={me}
          customerName={customerName}
          sessionStatus={session.status}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ProjectTreePane — left sidebar showing every project this customer has,
// with their sessions nested underneath. Mirrors the customer's own past-
// sessions browser so the engineer sees the same shape of "what work has
// this customer had with us" as the customer sees on their side.
// ─────────────────────────────────────────────────────────────────────────
function ProjectTreePane({
  customerName, customerEmail, tree, loading, expanded, onToggleExpand, activeSessionId,
}: {
  customerName: string;
  customerEmail: string | null;
  tree: Array<ProjectRow & { sessions: SessionRow[] }>;
  loading: boolean;
  expanded: Record<string, boolean>;
  onToggleExpand: (projectId: string) => void;
  activeSessionId: string;
}) {
  const router = useRouter();

  const totalSessions = tree.reduce((sum, p) => sum + p.sessions.length, 0);

  return (
    <aside
      className="hidden h-[calc(100vh-45px)] w-[280px] shrink-0 flex-col overflow-hidden border-r md:flex"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Customer header */}
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: BRAND_GREEN }}>
          Customer
        </div>
        <div
          className="mt-0.5 truncate text-[15px] font-semibold leading-tight"
          style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
          title={customerName}
        >
          {customerName}
        </div>
        {customerEmail && (
          <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }} title={customerEmail}>
            {customerEmail}
          </div>
        )}
        {!loading && (
          <div className="mt-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>
            {tree.length} project{tree.length === 1 ? "" : "s"} · {totalSessions} session{totalSessions === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {/* Tree body */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={12} className="animate-spin" /> Loading projects…
          </div>
        ) : tree.length === 0 ? (
          <p className="px-2 py-3 text-[12px]" style={{ color: "var(--text-faint)" }}>
            No projects on file for this customer yet.
          </p>
        ) : (
          tree.map((p) => {
            const isOpen = !!expanded[p.id];
            return (
              <div key={p.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => onToggleExpand(p.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {isOpen
                    ? <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
                    : <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />}
                  <Folder size={12} style={{ color: BRAND_GREEN }} />
                  <span className="min-w-0 flex-1 truncate font-medium" style={{ color: "var(--text)" }}>
                    {p.name}
                  </span>
                  {p.sessions.length > 0 && (
                    <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {p.sessions.length}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <ul className="ml-3 mt-0.5 border-l pl-2" style={{ borderColor: "var(--border)" }}>
                    {p.sessions.length === 0 ? (
                      <li className="px-2 py-1 text-[10px]" style={{ color: "var(--text-faint)" }}>
                        No sessions yet.
                      </li>
                    ) : (
                      p.sessions.map((s) => {
                        const isActive = s.id === activeSessionId;
                        const label = s.ai_summary_title?.trim()
                          ? s.ai_summary_title
                          : `Session · ${new Date(s.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}`;
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => {
                                if (!isActive) router.push(`/session-review/${s.id}`);
                              }}
                              className="flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                              style={{
                                backgroundColor: isActive ? BRAND_GREEN_SOFT : "transparent",
                                color: isActive ? BRAND_GREEN : "var(--text)",
                                fontWeight: isActive ? 600 : 400,
                              }}
                            >
                              <span
                                className="mt-1 size-1.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: isActive
                                    ? BRAND_GREEN
                                    : s.status === "ended"
                                      ? "var(--text-muted)"
                                      : "var(--warn, #d4a017)",
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{label}</div>
                                <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                                  {new Date(s.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                                  {s.duration_minutes != null && ` · ${Math.round(Number(s.duration_minutes))}m`}
                                  {" · "}{s.status}
                                </div>
                              </div>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ChatPane — right column. Reads + writes guest_messages for this session
// so the engineer can drop a follow-up message or file even after the
// live call ended. Reuses the chatAttachments helpers (classify + upload
// + size caps) so the wire format matches the in-call composer.
// ─────────────────────────────────────────────────────────────────────────
function ChatPane({
  sessionId, messages, loading, me, customerName, sessionStatus,
}: {
  sessionId: string;
  messages: GuestMessage[];
  loading: boolean;
  me: { id: string; email: string | null; name: string | null; kind: "engineer" | "guest" | "system" } | null;
  customerName: string;
  /** Session status — drives the read-only lock. An ended/cancelled/
   *  abandoned session is a closed record: viewable, but no new follow-up
   *  chat (the composer is replaced with a read-only notice). */
  sessionStatus: string;
}) {
  const isEndedSession = ["ended", "cancelled", "abandoned"].includes(sessionStatus);
  // Filter out system noise from the chat view (Zoom started/ended/recording
  // stubs and AI summary bubbles) and soft-deleted messages (deleted_at set
  // by the author via the kebab → Delete action). Those belong in the
  // center-pane summary, not in a WhatsApp-style threaded chat.
  const visible = useMemo(() => {
    return messages.filter((m) => {
      if (m.deleted_at) return false;
      if (m.sender_kind !== "system") return true;
      const body = m.body ?? "";
      if (body.includes("Zoom meeting started")) return false;
      if (body.includes("Zoom meeting ended")) return false;
      if (body.includes("Recording available")) return false;
      if (isAiSummaryMessageBody(body)) return false;
      return true;
    });
  }, [messages]);

  // Composer state
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mounted flag — guards async callbacks (realtime INSERT attachment
  // fetch, MediaRecorder onstop) so they don't setState on a dead
  // component when the user navigates away mid-flight.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Voice dictation (Web Speech API) ───────────────────────────────
  // Mic button ports the customer-side dictation flow: tap to start,
  // interim results stream into the composer textarea, tap again to
  // stop. The base text the user had typed before starting is captured
  // in transcribeBaseRef so subsequent results append rather than
  // replace.
  const [voiceMode, setVoiceMode] = useState<"idle" | "transcribing">("idle");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const recognitionRef = useRef<{ abort: () => void; stop: () => void } | null>(null);
  const transcribeBaseRef = useRef<string>("");

  // ── Voice recording (MediaRecorder) ────────────────────────────────
  // AudioLines button captures an audio blob, names it voice-<ts>.<ext>,
  // and pushes it into pendingFiles so the next Send uploads it just
  // like a paperclip-staged file.
  const [recState, setRecState] = useState<"idle" | "recording">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);

  const startTranscribe = useCallback(async () => {
    if (voiceMode !== "idle") return;
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceMsg("Voice-to-text isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    setVoiceMsg(null);

    // Detect a previous "denied" before getUserMedia silently fails.
    const permState = await queryMicPermission();
    if (permState === "denied") {
      setVoiceMsg("Microphone is blocked for this site. Click the lock / info icon at the very left of the address bar → Site settings → Microphone → Allow → reload the page.");
      return;
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError") {
          setVoiceMsg("You dismissed the microphone prompt. Click the mic icon again and choose Allow when your browser asks.");
        } else if (e instanceof Error && e.name === "NotFoundError") {
          setVoiceMsg("No microphone detected. Check that one is plugged in and not being used by another app.");
        } else {
          setVoiceMsg("Couldn't access your microphone.");
        }
        return;
      }
    }

    const r = new Ctor();
    transcribeBaseRef.current = text;
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      const composed = [transcribeBaseRef.current, finalText, interim]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      setText(composed);
    };
    r.onerror = (e: { error: string }) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setVoiceMsg(speechRecognitionErrorMessage(e.error));
      }
      setVoiceMode("idle");
    };
    r.onend = () => {
      setVoiceMode("idle");
      recognitionRef.current = null;
    };
    recognitionRef.current = r;
    setVoiceMode("transcribing");
    try { r.start(); } catch {
      setVoiceMsg("Voice recognition couldn't start — try again in a moment.");
      setVoiceMode("idle");
    }
  }, [voiceMode, text]);

  const stopTranscribe = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
  }, []);

  const startRecording = useCallback(async () => {
    if (recState !== "idle") return;
    if (typeof window === "undefined" || !("MediaRecorder" in window)) {
      setVoiceMsg("Voice recording isn't supported in this browser.");
      return;
    }
    setVoiceMsg(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setVoiceMsg("Microphone access blocked. Click the lock icon in your browser's address bar, allow microphone, then try again.");
      } else if (e instanceof Error && e.name === "NotFoundError") {
        setVoiceMsg("No microphone detected. Check that one is plugged in and not being used by another app.");
      } else {
        setVoiceMsg("Couldn't access your microphone.");
      }
      return;
    }
    recorderStreamRef.current = stream;

    // MIME pick — Chrome/Firefox produce webm/opus, Safari produces mp4.
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    let mime: string | undefined;
    for (const c of candidates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((MediaRecorder as any).isTypeSupported?.(c)) { mime = c; break; }
    }
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

    recorderChunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(recorderChunksRef.current, { type: rec.mimeType || "audio/webm" });
      recorderChunksRef.current = [];
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderStreamRef.current = null;
      recorderRef.current = null;
      // Bail if the component has unmounted between stop() and onstop —
      // MediaRecorder.stop() is async-ish and the handler can fire after
      // teardown. Guarding the setState calls prevents the "state update
      // on unmounted component" warning + potential stale state writes.
      if (!mountedRef.current) return;
      setRecState("idle");
      const t = rec.mimeType || "audio/webm";
      const ext = t.includes("webm") ? "webm" : t.includes("mp4") ? "m4a" : t.includes("ogg") ? "ogg" : "webm";
      const name = `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      // Stage the recording into pendingFiles so it ships on the next Send.
      // No size check needed here — opus/aac MediaRecorder blobs run
      // ~1 MB per 10 minutes, comfortably under the 10 MB cap for any
      // realistic voice-note duration.
      setPendingFiles((prev) => [...prev, file]);
    };
    rec.onerror = () => {
      setVoiceMsg("Recording failed — try again.");
      setRecState("idle");
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderStreamRef.current = null;
      recorderRef.current = null;
    };
    recorderRef.current = rec;
    setRecState("recording");
    rec.start();
  }, [recState]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (!r) { setRecState("idle"); return; }
    try { r.stop(); } catch { /* already stopping */ }
  }, []);

  // Tear-down on unmount so an abandoned mic stream doesn't keep listening.
  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // ── Per-bubble menu + inline edit state ───────────────────────────
  // Matches customer-side ChatPanelStub: only one bubble can have its
  // kebab menu open at a time, and only one can be in edit mode at a
  // time, so the user doesn't lose track of partial-edit context.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [mutateError, setMutateError] = useState<string | null>(null);

  const handleStartEdit = useCallback((id: string, currentBody: string) => {
    setEditingId(id);
    setEditText(currentBody);
    setOpenMenuId(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    const id = editingId;
    const newBody = editText;
    const sb = createClient();
    const { error: e } = await sb
      .from("guest_messages")
      .update({ body: newBody, edited_at: new Date().toISOString() })
      .eq("id", id);
    if (e) {
      // Author-only UPDATE policy comes from migration 20260527210000.
      // Until that's applied, the UPDATE returns a permission error;
      // surface it AND keep the edit textarea open so the user can
      // retry or cancel without losing what they typed. Clearing the
      // edit state on failure (the old behaviour) would force them to
      // re-open the kebab and re-type the whole edit — frustrating UX
      // for a transient permission/network error.
      setMutateError(`Couldn't save edit: ${e.message}`);
      setTimeout(() => setMutateError(null), 4000);
      return;
    }
    setEditingId(null);
    setEditText("");
  }, [editingId, editText]);

  const handleDeleteMessage = useCallback(async (id: string) => {
    setOpenMenuId(null);
    const sb = createClient();
    // Soft-delete: set deleted_at so realtime listeners on both sides
    // hide the row. We keep the row so future audit / forensics has the
    // history. A real hard-delete (DELETE row) is allowed by the
    // author-only policy too, for cleanup tooling.
    const { error: e } = await sb
      .from("guest_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (e) {
      setMutateError(`Couldn't delete: ${e.message}`);
      setTimeout(() => setMutateError(null), 4000);
    }
  }, []);

  // Close any open kebab menu when the user clicks outside it. Match
  // customer-side: a pointerdown anywhere outside dismisses the menu.
  useEffect(() => {
    if (!openMenuId) return;
    const onDown = () => setOpenMenuId(null);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openMenuId]);

  // Stick to bottom whenever new messages land. Quick win — no IO observer
  // needed since the pane is bounded and contents only grow.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible.length]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    // Pre-flight: enforce the same caps the live composer does
    // (10 MB per file, 3 files total per message — any kind).
    let total = pendingFiles.length;
    const accepted: File[] = [];
    for (const f of all) {
      const kind = classify(f);
      if (!kind) { setSendError(`Unsupported file: ${f.name}`); continue; }
      if (f.size > MAX_BYTES) { setSendError(`${f.name} is larger than 10 MB.`); continue; }
      if (total >= MAX_FILES_PER_MESSAGE) {
        setSendError(`At most ${MAX_FILES_PER_MESSAGE} files per message.`);
        continue;
      }
      total += 1;
      accepted.push(f);
    }
    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted]);
      setSendError(null);
    }
  }, [pendingFiles]);

  const removePending = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const send = useCallback(async () => {
    const body = text.trim();
    if (sending) return;
    if (!body && pendingFiles.length === 0) return;
    if (!me) { setSendError("Not signed in."); return; }

    setSending(true);
    setSendError(null);
    try {
      const sb = createClient();
      // 1. Upload all attachments to storage first. If any fail we bail
      //    BEFORE inserting the message so we don't leave a body-only row
      //    behind that the user thinks failed to attach files. Mirrors
      //    the live-session composer flow in useEngineerSession.
      const classified = pendingFiles
        .map((f) => ({ file: f, kind: classify(f) }))
        .filter((c): c is { file: File; kind: "image" | "document" | "audio" } => c.kind != null);
      const uploaded = await Promise.all(
        classified.map((c) => uploadOne({ sb, sessionId, file: c.file, kind: c.kind })),
      );

      // 2. Insert the message row.
      const { data: msgRow, error: insErr } = await sb
        .from("guest_messages")
        .insert({
          guest_call_id: sessionId,
          sender_kind: me.kind,
          sender_id: me.id,
          sender_name: me.name ?? me.email ?? null,
          body: body || null,
        })
        .select("id")
        .single();
      if (insErr || !msgRow) {
        setSendError(insErr?.message ?? "Send failed.");
        return;
      }
      const messageId = (msgRow as { id: string }).id;

      // 3. Bind the uploaded objects to the message via guest_message_attachments.
      if (uploaded.length > 0) {
        const rows = uploaded.map((u) => ({
          message_id: messageId,
          path: u.path,
          name: u.name,
          mime: u.mime,
          size_bytes: u.size,
          kind: u.kind,
        }));
        const { error: aErr } = await sb.from("guest_message_attachments").insert(rows);
        if (aErr) setSendError(aErr.message);
      }

      // 4. Clear the composer; realtime will land the message itself.
      setText("");
      setPendingFiles([]);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [text, sending, pendingFiles, me, sessionId]);

  // Header copy mirrors the customer-side ChatPanelStub naming. From
  // the engineer's POV they're "chatting with <customerName>"; the
  // customer's POV reads "chatting with <engineer>" if we ever wire
  // the customer's session-review through this same component.
  const isCustomerViewer = me?.kind === "guest";
  const otherPartyName = isCustomerViewer
    ? "your engineer"
    : customerName;
  const headerTitle = isEndedSession
    ? "Conversation"
    : isCustomerViewer
      ? "Engineer chat"
      : `Chatting with ${customerName}`;
  const headerSubtitle = isEndedSession
    ? "Session ended · read-only"
    : "Drop a follow-up";
  const placeholder = isCustomerViewer
    ? "Message your engineer…"
    : `Message ${customerName}…`;
  const emptyCopy = isEndedSession
    ? "This session has ended — the conversation is read-only."
    : isCustomerViewer
      ? "Drop in your thoughts here — your engineer sees them next time they open the session."
      : `Drop a follow-up here — ${otherPartyName} sees it next time they open the session.`;

  // Initial-letter avatar used in the header. Falls back to the chat
  // bubble icon when we don't have a name yet (e.g. anonymous guest).
  const avatarInitial = customerName !== "Customer" ? customerName[0]?.toUpperCase() : null;

  return (
    <aside
      className="hidden h-[calc(100vh-45px)] w-[360px] shrink-0 flex-col overflow-hidden border-l md:flex"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Header — mirrors RoomClient.ChatPanelStub: avatar circle on the
          left, title + subtitle stacked, no collapse toggle (the
          session-review layout doesn't collapse panels in this iteration). */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ backgroundColor: "var(--surface-raised)", color: "var(--text-muted)" }}
        >
          {avatarInitial ?? <MessageSquare size={14} />}
        </div>
        <div className="flex min-w-0 flex-col">
          <span
            className="truncate text-[13px] font-medium"
            style={{ color: "var(--text)" }}
          >
            {headerTitle}
          </span>
          <span
            className="inline-flex items-center gap-1 truncate text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {headerSubtitle}
          </span>
        </div>
      </div>

      {/* Conversation area — dotted radial background matches the
          customer-side panel so the two surfaces read as siblings. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto px-3 py-4"
          style={{
            backgroundColor: "var(--background)",
            backgroundImage:
              "radial-gradient(circle, color-mix(in srgb, var(--text) 4%, transparent) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={12} className="animate-spin" /> Loading messages…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-3 text-center">
              <div
                className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
                  color: "var(--text-muted)",
                }}
              >
                <Lock size={18} />
              </div>
              <p
                className="max-w-[220px] text-[12px] leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                {emptyCopy}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pb-2">
              {mutateError && (
                <div
                  className="mx-auto rounded-full border px-2.5 py-1 text-[10px]"
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                    backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
                    color: "var(--accent-red)",
                  }}
                >
                  {mutateError}
                </div>
              )}
              {visible.map((m, idx) => {
                const prev = idx > 0 ? visible[idx - 1] : null;
                const showSeparator =
                  !prev ||
                  !sameDay(
                    new Date(prev.created_at).getTime(),
                    new Date(m.created_at).getTime(),
                  );
                return (
                  <div key={m.id}>
                    {showSeparator && (
                      <DateSeparatorPill ts={new Date(m.created_at).getTime()} />
                    )}
                    <ChatBubble
                      message={m}
                      viewerKind={me?.kind ?? null}
                      menuOpen={openMenuId === m.id}
                      editing={editingId === m.id}
                      editText={editText}
                      onEditTextChange={setEditText}
                      onOpenMenu={() => setOpenMenuId(m.id)}
                      onCloseMenu={() => setOpenMenuId(null)}
                      onStartEdit={() => handleStartEdit(m.id, m.body ?? "")}
                      onSaveEdit={handleSaveEdit}
                      onCancelEdit={handleCancelEdit}
                      onDelete={() => handleDeleteMessage(m.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Ended sessions are a closed record — the follow-up composer is
          replaced with a read-only notice (matches the customer room and
          the engineer session room). */}
      {isEndedSession && (
        <div
          className="shrink-0 border-t px-3 py-4"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
        >
          <div
            className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[11px] font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <Lock size={11} />
            Session ended — read-only
          </div>
        </div>
      )}

      {/* Composer — card-style block matching the customer side:
          multi-line textarea on top, action row underneath with paperclip
          (attach), mic (voice dictation placeholder), audio-lines (voice
          message placeholder), and a labelled Send pill on the right.
          Hidden once the session has ended (read-only notice above). */}
      {!isEndedSession && (
      <div
        className="shrink-0 border-t px-3 py-5"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div
          className="rounded-2xl border p-5"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <textarea
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Plain Enter sends — matches the customer composer and
              // the live in-call ChatComposer so engineers build the
              // same muscle memory across surfaces. Shift+Enter for
              // newlines. IME composition passes through untouched.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={placeholder}
            // rows={14} matches the customer-side ChatPanelStub composer
            // size — large empty area that invites a substantive message
            // rather than a Twitter-length quick reply.
            className="block w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:opacity-60"
            style={{ color: "var(--text)" }}
          />

          {/* Pending-attachments tray — each staged file shown as a chip
              with a remove-X. Layout matches the customer's pre-flush
              tray so the engineer's mental model carries over. */}
          {pendingFiles.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Will be delivered with your next send
              </div>
              <ul className="flex flex-col gap-1">
                {pendingFiles.map((f, i) => {
                  const kind = classify(f);
                  const Icon = kind === "audio" ? PlayCircle : kind === "image" ? ImageIcon : FileText;
                  return (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11.5px]"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
                      >
                        <Icon size={11} />
                      </span>
                      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>{f.name}</span>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {f.size < 1024 * 1024 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePending(i)}
                        aria-label={`Remove ${f.name}`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <X size={11} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {sendError && (
            <p className="mt-2 text-[11px]" style={{ color: "var(--accent-red)" }}>
              {sendError}
            </p>
          )}

          {/* voiceMsg covers mic permission denials + dictation errors +
              recording errors. Acts as a transient banner the user can
              dismiss with the inline X. Same shape as the customer-side
              voice-error toast above the composer. */}
          {voiceMsg && (
            <div
              className="mt-2 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-[11px]"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                color: "var(--text-muted)",
              }}
            >
              <span>{voiceMsg}</span>
              <button
                type="button"
                onClick={() => setVoiceMsg(null)}
                className="opacity-60 transition-opacity hover:opacity-100"
                aria-label="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          )}

          {recState === "recording" && (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px]" style={{ color: BRAND_GREEN }}>
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 inline-flex animate-ping rounded-full opacity-60" style={{ backgroundColor: BRAND_GREEN }} />
                <span className="relative h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
              </span>
              Recording — tap audio icon again to finish.
            </p>
          )}

          <div className="mt-2 flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.txt,.xlsx,.docx,image/*,audio/*"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
              title="Attach a file — sent on Send."
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
              }}
            >
              <Paperclip size={14} />
            </button>
            {/* Mic — voice-to-text dictation via Web Speech API. Tap to
                start, tap again to stop. While transcribing the button
                gets a soft brand-green tint so the active state is
                obvious. The composer text below picks up interim results
                in real time. */}
            <button
              type="button"
              onClick={voiceMode === "transcribing" ? stopTranscribe : () => void startTranscribe()}
              aria-label={voiceMode === "transcribing" ? "Stop dictating" : "Dictate"}
              title={voiceMode === "transcribing" ? "Stop dictating" : "Dictate — voice to text"}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
              style={{
                color: voiceMode === "transcribing" ? BRAND_GREEN : "var(--text-muted)",
                backgroundColor: voiceMode === "transcribing"
                  ? "color-mix(in srgb, var(--primary) 14%, transparent)"
                  : "transparent",
                border: "1px solid var(--border)",
              }}
            >
              <Mic size={14} />
            </button>
            {/* Audio-lines — MediaRecorder voice-message capture. Tap to
                start, tap again to stop. The resulting blob is staged
                into pendingFiles and ships on the next Send (same path
                as paperclip-attached files). Recording state turns the
                button into a solid brand-green puck with a pulse so the
                "you're being recorded" affordance is unmissable. */}
            <button
              type="button"
              onClick={recState === "recording" ? stopRecording : () => void startRecording()}
              aria-label={recState === "recording" ? "Stop recording" : "Record voice message"}
              title={recState === "recording"
                ? "Tap to finish recording"
                : "Record a voice message — sent on Send."}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
              style={{
                color: recState === "recording" ? "#fff" : "var(--text-muted)",
                backgroundColor: recState === "recording" ? BRAND_GREEN : "transparent",
                border: "1px solid var(--border)",
              }}
            >
              <AudioLines size={14} className={recState === "recording" ? "animate-pulse" : undefined} />
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || (!text.trim() && pendingFiles.length === 0)}
              aria-label="Send"
              className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundColor: BRAND_GREEN,
                color: "#fff",
              }}
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Send
            </button>
          </div>
        </div>
      </div>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DateSeparatorPill + sameDay — ported from the customer-side ChatPanelStub
// so the engineer-side chat reads day-boundaries the same way.
// ─────────────────────────────────────────────────────────────────────────
function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function DateSeparatorPill({ ts }: { ts: number }) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  let label: string;
  if (sameDay(ts, today.getTime())) label = "Today";
  else if (sameDay(ts, yesterday.getTime())) label = "Yesterday";
  else label = d.toLocaleDateString("en-US", {
    month: "short", day: "numeric",
    year: today.getFullYear() === d.getFullYear() ? undefined : "numeric",
  });
  return (
    <div className="my-2 flex justify-center">
      <span
        className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// One chat bubble — ported from customer-side DraftBubble for WhatsApp
// parity. Outgoing bubbles (viewer's own) get a kebab-menu affordance to
// the LEFT of the bubble that opens Edit / Delete options. Edit replaces
// the bubble body with an inline textarea; Save / Cancel both with
// keyboard shortcuts (Enter / Esc) and explicit buttons. Long-press on
// touch devices opens the menu without needing the kebab.
//
// The bubble enters with a `relay-bubble-in` slide-up + fade animation
// (declared in globals.css) so a freshly-sent message feels posted rather
// than spawned in place.
function ChatBubble({
  message, viewerKind,
  menuOpen, editing, editText, onEditTextChange,
  onOpenMenu, onCloseMenu, onStartEdit, onSaveEdit, onCancelEdit, onDelete,
}: {
  message: GuestMessage;
  viewerKind: "engineer" | "guest" | "system" | null;
  menuOpen: boolean;
  editing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when edit mode opens, with caret at end.
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      const len = editRef.current.value.length;
      editRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  if (message.sender_kind === "system") {
    return (
      <div className="flex justify-center">
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[10px]"
          style={{ backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text-muted)" }}
        >
          {message.body}
        </span>
      </div>
    );
  }

  // Right-align messages the viewer sent themselves, left-align the other
  // party's. WhatsApp model: mine = right, theirs = left.
  const mine = viewerKind != null && message.sender_kind === viewerKind;
  const ts = new Date(message.created_at).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
  });

  const startHold = () => {
    if (editing || !mine) return;
    holdTimer.current = setTimeout(() => {
      onOpenMenu();
      holdTimer.current = null;
    }, 450);
  };
  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  return (
    <div
      className={`group relative flex items-start gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
      style={{ animation: editing ? undefined : "relay-bubble-in 180ms ease-out" }}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
    >
      {/* Kebab — only on the viewer's own messages (you can't edit the
          other party's bubbles). Lives OUTSIDE the bubble's left edge so
          it doesn't fight the bubble's text. Always visible at opacity-70
          so users can find it without guessing. */}
      {mine && !editing && (
        <div className="relative mt-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (menuOpen) onCloseMenu();
              else onOpenMenu();
            }}
            aria-label="Message options"
            title="Edit / delete"
            className={
              "flex h-7 w-7 items-center justify-center rounded-full border transition-opacity " +
              (menuOpen ? "opacity-100" : "opacity-70 group-hover:opacity-100 focus:opacity-100")
            }
            style={{
              backgroundColor: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text-muted)",
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full z-20 mt-1 min-w-[150px] overflow-hidden rounded-lg border shadow-xl"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              }}
            >
              <button
                type="button"
                onClick={onStartEdit}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: "var(--text)" }}
              >
                <Pencil size={12} />
                Edit message
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: "var(--accent-red)" }}
              >
                <X size={12} />
                Delete message
              </button>
            </div>
          )}
        </div>
      )}

      <div
        className="relative max-w-[78%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap"
        style={
          mine
            ? { backgroundColor: BRAND_GREEN, color: "#fff", borderBottomRightRadius: 4 }
            : { backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text)", borderBottomLeftRadius: 4 }
        }
      >
        {editing ? (
          <>
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSaveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdit();
                }
              }}
              rows={Math.min(8, Math.max(1, editText.split("\n").length))}
              className="block w-full resize-none rounded-md border bg-transparent px-2 py-1 text-[13px] leading-snug outline-none"
              style={{
                borderColor: mine ? "rgba(255,255,255,0.35)" : "var(--border)",
                color: mine ? "#fff" : "var(--text)",
                backgroundColor: mine
                  ? "rgba(0,0,0,0.15)"
                  : "color-mix(in srgb, var(--surface) 60%, transparent)",
                minWidth: 180,
              }}
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80"
                style={{ color: mine ? "rgba(255,255,255,0.8)" : "var(--text-muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSaveEdit}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: mine ? "#fff" : BRAND_GREEN, color: mine ? BRAND_GREEN : "#fff" }}
              >
                <Check size={10} /> Save
              </button>
            </div>
          </>
        ) : (
          <>
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-1.5">
                <MessageAttachments attachments={message.attachments} />
              </div>
            )}
            {message.body && (
              <div className="whitespace-pre-wrap break-words pr-1">{message.body}</div>
            )}
            <div
              className="mt-0.5 flex items-center justify-end gap-1 text-[9px]"
              style={{ color: mine ? "rgba(255,255,255,0.75)" : "var(--text-muted)" }}
            >
              {/* "(edited)" badge — same word + position as WhatsApp.
                  Renders only after the author edits the body, driven by
                  the edited_at column (migration 20260527210000). */}
              {message.edited_at && (
                <span className="italic opacity-70">edited</span>
              )}
              <span>{ts}</span>
              {/* Single tick = saved server-side. Future double-tick once
                  read-receipts wire up — leave the visual hook now. */}
              {mine && <Check size={10} style={{ opacity: 0.75 }} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AI Summary block — overview + next steps. Falls back to legacy
// session.summary when ai_summary_overview hasn't been written (older
// rows from before the Zoom AI Companion + cascade summarizer landed).
// ─────────────────────────────────────────────────────────────────────────
function SummaryBlock({ session }: { session: GuestCall }) {
  const overview = session.ai_summary_overview ?? session.summary;
  const nextSteps = Array.isArray(session.ai_next_steps as unknown)
    ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
    : [];

  return (
    <section
      className="mb-5 rounded-2xl border p-5"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: BRAND_GREEN }}>
        <Sparkles size={11} />
        AI Summary
      </h2>
      {overview ? (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: "var(--text)" }}>
          {overview}
        </p>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-faint)" }}>
          No summary available for this session yet. If the call just ended, give the AI a minute to write one.
        </p>
      )}
      {nextSteps.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Next steps
          </h3>
          <ul className="space-y-1.5">
            {nextSteps.map((s, i) => {
              const text = typeof s === "string" ? s : (s.text ?? s.description ?? "");
              if (!text) return null;
              return (
                <li key={i} className="flex gap-2 text-sm" style={{ color: "var(--text)" }}>
                  <span style={{ color: BRAND_GREEN }}>→</span>
                  <span>{text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Files block — every attachment from the conversation, grouped by kind.
// ─────────────────────────────────────────────────────────────────────────
function FilesBlock({ files }: { files: GuestMessageAttachment[] }) {
  const images = files.filter((f) => f.kind === "image");
  const docs   = files.filter((f) => f.kind === "document");
  const audios = files.filter((f) => f.kind === "audio");

  return (
    <section
      className="mb-5 rounded-2xl border p-5"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        <Paperclip size={11} />
        Files {files.length > 0 && <span>· {files.length}</span>}
      </h2>
      {files.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-faint)" }}>
          No files were shared in this session.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {images.length > 0 && <FileGroup title="Images" files={images} />}
          {docs.length > 0   && <FileGroup title="Documents" files={docs} />}
          {audios.length > 0 && <FileGroup title="Voice notes" files={audios} />}
        </div>
      )}
    </section>
  );
}

function FileGroup({ title, files }: { title: string; files: GuestMessageAttachment[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">
        {files.map((f) => <FileRow key={f.id} file={f} />)}
      </div>
    </div>
  );
}

function FileRow({ file }: { file: GuestMessageAttachment }) {
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    setBusy(true);
    try {
      const sb = createClient();
      const url = await signedDownloadUrl(sb, file.path, file.name);
      if (url) window.location.href = url;
    } finally {
      setBusy(false);
    }
  };

  const Icon = file.kind === "image" ? ImageIcon
    : file.kind === "audio" ? PlayCircle
    : isSpreadsheet(file.name) ? FileSpreadsheet
    : isWordDoc(file.name) ? FileType
    : FileText;

  const sizeLabel = file.size_bytes != null
    ? formatSize(file.size_bytes)
    : null;

  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" style={{ color: "var(--text)" }}>
          {file.name}
        </div>
        {sizeLabel && (
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {sizeLabel}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onDownload()}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        Download
      </button>
    </div>
  );
}

function isSpreadsheet(name: string): boolean {
  return /\.(xlsx?|csv)$/i.test(name);
}
function isWordDoc(name: string): boolean {
  return /\.(docx?)$/i.test(name);
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────
// Chat transcript — center-pane read-only timeline. Same content as the
// right-pane ChatPane but in a paper-style transcript form so it reads
// well alongside the AI summary + files.
// ─────────────────────────────────────────────────────────────────────────
function TranscriptBlock({
  messages, loading, error, onDownload,
}: {
  messages: GuestMessage[];
  loading: boolean;
  error: string | null;
  onDownload: () => void;
}) {
  const visible = messages.filter((m) => {
    if (m.sender_kind === "system") {
      const body = m.body ?? "";
      if (body.includes("Zoom meeting started")) return false;
      if (body.includes("Zoom meeting ended")) return false;
      if (body.includes("Recording available")) return false;
      if (isAiSummaryMessageBody(body)) return false;
    }
    return true;
  });

  return (
    <section
      className="rounded-2xl border p-5"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Chat transcript
        </h2>
        {visible.length > 0 && (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <Download size={11} />
            Download .txt
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={14} className="animate-spin" /> Loading transcript…
        </div>
      ) : error ? (
        <p className="text-sm" style={{ color: "var(--accent-red)" }}>{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-faint)" }}>
          No chat messages were exchanged in this session.
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((m) => <TranscriptMessage key={m.id} message={m} />)}
        </div>
      )}
    </section>
  );
}

function TranscriptMessage({ message }: { message: GuestMessage }) {
  if (message.sender_kind === "system") {
    return (
      <div className="flex justify-center">
        <span
          className="inline-block rounded-full px-2.5 py-1 text-[11px]"
          style={{ backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text-muted)" }}
        >
          {message.body}
        </span>
      </div>
    );
  }
  const ts = new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const isEngineer = message.sender_kind === "engineer";
  const senderLabel = isEngineer
    ? message.sender_name ?? "Engineer"
    : message.sender_name ?? "Customer";

  return (
    <div className={`flex flex-col ${isEngineer ? "items-end" : "items-start"}`}>
      <div className="mb-0.5 px-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {senderLabel} · {ts}
      </div>
      <div
        className="flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap"
        style={
          isEngineer
            ? { backgroundColor: BRAND_GREEN, color: "#fff", borderBottomRightRadius: 4 }
            : { backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text)", borderBottomLeftRadius: 4 }
        }
      >
        {message.attachments && message.attachments.length > 0 && (
          <MessageAttachments attachments={message.attachments} />
        )}
        {message.body && <div>{message.body}</div>}
      </div>
    </div>
  );
}

// Surface a silent-render <Mic /> placeholder for codepaths that previously
// imported it — keeps tree-shaking happy without a separate dead-import
// warning if MessageAttachments evolves.
export const _MicRef = Mic;
