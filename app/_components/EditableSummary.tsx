"use client";

/*
 * EditableSummary — shared inline-edit surface for the post-session AI
 * summary block. Renders three fields (title, overview, next steps) with
 * hover-revealed edit affordances; when canEdit is true, clicking the
 * pencil enters that field into edit mode with Save / Cancel buttons.
 *
 * Used by both /room (customer) and /staff/session/[id] (engineer). The
 * server-side RPC update_guest_call_summary enforces that the caller is
 * either the session's customer or its claimed_by engineer — see
 * supabase/migrations/20260527160000_guest_calls_summary_edits.sql.
 *
 * One section is editable at a time so the UI never has multiple unsaved
 * patches in flight. Local optimistic state is held only for the field
 * currently being edited; once the RPC resolves, the realtime sub on the
 * guest_calls row delivers the canonical updated values from the server
 * and re-renders the read view.
 *
 * Keyboard:
 *   - Esc        — cancel current edit
 *   - Cmd/Ctrl+Enter — save current edit (multiline-friendly)
 *
 * "Next steps" array shape: each entry is either a string OR an object
 * with { text } / { description }. We accept both on read but always
 * write strings — the schema is permissive but the human edit path
 * shouldn't be introducing object envelopes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2, Plus, Loader2, Check, X } from "lucide-react";

const BRAND_GREEN = "var(--primary)";

/** Loose union — the AI fn sometimes writes plain strings, sometimes objects. */
export type RawNextStep = string | { text?: string; description?: string };

export type EditableSummaryProps = {
  title: string | null | undefined;
  overview: string | null | undefined;
  nextSteps: RawNextStep[];
  /** When false, the component renders read-only (no pencils, no add button). */
  canEdit: boolean;
  /** Disable all editing affordances (e.g. while summary is still generating). */
  disabled?: boolean;
  /**
   * Save handler. Receives only the fields that changed; pass through to
   * the update_guest_call_summary RPC. Should resolve after the server
   * confirms the write; throws to surface an error.
   */
  onSave: (patch: {
    title?: string | null;
    overview?: string | null;
    nextSteps?: string[];
  }) => Promise<void>;
};

type EditMode =
  | { kind: "none" }
  | { kind: "title" }
  | { kind: "overview" }
  | { kind: "step"; index: number }
  | { kind: "newStep" };

/** Flatten the loose array into plain strings — that's what we save back. */
function normalize(steps: RawNextStep[]): string[] {
  return steps
    .map((s) => (typeof s === "string" ? s : (s.text ?? s.description ?? "")))
    .filter((s) => s.trim().length > 0);
}

