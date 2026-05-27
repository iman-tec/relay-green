/*
 * engineerAiContext — pure context-assembly helper for the engineer-side
 * "Ask anything about this project" AI bar.
 *
 * Given a project_id (and the current live session_id), pulls every
 * available piece of context the AI needs:
 *   - project row + AI rollup
 *   - customer-level summary (recurring themes across all the customer's
 *     projects)
 *   - latest client intake brief for this project
 *   - up to 20 most recent ended sessions, each with their AI summary
 *   - up to 100 most recent file attachments shared across the project
 *     (file NAMES only — never bodies, to keep the context bounded)
 *   - last 30 messages from the current live session (so the AI can
 *     answer "what did they just say about X?")
 *
 * Output is a single string ready to drop into the model's user message,
 * tagged with [S#] citation tokens that the client maps back to past
 * session ids.
 *
 * Reads via the supabase service-role client supplied by the caller —
 * authorization (the engineer is claimed_by on the live session) is the
 * route handler's job, not this module's. This module assumes the caller
 * has already verified access.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CitationKind = "summary" | "file" | "intake";
export type Citation = {
  /** The [S#] / [F#] / [I] token the model is told to use. */
  token: string;
  /** The past session id the chip should link to. NULL for intake / files
   *  attached to the current session. */
  sessionId: string | null;
  /** Human label for the chip — e.g. "Apr 12 · Stripe webhook debugging". */
  label: string;
  kind: CitationKind;
};

export type AssembledContext = {
  /** The full text blob to drop into the model's user message. */
  contextBlob: string;
  /** Citation index — drives the client's [S#] → /session-review/[id]
   *  chip rendering after the stream finishes. */
  citations: Citation[];
  /** Truthy iff we found ZERO past-session AI summaries — caller may
   *  want to short-circuit the LLM call with a friendly stock answer. */
  isFirstSessionOnProject: boolean;
};

const MAX_PAST_SESSIONS = 20;
const MAX_FILES = 100;
const MAX_CURRENT_SESSION_MESSAGES = 30;

// Type shapes for the rows we read. Kept narrow on purpose — only the
// columns this module actually consumes.
type ProjectRow = {
  id: string;
  name: string | null;
  customer_id: string;
  ai_summary_title: string | null;
  ai_summary_overview: string | null;
  ai_next_steps: unknown;
  summary: string | null;
};

type CustomerSummaryRow = {
  ai_summary_title: string | null;
  ai_summary_overview: string | null;
  summary: string | null;
};

type IntakeRow = {
  intake_summary: string | null;
  familiarity: string | null;
  ai_tools_used: string | null;
  technologies: string[] | null;
};

type SessionRow = {
  id: string;
  ai_summary_title: string | null;
  ai_summary_overview: string | null;
  ai_next_steps: unknown;
  summary: string | null;
  created_at: string;
  duration_minutes: number | string | null;
};

type AttachmentRow = {
  name: string;
  mime: string;
  kind: string;
  created_at: string;
  guest_call_id: string;
};

type MessageRow = {
  sender_kind: string;
  sender_name: string | null;
  body: string | null;
  created_at: string;
};

