"use client";

/*
 * Themed confirm dialog. Replaces the browser-native window.confirm()
 * everywhere the admin surfaces ask "are you sure?" so the prompt
 * matches the rest of the dark UI instead of the operating-system pop-up.
 *
 * Usage (functional):
 *
 *   const confirmDialog = useConfirmDialog();
 *   ...
 *   const ok = await confirmDialog.ask({
 *     title:   "Send fresh sign-in email?",
 *     message: `${email} will receive a new magic-link email.`,
 *     confirmLabel: "Send invite",
 *     tone:     "neutral",   // or "danger" for destructive actions
 *   });
 *   if (!ok) return;
 *
 * Place <confirmDialog.element /> once in the component tree (under the
 * page's main content) so the modal mounts.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

const BRAND_GREEN = "var(--primary)";
type AskOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "neutral" | "danger";
};

type PendingResolver = ((ok: boolean) => void) | null;

type DialogState = (AskOptions & { open: true }) | { open: false };

export function useConfirmDialog() {
  const [state, setState] = useState<DialogState>({ open: false });
  const [resolver, setResolver] = useState<PendingResolver>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((opts: AskOptions): Promise<boolean> => {
    setState({ open: true, ...opts });
    setBusy(false);
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      resolver?.(ok);
      setResolver(null);
      setState({ open: false });
    },
    [resolver]
  );

  // Escape closes (cancel).
  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open, busy, close]);

  const element = state.open ? (
    <ConfirmDialogModal
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel ?? "Confirm"}
      cancelLabel={state.cancelLabel ?? "Cancel"}
      tone={state.tone ?? "neutral"}
      busy={busy}
      onCancel={() => !busy && close(false)}
      onConfirm={() => {
        setBusy(true);
        close(true);
      }}
    />
  ) : null;

  return { ask, element };
}

function ConfirmDialogModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "neutral" | "danger";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmBg = tone === "danger" ? "var(--accent-red)" : BRAND_GREEN;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
        animation: "relay-fade-in 120ms ease-out",
      }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border p-5 shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          color: "var(--text)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            className="text-sm leading-tight font-semibold"
            style={{ color: "var(--text)" }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>
        {message && (
          <p
            className="mt-2 text-[13px] leading-snug"
            style={{ color: "var(--text-muted)" }}
          >
            {message}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: confirmBg }}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