export function EditableSummary({
  title,
  overview,
  nextSteps,
  canEdit,
  disabled = false,
  onSave,
}: EditableSummaryProps) {
  const [mode, setMode] = useState<EditMode>({ kind: "none" });
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Normalize once per render — used by both the read view and the
  // "save next steps" patch builder so they stay in sync.
  const flatSteps = useMemo(() => normalize(nextSteps), [nextSteps]);

  const cancel = useCallback(() => {
    setMode({ kind: "none" });
    setDraft("");
    setError(null);
  }, []);

  // Enter edit mode AND seed the draft together — keeps mode/draft
  // in sync without a "setState in effect" round trip (which lint
  // — correctly — warns about as a source of cascading renders).
  const enterMode = useCallback(
    (next: EditMode) => {
      setMode(next);
      if (next.kind === "title") setDraft(title ?? "");
      else if (next.kind === "overview") setDraft(overview ?? "");
      else if (next.kind === "step") setDraft(flatSteps[next.index] ?? "");
      else if (next.kind === "newStep") setDraft("");
      setError(null);
    },
    [title, overview, flatSteps]
  );

  const commit = useCallback(async () => {
    if (saving) return;
    const trimmed = draft.trim();
    setSaving(true);
    setError(null);
    try {
      if (mode.kind === "title") {
        await onSave({ title: trimmed || null });
      } else if (mode.kind === "overview") {
        await onSave({ overview: trimmed || null });
      } else if (mode.kind === "step") {
        // Replace step at index. Empty trim → treat as delete.
        const next = [...flatSteps];
        if (trimmed) next[mode.index] = trimmed;
        else next.splice(mode.index, 1);
        await onSave({ nextSteps: next });
      } else if (mode.kind === "newStep") {
        if (!trimmed) {
          // No-op add — just exit edit mode.
          cancel();
          setSaving(false);
          return;
        }
        await onSave({ nextSteps: [...flatSteps, trimmed] });
      }
      setMode({ kind: "none" });
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }, [saving, draft, mode, flatSteps, onSave, cancel]);

  const deleteStep = useCallback(
    async (idx: number) => {
      if (saving) return;
      setSaving(true);
      setError(null);
      try {
        const next = flatSteps.slice();
        next.splice(idx, 1);
        await onSave({ nextSteps: next });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete step.");
      } finally {
        setSaving(false);
      }
    },
    [saving, flatSteps, onSave]
  );

  // ── Render ──────────────────────────────────────────────────────────
  // We render each of the three field-blocks as its own subtree. This is
  // long but keeps the editing/read branches close together for each
  // field, which makes the UX easier to scan than a giant single block.

  return (
    <div className="space-y-5">
      {/* Title */}
      {mode.kind === "title" ? (
        <EditField
          autoFocus
          multiline={false}
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
          saving={saving}
          inputClassName="text-xl font-medium"
          inputStyle={{
            fontFamily: "var(--font-source-serif)",
            color: "var(--text)",
            letterSpacing: "-0.01em",
          }}
          placeholder="Session title"
        />
      ) : title ? (
        <HoverBlock
          canEdit={canEdit && !disabled}
          onEdit={() => enterMode({ kind: "title" })}
        >
          <h2
            className="text-xl font-medium"
            style={{
              fontFamily: "var(--font-source-serif)",
              color: "var(--text)",
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
        </HoverBlock>
      ) : (
        canEdit &&
        !disabled && (
          <button
            type="button"
            onClick={() => enterMode({ kind: "title" })}
            className="text-xs underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            + Add a title
          </button>
        )
      )}

      {/* Overview */}
      {mode.kind === "overview" ? (
        <EditField
          autoFocus
          multiline
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
          saving={saving}
          inputClassName="whitespace-pre-wrap text-sm leading-relaxed"
          inputStyle={{ color: "var(--text)" }}
          placeholder="Session summary"
          minRows={4}
        />
      ) : overview ? (
        <HoverBlock
          canEdit={canEdit && !disabled}
          onEdit={() => enterMode({ kind: "overview" })}
        >
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap"
            style={{ color: "var(--text)" }}
          >
            {overview}
          </p>
        </HoverBlock>
      ) : (
        canEdit &&
        !disabled && (
          <button
            type="button"
            onClick={() => enterMode({ kind: "overview" })}
            className="text-xs underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            + Add an overview
          </button>
        )
      )}

      {/* Next steps */}
      {(flatSteps.length > 0 || (canEdit && !disabled)) && (
        <div>
          <h3
            className="mb-2 text-[10px] font-semibold tracking-wider uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Next steps
          </h3>
          <ul className="space-y-1.5">
            {flatSteps.map((step, i) =>
              mode.kind === "step" && mode.index === i ? (
                <li key={i} className="flex gap-2">
                  <span className="pt-1 text-sm" style={{ color: BRAND_GREEN }}>
                    →
                  </span>
                  <div className="flex-1">
                    <EditField
                      autoFocus
                      multiline
                      value={draft}
                      onChange={setDraft}
                      onCommit={commit}
                      onCancel={cancel}
                      saving={saving}
                      inputClassName="text-sm"
                      inputStyle={{ color: "var(--text)" }}
                      placeholder="Next step"
                      minRows={1}
                    />
                  </div>
                </li>
              ) : (
                <StepRow
                  key={i}
                  text={step}
                  canEdit={canEdit && !disabled}
                  busy={saving}
                  onEdit={() => enterMode({ kind: "step", index: i })}
                  onDelete={() => void deleteStep(i)}
                />
              )
            )}
            {mode.kind === "newStep" && (
              <li className="flex gap-2">
                <span className="pt-1 text-sm" style={{ color: BRAND_GREEN }}>
                  →
                </span>
                <div className="flex-1">
                  <EditField
                    autoFocus
                    multiline
                    value={draft}
                    onChange={setDraft}
                    onCommit={commit}
                    onCancel={cancel}
                    saving={saving}
                    inputClassName="text-sm"
                    inputStyle={{ color: "var(--text)" }}
                    placeholder="New step"
                    minRows={1}
                  />
                </div>
              </li>
            )}
          </ul>
          {canEdit && !disabled && mode.kind !== "newStep" && (
            <button
              type="button"
              onClick={() => enterMode({ kind: "newStep" })}
              className="mt-2 inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              <Plus size={11} /> Add a step
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: "var(--accent-red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

/**
 * Wraps a read-only field with a hover-revealed pencil button in the
 * top-right. The pencil only renders when canEdit is true, so the
 * read-only path (e.g. supervisor view, or non-participant) sees the
 * same layout without the affordance.
 */
function HoverBlock({
  canEdit,
  onEdit,
  children,
}: {
  canEdit: boolean;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  if (!canEdit) return <>{children}</>;
  return (
    <div className="group relative">
      {children}
      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit"
        className="absolute top-0 right-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/5 focus:opacity-100 dark:hover:bg-white/5"
        style={{ color: "var(--text-muted)" }}
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}

/**
 * Single next-step row in read mode. Hovering the row reveals edit +
 * delete icons on the right. Mirrors the WhatsApp-style kebab pattern
 * used in the chat composer for consistency.
 */
function StepRow({
  text,
  canEdit,
  busy,
  onEdit,
  onDelete,
}: {
  text: string;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className="group flex items-start gap-2 text-sm"
      style={{ color: "var(--text)" }}
    >
      <span style={{ color: BRAND_GREEN }}>→</span>
      <span className="flex-1">{text}</span>
      {canEdit && (
        <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            aria-label="Edit step"
            className="rounded p-1 hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label="Delete step"
            className="rounded p-1 hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <Trash2 size={11} />
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * Inline edit input/textarea with Save / Cancel chips. Used for all three
 * field types — title, overview, and step rows — by varying the styling
 * + multiline flag. Keeps editing logic in one place.
 */
function EditField({
  autoFocus = false,
  multiline,
  value,
  onChange,
  onCommit,
  onCancel,
  saving,
  inputClassName,
  inputStyle,
  placeholder,
  minRows = 1,
}: {
  autoFocus?: boolean;
  multiline: boolean;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  saving: boolean;
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
  placeholder?: string;
  minRows?: number;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    // Place caret at end so editing existing text doesn't yank focus to
    // the start (which is the browser default for autoFocus on textarea).
    if (inputRef.current && "value" in inputRef.current) {
      const len = inputRef.current.value.length;
      try {
        inputRef.current.setSelectionRange(len, len);
      } catch {
        // Some input types don't support selectionRange; safe to ignore.
      }
    }
  }, [autoFocus]);

  const onKey = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !multiline)) {
      e.preventDefault();
      void onCommit();
    }
  };

  const inputBase =
    "block w-full rounded-md border bg-transparent px-2 py-1.5 outline-none focus:ring-2";
  const inputColors = {
    borderColor: "var(--border)",
    ["--tw-ring-color" as string]:
      "color-mix(in srgb, var(--primary) 35%, transparent)",
  } as React.CSSProperties;

  return (
    <div className="flex flex-col gap-1.5">
      {multiline ? (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          rows={minRows}
          disabled={saving}
          placeholder={placeholder}
          className={`${inputBase} ${inputClassName ?? ""}`}
          style={{ ...inputColors, ...inputStyle }}
        />
      ) : (
        <input
          ref={(el) => {
            inputRef.current = el;
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          disabled={saving}
          placeholder={placeholder}
          className={`${inputBase} ${inputClassName ?? ""}`}
          style={{ ...inputColors, ...inputStyle }}
        />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onCommit()}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-50"
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
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={10} />
          Cancel
        </button>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {multiline
            ? "Cmd/Ctrl+Enter to save · Esc to cancel"
            : "Enter to save · Esc to cancel"}
        </span>
      </div>
    </div>
  );
}
