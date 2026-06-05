"use client";

/*
 * Inline "AI Companion summary" card rendered for system messages posted
 * by zoom-webhook → handleSummaryCompleted. Same chronological position as
 * any other system message, but parsed and rendered structurally instead
 * of as the cramped multi-line system chip.
 *
 * Webhook posts the message body as:
 *   🤖 AI Companion summary
 *   {title}
 *   {overview}
 *
 *   Next steps:
 *   • step 1
 *   • step 2
 *
 * We split on "Next steps:" to isolate the bullets, then peel the first
 * non-empty line of the remaining header as the title.
 */

import { useState } from "react";
import {
  Sparkles,
  Video,
  KeyRound,
  Copy,
  Check,
  Pencil,
  Trash2,
  Loader2,
  X,
  ChevronDown,
} from "lucide-react";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "var(--primary-soft)";
const BRAND_GREEN_BORDER =
  "color-mix(in srgb, var(--primary) 32%, transparent)";
/** Detect whether a system message body is an AI summary capsule. */
export function isAiSummaryMessageBody(body: string): boolean {
  return body.includes("AI Companion summary");
}

/** The hidden marker line that tags a system message as a summary capsule.
 *  It stays in the stored body for detection, but is stripped from the edit
 *  textarea so the user never sees raw "🤖 AI Companion summary" text. */
const SUMMARY_MARKER = "🤖 AI Companion summary";
function stripSummaryMarker(body: string): string {
  return body
    .split("\n")
    .filter((l) => !/AI Companion summary/i.test(l))
    .join("\n")
    .replace(/^\s+/, "");
}
function ensureSummaryMarker(body: string): string {
  return /AI Companion summary/i.test(body)
    ? body
    : `${SUMMARY_MARKER}\n${body}`;
}

type Parsed = {
  title: string | null;
  overview: string | null;
  nextSteps: string[];
};

function parseAiSummary(body: string): Parsed {
  // Split header section vs. "Next steps:" bullet list.
  const m = body.split(/\n\s*Next steps:\s*\n?/i);
  const headerSection = m[0] ?? "";
  const stepsSection = m.length > 1 ? m.slice(1).join("\n") : "";

  // Drop the "🤖 AI Companion summary" header line.
  const headerLines = headerSection
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/AI Companion summary/i.test(l));

  let title: string | null = null;
  let overview: string | null = null;
  if (headerLines.length === 1) {
    // One line after the header is Zoom's AI Companion title (the webhook
    // pushes `title` first, then `overview`, then `Next steps:`). Short
    // calls often return only the title — treat it as such so the card
    // renders with proper heading styling instead of body-text styling.
    title = headerLines[0];
  } else if (headerLines.length > 1) {
    title = headerLines[0];
    overview = headerLines.slice(1).join("\n");
  }

  const nextSteps: string[] = [];
  if (stepsSection) {
    for (const raw of stepsSection.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      nextSteps.push(line.replace(/^[•\-*]\s*/, ""));
    }
  }

  return { title, overview, nextSteps };
}

/**
 * Pulls the recording URL + passcode out of the system-message body the
 * zoom-webhook posts after a cloud recording lands. The body looks like:
 *   🎥 Recording available: https://zoom.us/rec/...
 *   Passcode: K^8^r0&C
 * The passcode line is optional.
 */
function parseRecording(body: string): {
  url: string | null;
  passcode: string | null;
} {
  const urlMatch = body.match(/Recording available:\s*(\S+)/i);
  const passMatch = body.match(/Passcode:\s*(.+?)\s*$/im);
  return {
    url: urlMatch ? urlMatch[1] : null,
    passcode: passMatch ? passMatch[1].trim() : null,
  };
}

type CopyTarget = "url" | "passcode";

