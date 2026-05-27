"use client";

/*
 * Inline meeting entry inside the chat message stream.
 *
 * Each "📞 Zoom meeting started" system message renders one of these at
 * its chronological position. The paired "📞 Zoom meeting ended" message
 * is folded in (the renderer suppresses it) so we get one entry per call.
 *
 *  - Active state: the in-stream Zoom CTA is now PROMINENT. Brief §5.5
 *    requires the call button to be the star of the centre pane; a
 *    `<Button variant="launcher">` (green pulse halo) carries that role.
 *  - Ended state: compact pill with duration + optional summary toggle.
 *
 * Token-only — `BRAND_GREEN`/`BRAND_GREEN_SOFT`/`BRAND_GREEN_BORDER`
 * deleted from this file in Phase 7.
 */

import { useState } from "react";
import { Video, PhoneOff, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { MeetingSummaryEntry } from "./MeetingSummaryEntry";
import { Button } from "@/app/_components/ui";
import { useLaunchCall } from "@/lib/video/LaunchCallContext";

type Props = {
  active: boolean;
  /** Defined only when `active === false`. Seconds between the matching
   *  started/ended messages — formatted for display. */
  durationSec?: number;
  /** Only used when active; the Zoom URL the viewer should open. Customer
   *  passes zoom_join_url; engineer passes zoom_start_url. */
  joinUrl?: string | null;
  /** Fires alongside opening the Zoom URL — typically state.markJoined(). */
  onJoin?: () => void | Promise<void>;
  /** Video SDK wire-in: when provided, the Join button calls this INSTEAD of
   *  window.open(joinUrl). Lets the parent mount an in-window <CallSurface>
   *  instead of popping a new tab. Falls back to window.open when omitted. */
  onLaunchCall?: () => void;
  /** True when *this* viewer has already joined the meeting (customer_joined_at
   *  or engineer_joined_at is set). Replaces the live Join button with a
   *  disabled "Joined" chip so the user can't double-click into Zoom. */
  selfJoined?: boolean;
  /** Engineer-only: hang up the Zoom call without joining it. Renders a
   *  secondary "End call" button alongside Join on the active state. */
  onCancel?: () => void | Promise<void>;
  /** Ended-state only: when an AI Companion summary exists for this call,
   *  pass its raw body so the card can render a Sparkles toggle that
   *  expands the parsed summary inline below. */
  summaryBody?: string | null;
  /** Ended-state only: system-message body that carries the Zoom cloud
   *  recording URL + passcode. */
  recordingBody?: string | null;
};

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "Under a minute";
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60);
  if (m === 0) return `${r} sec`;
  if (r === 0) return `${m} min`;
  return `${m} min ${r} sec`;
}

export function MeetingChatEntry({
  active,
  durationSec,
  joinUrl,
  onJoin,
  onLaunchCall,
  selfJoined,
  onCancel,
  summaryBody,
  recordingBody,
}: Props) {
  const [cancelling, setCancelling] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Prefer explicit prop; fall back to LaunchCallContext (Video SDK wire-in).
  const ctxLaunch = useLaunchCall();
  const effectiveLaunch = onLaunchCall ?? ctxLaunch;

  const hasSummary = !active && !!summaryBody;
  const hasRecording = !active && !!recordingBody;
  const canExpand = hasSummary || hasRecording;

  const handleJoin = () => {
    void onJoin?.();
    if (effectiveLaunch) {
      // Video SDK path: parent mounts <CallSurface> in-window.
      effectiveLaunch();
      return;
    }
    // Legacy Meeting SDK fallback: open Zoom in a new tab.
    if (joinUrl) {
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleCancel = async () => {
    if (!onCancel || cancelling) return;
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  // ── Active: prominent call card with the launcher CTA ───────────
  if (active) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div
          className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border px-5 py-4 text-center"
          style={{
            borderColor: "color-mix(in srgb, var(--green-dot) 35%, transparent)",
            background: "var(--ok-soft)",
          }}
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ok)]">
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full animate-[relay-pulse-ok_1800ms_ease-in-out_infinite]"
              style={{ background: "var(--green-dot)" }}
            />
            Zoom call · ongoing
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {(joinUrl || effectiveLaunch) && !selfJoined && (
              <Button
                variant="launcher"
                size="lg"
                onClick={handleJoin}
                iconLeft={<Video size={16} />}
                iconRight={effectiveLaunch ? undefined : <ExternalLink size={14} />}
              >
                {effectiveLaunch ? "Join call" : "Join Zoom call"}
              </Button>
            )}
            {selfJoined && (
              <span
                aria-disabled="true"
                className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[var(--ok-soft)] px-4 py-2 text-sm font-medium text-[var(--ok)]"
              >
                <Video size={14} />
                You&apos;re on the call
              </span>
            )}
            {onCancel && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void handleCancel()}
                loading={cancelling}
                iconLeft={!cancelling ? <PhoneOff size={14} /> : null}
              >
                End call
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Ended: compact pill + optional summary toggle ────────────────
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="inline-flex max-w-md items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_4%,transparent)] px-3 py-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[var(--text-muted)]">
          <PhoneOff size={13} />
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-xs font-medium text-[var(--text)]">
            Zoom call · ended
          </span>
          {durationSec !== undefined && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {formatDuration(durationSec)}
            </span>
          )}
        </div>
        {canExpand && (
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            aria-pressed={summaryOpen}
            aria-label={summaryOpen ? "Hide call summary" : "Show call summary"}
            title={summaryOpen ? "Hide call summary" : "Show call summary"}
            className={
              "ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors " +
              (summaryOpen
                ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                : "border-[var(--border)] text-[var(--primary)] hover:bg-[var(--primary-soft)]")
            }
          >
            {cancelling ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
          </button>
        )}
      </div>
      {canExpand && summaryOpen && (
        <MeetingSummaryEntry
          body={summaryBody ?? "🤖 AI Companion summary"}
          recordingBody={recordingBody ?? null}
        />
      )}
    </div>
  );
}
