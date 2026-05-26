"use client";

/*
 * QuoteRequestModal — two-step modal customers use to submit an inbound
 * lead to the Relay team:
 *
 *   Step 1: pick which project the quote is for.
 *   Step 2: add free-form comments and submit.
 *
 * Two kinds, distinguished by the `kind` prop:
 *   • "golive"   — customer wants to ship the project (one-shot launch)
 *   • "maintain" — ongoing maintenance / enhancement work
 *
 * The actual quote isn't computed in-app. The submission lands in
 * project_quote_requests; supervisor + engineer see it in their /inbox /
 * /supervise queues (engineer-parity work) and reply over email — the
 * customer is told "we'll get back to you within 24 hours."
 *
 * See supabase/migrations/20260527210000_project_quote_requests.sql for
 * the table + create_project_quote_request RPC + RLS.
 */

import { useState } from "react";
import { Loader2, X, ChevronLeft, Check, Send, Rocket, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "var(--primary-soft)";

export type QuoteKind = "golive" | "maintain";

export type QuoteProjectOption = {
  id: string;
  name: string;
};

export function QuoteRequestModal({
  kind,
  projects,
  initialProjectId,
  onClose,
}: {
  kind: QuoteKind;
  projects: QuoteProjectOption[];
  /** If the customer was already viewing a project when they clicked, pre-select it. */
  initialProjectId?: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"pick" | "details" | "done">(
    initialProjectId ? "details" : "pick",
  );
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Single source of truth for kind-specific copy. Keeping it here so the
  // step bodies below stay short — they pull from this map instead of
  // ternary-branching at every label.
  const copy = kind === "golive"
    ? {
        Icon: Rocket,
        eyebrow: "Quote to GoLive",
        title: "Ready to ship this project?",
        blurb: "Pick the project you want to take live. Your engineer and a supervisor will reply with a fixed-scope quote over email within 24 hours.",
        commentLabel: "Anything they should know? (timelines, scope, integrations…)",
        successTitle: "Sent — we'll reply within 24 hours.",
        successBody: "Your engineer and a supervisor were notified. Expect a fixed-scope launch quote in your inbox.",
      }
    : {
        Icon: Wrench,
        eyebrow: "Quote to Maintain / Enhance",
        title: "Keep building after launch?",
        blurb: "Pick the project. Your engineer + a supervisor will scope the maintenance or enhancement work and email back with an effort estimate within 24 hours.",
        commentLabel: "What needs maintaining or enhancing?",
        successTitle: "Sent — we'll reply within 24 hours.",
        successBody: "Your engineer and a supervisor were notified. Expect an effort estimate in your inbox.",
      };

  const { Icon } = copy;

  const handleSubmit = async () => {
    if (!projectId || submitting) return;
    setSubmitting(true);
    setErrMsg(null);
    try {
      const sb = createClient();
      const { error } = await sb.rpc("create_project_quote_request", {
        _project_id: projectId,
        _kind: kind,
        _comments: comments.trim() || null,
      });
      if (error) throw new Error(error.message);
      setStep("done");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Couldn't send the request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[61] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header — eyebrow + close, plus a back arrow when we're past
            the pick step. */}
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
          >
            <Icon size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: BRAND_GREEN }}>
              {copy.eyebrow}
            </div>
            <h2 className="mt-0.5 text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              {step === "done" ? copy.successTitle : copy.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Step body. Separate render branches by step rather than one
            big composite — each branch is short and avoids the "and then
            this depending on whether we're in pick or details" flag
            soup that the old PaywallModal hit. */}
        {step === "pick" && (
          <PickProjectStep
            projects={projects}
            blurb={copy.blurb}
            onPick={(id) => { setProjectId(id); setStep("details"); }}
            onClose={onClose}
          />
        )}

        {step === "details" && projectId && (
          <DetailsStep
            project={projects.find((p) => p.id === projectId) ?? null}
            blurb={copy.blurb}
            commentLabel={copy.commentLabel}
            comments={comments}
            setComments={setComments}
            submitting={submitting}
            errMsg={errMsg}
            onBack={() => { setStep("pick"); setErrMsg(null); }}
            onSubmit={() => void handleSubmit()}
            hideBack={!!initialProjectId && step === "details"}
          />
        )}

        {step === "done" && (
          <DoneStep blurb={copy.successBody} onClose={onClose} />
        )}
      </div>
    </>
  );
}

// ── Step 1: pick a project ───────────────────────────────────────────
function PickProjectStep({
  projects, blurb, onPick, onClose,
}: {
  projects: QuoteProjectOption[];
  blurb: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {blurb}
      </p>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
        Pick a project
      </div>
      {projects.length === 0 ? (
        <div
          className="rounded-lg border px-3 py-3 text-[12px]"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)", color: "var(--text-muted)" }}
        >
          No projects yet. Start a session first — once a project exists you can request a quote on it.
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] underline-offset-2 hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p.id)}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--text)" }}>
                  {p.name}
                </span>
                <ChevronLeft size={12} className="rotate-180" style={{ color: "var(--text-muted)" }} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Step 2: comments + submit ─────────────────────────────────────────
function DetailsStep({
  project, blurb, commentLabel, comments, setComments,
  submitting, errMsg, onBack, onSubmit, hideBack,
}: {
  project: QuoteProjectOption | null;
  blurb: string;
  commentLabel: string;
  comments: string;
  setComments: (v: string) => void;
  submitting: boolean;
  errMsg: string | null;
  onBack: () => void;
  onSubmit: () => void;
  hideBack: boolean;
}) {
  return (
    <div className="px-5 py-4">
      {!hideBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="mb-3 inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline disabled:opacity-50"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronLeft size={11} /> Pick a different project
        </button>
      )}
      <div
        className="mb-3 rounded-lg border px-3 py-2 text-[12px]"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
          Project
        </div>
        <div className="mt-0.5 text-[13px]" style={{ color: "var(--text)" }}>
          {project?.name ?? "—"}
        </div>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {blurb}
      </p>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
        {commentLabel}
      </label>
      <textarea
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        disabled={submitting}
        rows={5}
        placeholder="Optional — anything that'd help us scope it. You can also reply over email later."
        className="block w-full rounded-md border bg-transparent p-2 text-[13px] leading-relaxed outline-none focus:ring-2"
        style={{
          borderColor: "var(--border)",
          color: "var(--text)",
          ["--tw-ring-color" as string]: "color-mix(in srgb, var(--primary) 35%, transparent)",
        }}
      />
      {errMsg && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--accent-red)" }}>{errMsg}</p>
      )}
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
      >
        {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        {submitting ? "Sending…" : "Send for estimation"}
      </button>
    </div>
  );
}

// ── Step 3: success ───────────────────────────────────────────────────
function DoneStep({ blurb, onClose }: { blurb: string; onClose: () => void }) {
  return (
    <div className="px-5 py-6 text-center">
      <div
        className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        <Check size={18} />
      </div>
      <p className="mx-auto max-w-xs text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {blurb}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[11.5px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        Done
      </button>
    </div>
  );
}