export function MeetingSummaryEntry({
  body,
  recordingBody,
  canEdit = false,
  onEdit,
  onDelete,
}: {
  body: string;
  recordingBody?: string | null;
  /** Show the edit + delete affordances. False for read-only viewers. */
  canEdit?: boolean;
  /** Persist a rewritten body. Receives the raw text (no parsing applied). */
  onEdit?: (newBody: string) => Promise<void>;
  /** Drop the underlying guest_messages row entirely. */
  onDelete?: () => Promise<void>;
}) {
  const { title, overview, nextSteps } = parseAiSummary(body);
  const recording = recordingBody ? parseRecording(recordingBody) : null;

  // Edit mode is local — we hold the draft in state, and on Save the
  // parent component performs the RPC. The realtime sub on guest_messages
  // then delivers the new body back and the read view re-parses.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => stripSummaryMarker(body));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Collapsed by default — the card reads as a one-line summary you click to
  // open, so a stack of call summaries stays scannable.
  const [expanded, setExpanded] = useState(false);

  const handleSave = async () => {
    if (!onEdit || saving) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setErrMsg("The card can't be empty — use Delete to remove it instead.");
      return;
    }
    setSaving(true);
    setErrMsg(null);
    try {
      await onEdit(ensureSummaryMarker(trimmed));
      setEditing(false);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Couldn't save the changes.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || deleting) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this call summary card?")
    ) {
      return;
    }
    setDeleting(true);
    setErrMsg(null);
    try {
      await onDelete();
      // Parent unmounts us once the realtime sub removes the row; no
      // local state to reset.
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Couldn't delete the card.");
      setDeleting(false);
    }
  };

  // Stub-only case: Zoom AI Companion sometimes returns just the generic
  // title `"Meeting Summary for {topic} — {customer}"` with no overview
  // and no next steps. This happens for very short calls (typically <2
  // min) where there isn't enough audio to summarize. The card on its
  // own says nothing useful, so we surface a clear explanation instead
  // of letting it look like a rendering bug.
  const hasRealContent =
    !!overview ||
    nextSteps.length > 0 ||
    !!(recording && (recording.url || recording.passcode));
  const isStubOnly =
    !!title && !hasRealContent && /Meeting Summary for/i.test(title);
  // Tracks which value we most recently copied so each button gets its own
  // ✓ confirmation independently — copying the URL shouldn't flash the
  // passcode button's checkmark and vice versa.
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  const copyText = async (text: string, which: CopyTarget) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can be unavailable (insecure context, locked-down
      // Electron partition). Best-effort fallback: select via temp textarea.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more we can do */
      }
      el.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  };

  // Edit mode replaces the parsed body with a single rewriteable textarea.
  // We do NOT try to round-trip back through parseAiSummary because the
  // user may want to write free-form text — the parser will just degrade
  // gracefully (no "Next steps" section if they don't include one).
  if (editing) {
    return (
      <div className="flex justify-center">
        <div
          className="w-full max-w-md rounded-2xl border p-4 shadow-sm"
          style={{
            borderColor: BRAND_GREEN_BORDER,
            backgroundColor: BRAND_GREEN_SOFT,
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
              >
                <Sparkles size={13} />
              </div>
              <span
                className="text-[10px] font-semibold tracking-wider uppercase"
                style={{ color: BRAND_GREEN }}
              >
                Editing summary
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(stripSummaryMarker(body));
                setErrMsg(null);
              }}
              aria-label="Cancel"
              className="rounded-md p-1 transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={12} />
            </button>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            rows={8}
            className="block w-full rounded-md border bg-transparent p-2 text-[13px] leading-relaxed outline-none focus:ring-2"
            style={{
              borderColor: "var(--border)",
              color: "var(--text)",
              ["--tw-ring-color" as string]:
                "color-mix(in srgb, var(--primary) 35%, transparent)",
            }}
          />
          {errMsg && (
            <p
              className="mt-1.5 text-[11px]"
              style={{ color: "var(--accent-red)" }}
            >
              {errMsg}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap disabled:opacity-50"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              {saving ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Check size={10} />
              )}
              {saving ? "Saving" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(stripSummaryMarker(body));
                setErrMsg(null);
              }}
              disabled={saving}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] whitespace-nowrap hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
              style={{ color: "var(--text-muted)" }}
            >
              Cancel
            </button>
            <span
              className="min-w-0 flex-1 truncate text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              Free-form text — <code>Next steps:</code> bullets auto-render.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Collapsed, the card is a single clickable row (sparkle + "Call summary" +
  // title). Expanding reveals the overview, next steps, recording, and the
  // edit/delete actions. Defaulting collapsed keeps a stack of call summaries
  // scannable and matches "click on it to see the call summary".
  const hasDetail =
    !!overview ||
    isStubOnly ||
    nextSteps.length > 0 ||
    !!(recording && (recording.url || recording.passcode));

  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border shadow-sm"
        style={{
          borderColor: BRAND_GREEN_BORDER,
          backgroundColor: BRAND_GREEN_SOFT,
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 p-4 text-left"
        >
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            <Sparkles size={13} />
          </div>
          <div className="min-w-0 flex-1">
            <span
              className="text-[10px] font-semibold tracking-wider uppercase"
              style={{ color: BRAND_GREEN }}
            >
              Call summary
            </span>
            {title && !isStubOnly ? (
              <h3
                className="truncate text-sm leading-tight font-semibold"
                style={{
                  color: "var(--text)",
                  fontFamily: "var(--font-source-serif)",
                }}
              >
                {title}
              </h3>
            ) : null}
          </div>
          {hasDetail ? (
            <ChevronDown
              size={16}
              className="shrink-0 transition-transform"
              style={{
                color: "var(--text-muted)",
                transform: expanded ? "rotate(180deg)" : "none",
              }}
            />
          ) : null}
        </button>

        {expanded && hasDetail ? (
          <div className="px-4 pb-4">
            {overview ? (
              <p
                className="text-[13px] leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--text)" }}
              >
                {overview}
              </p>
            ) : null}

            {isStubOnly ? (
              <p
                className="text-[12px] leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                The summary for this call was too short to generate detail. The
                session summary above captures the key points.
              </p>
            ) : null}

            {nextSteps.length > 0 ? (
              <div className="mt-3">
                <div
                  className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  Next steps
                </div>
                <ul className="space-y-1">
                  {nextSteps.map((step, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-[12px] leading-relaxed"
                      style={{ color: "var(--text)" }}
                    >
                      <span style={{ color: BRAND_GREEN }}>→</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {recording && (recording.url || recording.passcode) ? (
              <div
                className="mt-4 border-t pt-3"
                style={{ borderColor: BRAND_GREEN_BORDER }}
              >
                <div
                  className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  Recording
                </div>
                {recording.url ? (
                  <div className="flex items-center gap-2 text-[12px] leading-relaxed">
                    <Video size={12} style={{ color: BRAND_GREEN }} />
                    <a
                      href={recording.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate underline underline-offset-2"
                      style={{ color: BRAND_GREEN }}
                    >
                      {recording.url}
                    </a>
                    <CopyButton
                      onClick={() => void copyText(recording.url!, "url")}
                      done={copied === "url"}
                      label="Copy link"
                    />
                  </div>
                ) : null}
                {recording.passcode ? (
                  <div
                    className="mt-1.5 flex items-center gap-2 text-[12px]"
                    style={{ color: "var(--text)" }}
                  >
                    <KeyRound
                      size={12}
                      style={{ color: "var(--text-muted)" }}
                    />
                    <span style={{ color: "var(--text-muted)" }}>
                      Passcode:
                    </span>
                    <code
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--text) 8%, transparent)",
                        color: "var(--text)",
                      }}
                    >
                      {recording.passcode}
                    </code>
                    <CopyButton
                      onClick={() =>
                        void copyText(recording.passcode!, "passcode")
                      }
                      done={copied === "passcode"}
                      label="Copy passcode"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {errMsg ? (
              <p
                className="mt-2 text-[11px]"
                style={{ color: "var(--accent-red)" }}
              >
                {errMsg}
              </p>
            ) : null}

            {canEdit && (onEdit || onDelete) ? (
              <div
                className="mt-4 flex items-center gap-2 border-t pt-3"
                style={{ borderColor: BRAND_GREEN_BORDER }}
              >
                {onEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(stripSummaryMarker(body));
                      setEditing(true);
                      setErrMsg(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <Pencil size={11} /> Edit
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {deleting ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Trash2 size={11} />
                    )}{" "}
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CopyButton({
  onClick,
  done,
  label,
}: {
  onClick: () => void;
  done: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={done ? "Copied" : label}
      aria-label={done ? "Copied" : label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
      style={{
        color: done ? BRAND_GREEN : "var(--text-muted)",
        backgroundColor: done
          ? "color-mix(in srgb, var(--text) 4%, transparent)"
          : "transparent",
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
