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
import { Sparkles, Video, KeyRound, Copy, Check } from "lucide-react";

const BRAND_GREEN        = "#3f5c2e";
const BRAND_GREEN_SOFT   = "rgba(63, 92, 46, 0.12)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.32)";

/** Detect whether a system message body is an AI Companion summary. */
export function isAiSummaryMessageBody(body: string): boolean {
  return body.includes("AI Companion summary");
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
    overview = headerLines[0];
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
function parseRecording(body: string): { url: string | null; passcode: string | null } {
  const urlMatch = body.match(/Recording available:\s*(\S+)/i);
  const passMatch = body.match(/Passcode:\s*(.+?)\s*$/im);
  return {
    url: urlMatch ? urlMatch[1] : null,
    passcode: passMatch ? passMatch[1].trim() : null,
  };
}

type CopyTarget = "url" | "passcode";

export function MeetingSummaryEntry({ body, recordingBody }: { body: string; recordingBody?: string | null }) {
  const { title, overview, nextSteps } = parseAiSummary(body);
  const recording = recordingBody ? parseRecording(recordingBody) : null;
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
      try { document.execCommand("copy"); } catch { /* nothing more we can do */ }
      el.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  };

  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-md rounded-2xl border p-4 shadow-sm"
        style={{
          borderColor: BRAND_GREEN_BORDER,
          backgroundColor: BRAND_GREEN_SOFT,
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            <Sparkles size={13} />
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: BRAND_GREEN }}
          >
            AI Companion summary
          </span>
        </div>

        {title ? (
          <h3
            className="mt-3 text-sm font-semibold leading-tight"
            style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
          >
            {title}
          </h3>
        ) : null}

        {overview ? (
          <p
            className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed"
            style={{ color: "var(--text)" }}
          >
            {overview}
          </p>
        ) : null}

        {nextSteps.length > 0 ? (
          <div className="mt-3">
            <div
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
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
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
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
                <KeyRound size={12} style={{ color: "var(--text-muted)" }} />
                <span style={{ color: "var(--text-muted)" }}>Passcode:</span>
                <code
                  className="rounded px-1.5 py-0.5 text-[11px]"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
                    color: "var(--text)",
                  }}
                >
                  {recording.passcode}
                </code>
                <CopyButton
                  onClick={() => void copyText(recording.passcode!, "passcode")}
                  done={copied === "passcode"}
                  label="Copy passcode"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CopyButton({ onClick, done, label }: { onClick: () => void; done: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={done ? "Copied" : label}
      aria-label={done ? "Copied" : label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
      style={{
        color: done ? BRAND_GREEN : "var(--text-muted)",
        backgroundColor: done ? "color-mix(in srgb, var(--text) 4%, transparent)" : "transparent",
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