export async function assembleProjectContext(
  sb: SupabaseClient,
  args: { projectId: string; currentSessionId: string },
): Promise<AssembledContext> {
  const { projectId, currentSessionId } = args;
  const citations: Citation[] = [];

  // Parallel fan-out — every read is independent.
  const [
    projectRes,
    sessionsRes,
    currentMsgsRes,
  ] = await Promise.all([
    sb.from("projects")
      .select("id, name, customer_id, ai_summary_title, ai_summary_overview, ai_next_steps, summary")
      .eq("id", projectId)
      .maybeSingle(),
    sb.from("guest_calls")
      .select("id, ai_summary_title, ai_summary_overview, ai_next_steps, summary, created_at, duration_minutes")
      .eq("project_id", projectId)
      .neq("id", currentSessionId)
      .order("created_at", { ascending: false })
      .limit(MAX_PAST_SESSIONS),
    sb.from("guest_messages")
      .select("sender_kind, sender_name, body, created_at")
      .eq("guest_call_id", currentSessionId)
      .order("created_at", { ascending: false })
      .limit(MAX_CURRENT_SESSION_MESSAGES),
  ]);

  const project = (projectRes.data ?? null) as ProjectRow | null;

  // customer_summaries needs the customer_id from the project row; intake
  // can be fetched in parallel with attachments now that we have the
  // pastSessions list.
  const pastSessions = ((sessionsRes.data ?? []) as SessionRow[]).filter(
    (s) => s.ai_summary_overview || s.summary,
  );
  const pastSessionIds = pastSessions.map((s) => s.id);

  const [customerSummaryRes, intakeRes, attachmentsRes] = await Promise.all([
    project?.customer_id
      ? sb.from("customer_summaries")
          .select("ai_summary_title, ai_summary_overview, summary")
          .eq("customer_id", project.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from("client_intakes")
      .select("intake_summary, familiarity, ai_tools_used, technologies")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Files across the project — fetched via guest_messages.guest_call_id
    // because guest_message_attachments doesn't carry project_id directly.
    pastSessionIds.length > 0 || currentSessionId
      ? sb.from("guest_message_attachments")
          .select("name, mime, kind, created_at, guest_messages!inner(guest_call_id)")
          .in("guest_messages.guest_call_id", [...pastSessionIds, currentSessionId])
          .order("created_at", { ascending: false })
          .limit(MAX_FILES)
      : Promise.resolve({ data: [] }),
  ]);

  const customerSummary = (customerSummaryRes.data ?? null) as CustomerSummaryRow | null;
  const intake = (intakeRes.data ?? null) as IntakeRow | null;

  // Normalise attachment shape — the embed returns guest_messages as a
  // nested object whose guest_call_id we need to surface flat.
  const attachments: AttachmentRow[] = ((attachmentsRes.data ?? []) as Array<{
    name: string;
    mime: string;
    kind: string;
    created_at: string;
    guest_messages: { guest_call_id: string } | { guest_call_id: string }[] | null;
  }>).map((r) => {
    const gm = Array.isArray(r.guest_messages) ? r.guest_messages[0] : r.guest_messages;
    return {
      name: r.name,
      mime: r.mime,
      kind: r.kind,
      created_at: r.created_at,
      guest_call_id: gm?.guest_call_id ?? "",
    };
  }).filter((r) => r.guest_call_id);

  // Build session id → [S#] token map up front so file citations can
  // reference the same token as the session summary.
  const sessionToken = new Map<string, string>();
  pastSessions.forEach((s, i) => {
    sessionToken.set(s.id, `S${i + 1}`);
  });

  // ── Render the blob ────────────────────────────────────────────────
  const lines: string[] = [];

  // Project header
  lines.push(`== Project: ${project?.name ?? "(unnamed)"} ==`);
  if (project?.ai_summary_overview || project?.summary) {
    lines.push("");
    lines.push("Project rollup:");
    lines.push(project.ai_summary_overview ?? project.summary ?? "");
  }
  const projectNextSteps = parseNextSteps(project?.ai_next_steps);
  if (projectNextSteps.length > 0) {
    lines.push("");
    lines.push("Project next steps:");
    for (const s of projectNextSteps) lines.push(`  - ${s}`);
  }

  // Customer-level rollup
  if (customerSummary?.ai_summary_overview || customerSummary?.summary) {
    lines.push("");
    lines.push("== Customer profile (across all their projects) ==");
    lines.push(customerSummary.ai_summary_overview ?? customerSummary.summary ?? "");
  }

  // Intake brief
  if (intake?.intake_summary) {
    lines.push("");
    lines.push("== Intake brief (engineer-ready) [I] ==");
    lines.push(intake.intake_summary);
    if (intake.familiarity) lines.push(`Familiarity: ${intake.familiarity}`);
    if (intake.ai_tools_used) lines.push(`AI tools: ${intake.ai_tools_used}`);
    if (intake.technologies && intake.technologies.length > 0) {
      lines.push(`Technologies: ${intake.technologies.join(", ")}`);
    }
    citations.push({
      token: "I",
      sessionId: null,
      label: "Intake brief",
      kind: "intake",
    });
  }

  // Past sessions
  if (pastSessions.length === 0) {
    lines.push("");
    lines.push("== Past sessions ==");
    lines.push("(none — this is the first session on this project)");
  } else {
    lines.push("");
    lines.push("== Past sessions ==");
    for (const s of pastSessions) {
      const token = sessionToken.get(s.id)!;
      const date = new Date(s.created_at).toISOString().slice(0, 10);
      const title = s.ai_summary_title ?? "(no title)";
      const mins = s.duration_minutes != null
        ? ` (${Math.round(Number(s.duration_minutes))} min)`
        : "";
      lines.push("");
      lines.push(`[${token}] ${date} · "${title}"${mins}`);
      const overview = s.ai_summary_overview ?? s.summary;
      if (overview) lines.push(`Overview: ${overview}`);
      const nextSteps = parseNextSteps(s.ai_next_steps);
      if (nextSteps.length > 0) {
        lines.push("Next steps:");
        for (const ns of nextSteps) lines.push(`  - ${ns}`);
      }
      citations.push({
        token,
        sessionId: s.id,
        label: `${date} · ${title}`,
        kind: "summary",
      });
    }
  }

  // Files shared in the project
  if (attachments.length > 0) {
    lines.push("");
    lines.push("== Files shared in this project ==");
    let fileIdx = 0;
    for (const a of attachments) {
      fileIdx += 1;
      const sourceToken = sessionToken.get(a.guest_call_id);
      const fromLabel = sourceToken
        ? ` — from [${sourceToken}]`
        : a.guest_call_id === currentSessionId
          ? " — from current session"
          : "";
      const fileToken = `F${fileIdx}`;
      lines.push(`[${fileToken}] "${a.name}" (${a.kind})${fromLabel}`);
      citations.push({
        token: fileToken,
        sessionId: sourceToken ? a.guest_call_id : null,
        label: a.name,
        kind: "file",
      });
    }
  }

  // Current session tail — messages are read newest-first so reverse for
  // chronological order in the prompt.
  const currentMsgs = ((currentMsgsRes.data ?? []) as MessageRow[]).slice().reverse();
  if (currentMsgs.length > 0) {
    lines.push("");
    lines.push("== Current session (live, latest messages, chronological) ==");
    for (const m of currentMsgs) {
      if (m.sender_kind === "system") continue;
      const speaker = m.sender_kind === "engineer"
        ? `Engineer${m.sender_name ? ` (${m.sender_name})` : ""}`
        : `Customer${m.sender_name ? ` (${m.sender_name})` : ""}`;
      const body = (m.body ?? "").trim();
      if (!body) continue;
      lines.push(`${speaker}: ${body}`);
    }
  }

  return {
    contextBlob: lines.join("\n"),
    citations,
    isFirstSessionOnProject: pastSessions.length === 0,
  };
}

// next_steps can come in as a JSON array of strings OR an array of
// objects with { text } / { description }. Normalise to a string list.
function parseNextSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as { text?: unknown; description?: unknown };
      const text =
        (typeof obj.text === "string" && obj.text) ||
        (typeof obj.description === "string" && obj.description) ||
        null;
      if (text && text.trim()) out.push(text.trim());
    }
  }
  return out;
}
