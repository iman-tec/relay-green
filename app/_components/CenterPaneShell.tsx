"use client";

/*
 * Center-pane shell for the room's Scheduled / Contracts views. Provides the
 * Back affordance, an optional "Return to call" (during a live session), and a
 * narrow, horizontally-centered content column (no full-bleed width).
 */

import { ArrowLeft, PhoneCall } from "lucide-react";

export function CenterPaneShell({
  title,
  hasActiveSession,
  onReturnToCall,
  onClose,
  children,
}: {
  title?: string;
  hasActiveSession: boolean;
  onReturnToCall: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <div className="flex items-center gap-2 px-6 pt-5">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={15} /> Back
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
      {title && (
        <h1
          className="px-6 pt-3 font-serif text-3xl"
          style={{ color: "var(--text)" }}
        >
          {title}
        </h1>
      )}
      <div className="hide-scrollbar mt-3 flex-1 overflow-y-auto px-6 pb-6">
        {children}
      </div>
    </div>
  );
}
