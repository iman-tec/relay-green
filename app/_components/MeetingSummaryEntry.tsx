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

import { Sparkles } from "lucide-react";

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

export function MeetingSummaryEntry({ body }: { body: string }) {
  const { title, overview, nextSteps } = parseAiSummary(body);

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
      </div>
    </div>
  );
}
