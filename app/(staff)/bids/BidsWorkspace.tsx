"use client";

/*
 * /bids workspace — the act-now bid queue on the left, and a PERSISTENT
 * project-history AI panel on the right. Clicking "Review project history
 * (AI)" inside a bid loads that project into the right panel (instead of a
 * popover). Until then the panel shows a disabled placeholder.
 *
 * On mobile the rail takes the full width and the panel opens as a
 * full-screen overlay when a project is selected.
 */

import { useState } from "react";
import { FileText, History as HistoryIcon, Plus, Sparkles, X } from "lucide-react";
import { ActNowRail, type ActNowVariant } from "../supervise/ActNowRail";
import { ProjectAIAssistant } from "@/app/_components/ProjectAIAssistant";

type Selected = { projectId: string; projectName: string | null };

// Shared by the supervisor's /bids and the engineer's /quotations. The two
// surfaces are visually identical; `variant` swaps the rail's data source +
// action labels, and the title/subtitle are passed in so each reads in its own
// register ("Bids" vs "Quotation").
export function BidsWorkspace({
  variant = "supervisor",
  title = "Bids",
  subtitle = "Estimation requests and escalations from your pod awaiting your review. Open a bid and use “Review project history (AI)” — it opens in the panel on the right.",
}: {
  variant?: ActNowVariant;
  title?: string;
  subtitle?: string;
} = {}) {
  const [selected, setSelected] = useState<Selected | null>(null);

  return (
    <div className="flex h-full w-full flex-col px-4 pt-6 pb-4 sm:px-6 sm:pt-8 sm:pb-6">
      <header className="mb-5 shrink-0">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-[var(--text)] sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1.5 hidden text-sm leading-relaxed text-[var(--text-muted)] sm:block">
          {subtitle}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        {/* Left rail — the bids queue, next to the nav. Full width on mobile. */}
        <div className="min-h-0 w-full lg:w-96 lg:shrink-0">
          <ActNowRail
            variant={variant}
            onOpenHistory={(projectId, projectName) =>
              setSelected({ projectId, projectName })
            }
            onCloseHistory={() => setSelected(null)}
          />
        </div>

        {/* Right panel — persistent AI history. Desktop only (inline). */}
        <div className="hidden min-w-0 flex-1 lg:block">
          <BidHistoryPanel selected={selected} onClose={() => setSelected(null)} />
        </div>
      </div>

      {/* Mobile — the panel opens full-screen when a project is selected. */}
      {selected && (
        <div className="fixed inset-0 z-[var(--z-modal)] lg:hidden">
          <BidHistoryPanel selected={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}

// Persistent right-hand panel. Always shows the "Review project history (AI)"
// chrome; the project name + working assistant appear only once a bid's
// history is opened.
function BidHistoryPanel({
  selected,
  onClose,
}: {
  selected: Selected | null;
  onClose: () => void;
}) {
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-none border-0 lg:rounded-xl lg:border"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {/* Title bar */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          <FileText size={12} className="shrink-0" /> Review project history (AI)
          {selected?.projectName && (
            <span
              className="ml-1 truncate normal-case"
              style={{ color: "var(--text)" }}
            >
              · {selected.projectName}
            </span>
          )}
        </div>
        {/* Close only on mobile, where the panel is a full-screen overlay and
            the bid rail is hidden behind it. On desktop the panel just follows
            the bid's open/close, so no X is needed. */}
        {selected && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close project history"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-raised)] lg:hidden"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      {selected ? (
        <div className="min-h-0 flex-1">
          <ProjectAIAssistant
            key={selected.projectId}
            projectId={selected.projectId}
            projectName={selected.projectName ?? undefined}
          />
        </div>
      ) : (
        <EmptyAssistant />
      )}
    </div>
  );
}

// Disabled placeholder that mirrors the assistant's chrome so the panel looks
// the same whether or not a bid is open — minus the project name, the send
// button, and a live composer.
function EmptyAssistant() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Assistant header (matches ProjectAIAssistant) */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
        >
          <Sparkles size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="text-[12px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text)" }}
          >
            AI project assistant
          </div>
          <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
            Project context
          </div>
        </div>
        {/* New-chat + history — reserved but invisible until a bid is opened
            (the live assistant renders its own working versions then), so the
            header layout / box size stays identical between the two states. */}
        <div className="invisible flex shrink-0 items-center gap-0.5" aria-hidden>
          <span className="flex h-7 w-7 items-center justify-center">
            <Plus size={15} />
          </span>
          <span className="flex h-7 w-7 items-center justify-center">
            <HistoryIcon size={15} />
          </span>
        </div>
      </div>

      {/* Placeholder body */}
      <div className="flex flex-1 items-center justify-center px-6">
        <p className="max-w-xs text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Open a bid and click “Review project history (AI)” to preview the
          project’s context here.
        </p>
      </div>

      {/* Disabled composer — no send button. */}
      <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--border)" }}>
        <textarea
          disabled
          rows={2}
          placeholder="Open a bid to ask about the project"
          className="block w-full resize-none rounded-md border bg-transparent px-2.5 py-2 text-base opacity-60 outline-none md:text-[13px]"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        />
      </div>
    </div>
  );
}
