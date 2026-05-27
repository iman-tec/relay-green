"use client";

/*
 * Two-factor project-deletion confirmation modal.
 *
 * Deleting a project drops all its sessions into the General bucket
 * (the FK on guest_calls.project_id is ON DELETE SET NULL) and the
 * project metadata + saved drafts are wiped from localStorage. This
 * is destructive enough that we want the customer to actively prove
 * intent before pulling the trigger.
 *
 * Three gates, all required:
 *   1. Their account password (verified by re-signing-in via
 *      Supabase — succeeds if the password is correct, fails
 *      otherwise; we don't actually change session state).
 *   2. The exact project name typed back to them.
 *   3. The literal phrase "delete the project" typed verbatim.
 *
 * Only when all three pass does the Delete button activate. The
 * actual delete then runs in onConfirm — caller is responsible for
 * the DELETE FROM projects + localStorage cleanup + sidebar refetch.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Input } from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";

const REQUIRED_PHRASE = "delete the project";

export function DeleteProjectModal({
  projectId,
  projectName,
  customerEmail,
  onConfirm,
  onClose,
}: {
  projectId: string;
  projectName: string;
  /** Customer's email — used as the username when verifying the
   *  password via Supabase signInWithPassword. */
  customerEmail: string;
  /** Called when all three gates pass. Caller does the actual
   *  delete + cleanup work (this modal only verifies intent). */
  onConfirm: (projectId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password,    setPassword]    = useState("");
  const [nameInput,   setNameInput]   = useState("");
  const [phraseInput, setPhraseInput] = useState("");
  const [verifying,   setVerifying]   = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  // Scroll-lock + Tab-trap + Esc-closes (top layer). Focus is re-pointed at
  // the password field by the effect below.
  const dialogRef = useOverlayDismiss(onClose);

  // Focus the password field on open — saves the customer one tab.
  // Query-based focus avoids needing a ref into the Input component
  // (which is wrapped — passing refs through is fragile).
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="password"][autocomplete="current-password"]');
      el?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Gate checks — all three must pass before Delete activates.
  const nameMatches   = nameInput.trim() === projectName.trim();
  const phraseMatches = phraseInput.trim().toLowerCase() === REQUIRED_PHRASE;
  const passwordReady = password.length > 0;
  const allGatesReady = nameMatches && phraseMatches && passwordReady && !verifying;

  const handleConfirm = useCallback(async () => {
    if (!allGatesReady) return;
    setVerifying(true);
    setError(null);
    try {
      // Verify the password by signing in. Supabase's
      // signInWithPassword issues a fresh token; the previous session
      // is replaced atomically, so even if the customer was on a stale
      // session the new one is valid for the immediately-following
      // delete RPC.
      const sb = createClient();
      const { error: authErr } = await sb.auth.signInWithPassword({
        email: customerEmail,
        password,
      });
      if (authErr) {
        // Don't leak Supabase's raw error to the user — most of them
        // ("Invalid login credentials") are fine to surface as-is but
        // some leak email-validation details. Normalize to a single
        // friendly line.
        setError("That password isn't right. Try again.");
        setVerifying(false);
        return;
      }

      // Password ok → run the caller's destructive action.
      await onConfirm(projectId);
      // If onConfirm throws, the catch below handles it. If it
      // succeeds, the caller is responsible for closing the modal
      // (typically via state mutation that unmounts us).
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the project — try again.");
      setVerifying(false);
    }
  }, [allGatesReady, customerEmail, password, projectId, onConfirm]);

  return (
    <>
      {/* Backdrop. Click outside dismisses; verifying state blocks
          so the user can't accidentally close mid-network. */}
      <div
        className="fixed inset-0 z-[var(--z-modal)]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={verifying ? undefined : onClose}
      />

      {/* Modal panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: "color-mix(in srgb, var(--accent-red) 12%, transparent)",
              color: "var(--accent-red)",
            }}
          >
            <AlertTriangle size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="delete-project-title"
              className="text-[15px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              Delete project
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              You&apos;re about to permanently delete{" "}
              <strong style={{ color: "var(--text)" }}>{projectName}</strong>. Past sessions
              tied to it move to the General bucket; saved drafts, project metadata, and
              the project entry itself are removed. This can&apos;t be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={verifying}
            aria-label="Close"
            title="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — three gates */}
        <div className="flex flex-col gap-4 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
              Step 1 of 3 · Password
            </div>
            <Input
              type="password"
              placeholder="Your account password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={verifying}
            />
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
              Step 2 of 3 · Type the project name
            </div>
            <Input
              placeholder={projectName}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              disabled={verifying}
            />
            {nameInput.length > 0 && !nameMatches && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
                Must match <strong style={{ color: "var(--text-muted)" }}>{projectName}</strong> exactly.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
              Step 3 of 3 · Type{" "}
              <span style={{ color: "var(--accent-red)" }}>&ldquo;{REQUIRED_PHRASE}&rdquo;</span>
            </div>
            <Input
              placeholder={REQUIRED_PHRASE}
              value={phraseInput}
              onChange={(e) => setPhraseInput(e.target.value)}
              disabled={verifying}
            />
          </div>

          {error && (
            <div
              className="rounded-md border px-3 py-2 text-[12px]"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
                color: "var(--accent-red)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer — Cancel + destructive Delete. Plain styled buttons
            (vs the UI Button component) so the destructive variant
            uses var(--accent-red) without fighting the primary palette. */}
        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={verifying}
            className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!allGatesReady}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: "var(--accent-red)" }}
          >
            {verifying ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {verifying ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </div>
    </>
  );
}
