"use client";

/*
 * Try-Relay funnel — 3-question editorial wizard + Match Found.
 *
 * Q1: need (stuck / launch / maintain)
 * Q2: stack (3 columns multi-select)
 * Q3: urgency (now / this_week / planning)
 * → Match Found: live engineer pulled from /api/online-engineers, displayed
 *   with a pseudonym (first name + last initial), tech overlap, eta.
 *
 * "Start session now" mints a Supabase anonymous session (no email, no
 * password, no login screen), creates a real guest_calls session + intake,
 * rings an engineer via match_engineer, and lands the user in the actual
 * customer room (/room?newchat=1) — same UI as a signed-in customer.
 *
 * // TODO(auth): offer a magic-link upsell so a guest can keep their history
 *   by upgrading the anonymous session to a permanent account later.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";
import {
  NEED_OPTIONS,
  STACK_OPTIONS,
  URGENCY_OPTIONS,
  patchProfile,
  type Need,
  type ProfileStack,
  type Urgency,
} from "@/lib/relay/profile";

// Urgency → guest_calls.urgency enum used by the engineer queue ordering.
const URGENCY_TO_QUEUE: Record<Urgency, "critical" | "urgent" | "normal"> = {
  now: "urgent",
  this_week: "normal",
  planning: "normal",
};

type EngineerCandidate = {
  id: string;
  pseudoName: string;
  initials: string;
  technologies: string[];
  experienceYears: number;
  experienceLabel: string;
  etaSeconds: number;
  matchedTechnologies: string[];
};

type StackCat = "aiTools" | "backend" | "frontend";
type Step = 1 | 2 | 3 | 4;
const TOTAL_STEPS = 3;

export function TryRelayFunnel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [need, setNeed] = useState<Need | null>(null);
  const [stack, setStack] = useState<ProfileStack>({
    aiTools: [],
    backend: [],
    frontend: [],
  });
  const [urgency, setUrgency] = useState<Urgency | null>(null);
  const [engineer, setEngineer] = useState<EngineerCandidate | null>(null);
  const [matching, setMatching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stackTotal =
    stack.aiTools.length + stack.backend.length + stack.frontend.length;

  const canAdvance = useMemo(() => {
    if (step === 1) return need !== null;
    if (step === 2) return stackTotal > 0;
    if (step === 3) return urgency !== null;
    return false;
  }, [step, need, stackTotal, urgency]);

  const goNext = useCallback(() => {
    if (!canAdvance) return;
    if (step < TOTAL_STEPS) {
      setStep((s) => (s + 1) as Step);
      return;
    }
    setStep(4);
  }, [canAdvance, step]);

  const goBack = useCallback(() => {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }, [step]);

  // Step 4 — Match Found. Fetch a live online engineer that matches the
  // selected technologies. If none is online, fall back to a generic
  // available-engineer pool.
  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    setMatching(true);
    setError(null);
    const technologies = [...stack.aiTools, ...stack.backend, ...stack.frontend];
    const url = new URL("/api/online-engineers", window.location.origin);
    if (technologies.length) url.searchParams.set("technologies", technologies.join(","));
    if (need) url.searchParams.set("need", need);
    fetch(url.toString(), { method: "GET" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`engineers ${res.status}`);
        return (await res.json()) as { engineer: EngineerCandidate | null };
      })
      .then((j) => {
        if (cancelled) return;
        setEngineer(j.engineer);
        setMatching(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load engineer");
        setMatching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, stack, need]);

  // Drop the guest into the REAL customer room and ring an engineer — the
  // same pipeline a signed-in customer's "new chat" uses. We mint a Supabase
  // *anonymous* session so the guest gets a real auth.uid() (no email, no
  // password, no login screen), then create_project →
  // get_or_create_active_customer_session → client_intakes upsert →
  // match_engineer. The customer lands on /room?newchat=1 (the actual room
  // UI, unchanged) and the call appears in the engineer queue immediately.
  const startSession = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    // Mirror durable signals into the local profile snapshot.
    patchProfile({ urgency: urgency ?? undefined, stack });

    try {
      const sb = createClient();

      // 1. Anonymous auth — gives the guest a real auth.uid() with zero login.
      //    Anon users have no email, and get_or_create_active_customer_session
      //    derives guest_calls.guest_name (NOT NULL) from the user's
      //    full_name → email. Seed a full_name in the user metadata so the
      //    session insert doesn't hit a not-null violation.
      const { data: authData, error: authErr } = await sb.auth.getUser();
      if (!authData.user) {
        const { error: anonErr } = await sb.auth.signInAnonymously({
          options: { data: { full_name: "Guest" } },
        });
        if (anonErr) {
          // Anonymous sign-ins are disabled on the Supabase project. Surface a
          // clear message instead of silently failing. // TODO(auth): enable
          // "Allow anonymous sign-ins" in Supabase Auth settings.
          throw new Error(
            "Guest mode is unavailable right now. Please sign in to start a session.",
          );
        }
      } else if (authErr) {
        throw authErr;
      }

      const { data: who } = await sb.auth.getUser();
      const userId = who.user?.id;
      if (!userId) throw new Error("Could not start a guest session");

      // 2. Create a project for this guest chat.
      const { data: created, error: projErr } = await sb.rpc("create_project", {
        _name: "Try Relay",
      });
      if (projErr) throw projErr;
      const projectRow = Array.isArray(created)
        ? (created[0] as { id?: string; name?: string } | null)
        : (created as { id?: string; name?: string } | null);
      const projectId = projectRow?.id;
      const projectName = projectRow?.name ?? "Try Relay";
      if (!projectId) throw new Error("Could not create project");

      // 3. Mint the free session (new users get the 10-min free grant).
      const { data: callData, error: rpcErr } = await sb.rpc(
        "get_or_create_active_customer_session",
        { _project_id: projectId },
      );
      if (rpcErr) throw rpcErr;
      const session = (Array.isArray(callData) ? callData[0] : callData) as {
        id?: string;
      } | null;
      if (!session?.id) throw new Error("Could not create session");

      // 4. Upsert the intake row from the funnel answers so the engineer's
      //    tray + the matcher have context. The funnel skips tech-comfort, so
      //    familiarity defaults to Semi-Technical. // TODO(api): widen
      //    ai_tools_used to text[].
      const developing =
        need === "launch"
          ? "Website"
          : need === "maintain"
            ? "Website"
            : "Website";
      const intakePayload = {
        guest_call_id: session.id,
        customer_user_id: userId,
        project_id: projectId,
        familiarity: "Semi-Technical",
        ai_tools_used: stack.aiTools.join(", ") || "Other",
        developing,
        technologies: [...stack.backend, ...stack.frontend],
        declined_by: [] as string[],
      };
      const { data: intakeRow, error: intakeErr } = await sb
        .from("client_intakes")
        .upsert(intakePayload, { onConflict: "project_id,customer_user_id" })
        .select()
        .single();
      if (intakeErr) throw intakeErr;

      // 5. Record urgency on the session for queue ordering (best-effort).
      if (urgency) {
        await sb
          .from("guest_calls")
          .update({ urgency: URGENCY_TO_QUEUE[urgency] })
          .eq("id", session.id);
      }

      // 6. Ring engineers.
      await sb.rpc("match_engineer", { _intake_id: intakeRow.id as string });

      patchProfile({
        userId,
        stack,
        urgency: urgency ?? undefined,
        lastProjectId: projectId,
        lastProjectName: projectName,
      });

      onClose();
      // Land in the REAL room. ?newchat=1 shows the async chat pane while the
      // call queues — identical to the signed-in new-chat experience.
      router.push("/room?newchat=1");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not start your session",
      );
      setStarting(false);
    }
  }, [starting, need, stack, urgency, onClose, router]);

  return (
    <div
      className="mk-root-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tryrelay-funnel-title"
      onClick={onClose}
    >
      <div
        className="mk-root-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720 }}
      >
        <button
          type="button"
          className="mk-root-modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        {step < 4 ? (
          <>
            <FunnelHeader step={step} />
            <div style={{ marginTop: 16 }}>
              {step === 1 && (
                <RadioCardGroup
                  value={need}
                  onChange={setNeed}
                  options={NEED_OPTIONS}
                />
              )}
              {step === 2 && (
                <StackChipGroups stack={stack} onChange={setStack} />
              )}
              {step === 3 && (
                <RadioCardGroup
                  value={urgency}
                  onChange={setUrgency}
                  options={URGENCY_OPTIONS}
                />
              )}
            </div>
            <FunnelFooter
              step={step}
              canAdvance={canAdvance}
              isFinal={step === TOTAL_STEPS}
              onBack={step > 1 ? goBack : undefined}
              onNext={goNext}
            />
          </>
        ) : (
          <MatchFound
            engineer={engineer}
            matching={matching}
            starting={starting}
            error={error}
            onBack={() => setStep(3)}
            onStart={() => void startSession()}
          />
        )}
      </div>
    </div>
  );
}

// ── Steps 1-3 chrome ───────────────────────────────────────────────────────

function FunnelHeader({ step }: { step: Step }) {
  const titles: Record<Step, { headline: ReactNode; subline: string }> = {
    1: {
      headline: (
        <>
          What do you{" "}
          <em
            style={{
              fontStyle: "italic",
              color: "var(--primary, #3f5c2e)",
            }}
          >
            need
          </em>{" "}
          right now?
        </>
      ),
      subline:
        "We match you with the right engineer based on where you are in your build.",
    },
    2: {
      headline: (
        <>
          What are you{" "}
          <em
            style={{
              fontStyle: "italic",
              color: "var(--primary, #3f5c2e)",
            }}
          >
            building
          </em>{" "}
          with?
        </>
      ),
      subline:
        "We support 150+ integrations. Pick what matters — we'll match you with an engineer who's shipped on it.",
    },
    3: {
      headline: (
        <>
          How{" "}
          <em
            style={{
              fontStyle: "italic",
              color: "var(--primary, #3f5c2e)",
            }}
          >
            soon
          </em>{" "}
          do you need someone?
        </>
      ),
      subline:
        "Our engineers are available in seconds. But knowing your timeline helps us match better.",
    },
    4: { headline: "", subline: "" },
  };
  const t = titles[step];
  return (
    <header style={{ textAlign: "left" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 999,
          padding: "4px 10px",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--primary-hover, #2d4422)",
          background: "var(--primary-tint, rgba(63,92,46,0.08))",
        }}
      >
        Question {step} of {TOTAL_STEPS}
      </span>
      <h2
        id="tryrelay-funnel-title"
        style={{
          marginTop: 10,
          fontFamily: "var(--font-serif), serif",
          fontSize: 32,
          fontWeight: 500,
          lineHeight: 1.15,
          color: "var(--text, #1a1a1a)",
        }}
      >
        {t.headline}
      </h2>
      <p
        style={{
          marginTop: 8,
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--text-muted, #6b6b6b)",
          maxWidth: 580,
        }}
      >
        {t.subline}
      </p>
      <div
        aria-hidden
        style={{
          display: "flex",
          gap: 6,
          marginTop: 14,
        }}
      >
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <span
            key={i}
            style={{
              height: 6,
              width: 36,
              borderRadius: 999,
              background:
                i < step
                  ? "var(--primary, #3f5c2e)"
                  : "var(--surface-raised, #e8e8e2)",
              transition: "background 200ms ease",
            }}
          />
        ))}
      </div>
    </header>
  );
}

function FunnelFooter({
  canAdvance,
  isFinal,
  onBack,
  onNext,
  hint,
}: {
  step: Step;
  canAdvance: boolean;
  isFinal: boolean;
  onBack?: () => void;
  onNext: () => void;
  hint?: string;
}) {
  return (
    <div
      style={{
        marginTop: 20,
        paddingTop: 16,
        borderTop: "1px solid var(--border, #e8e8e2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        disabled={!onBack}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          color: "var(--text-muted, #6b6b6b)",
          fontSize: 14,
          cursor: onBack ? "pointer" : "not-allowed",
          opacity: onBack ? 1 : 0.4,
          padding: "8px 4px",
        }}
      >
        ← Back
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {hint ? (
          <span
            style={{
              fontSize: 12,
              color: "var(--text-muted, #6b6b6b)",
              fontStyle: "italic",
            }}
          >
            {hint}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onNext}
          disabled={!canAdvance}
          className="r-btn r-btn-green"
          style={{
            opacity: canAdvance ? 1 : 0.5,
            cursor: canAdvance ? "pointer" : "not-allowed",
          }}
        >
          {isFinal ? "Find my engineer →" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

// ── Radio cards ────────────────────────────────────────────────────────────

function RadioCardGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: ReadonlyArray<{
    value: T;
    label: string;
    description: string;
    emoji: string;
  }>;
}) {
  return (
    <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              textAlign: "left",
              padding: "14px 16px",
              borderRadius: 14,
              border: selected
                ? "1.5px solid var(--primary, #3f5c2e)"
                : "1px solid var(--border, #e8e8e2)",
              background: selected
                ? "var(--primary-tint, rgba(63,92,46,0.06))"
                : "var(--surface, #ffffff)",
              cursor: "pointer",
              transition: "border 150ms ease, background 150ms ease",
            }}
          >
            <span aria-hidden style={{ fontSize: 22, lineHeight: 1, marginTop: 2 }}>
              {opt.emoji}
            </span>
            <span style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text, #1a1a1a)",
                }}
              >
                {opt.label}
              </span>
              <span
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--text-muted, #6b6b6b)",
                }}
              >
                {opt.description}
              </span>
            </span>
            <span
              aria-hidden
              style={{
                marginTop: 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: 999,
                border: selected
                  ? "2px solid var(--primary, #3f5c2e)"
                  : "2px solid var(--border-strong, #d4d4cf)",
                background: selected ? "var(--primary, #3f5c2e)" : "transparent",
                color: "#fff",
              }}
            >
              {selected ? <Check size={12} strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Stack chip groups ──────────────────────────────────────────────────────

function StackChipGroups({
  stack,
  onChange,
}: {
  stack: ProfileStack;
  onChange: (s: ProfileStack) => void;
}) {
  const toggle = (cat: StackCat, opt: string) => {
    const cur = stack[cat];
    const has = cur.some((x) => x.toLowerCase() === opt.toLowerCase());
    onChange({
      ...stack,
      [cat]: has
        ? cur.filter((x) => x.toLowerCase() !== opt.toLowerCase())
        : [...cur, opt],
    });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {STACK_OPTIONS.map((group) => (
        <section key={group.category}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "var(--text-muted, #6b6b6b)",
              marginBottom: 8,
            }}
          >
            {group.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {group.options.map((opt) => {
              const selected = stack[group.category as StackCat].some(
                (x) => x.toLowerCase() === opt.toLowerCase(),
              );
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(group.category as StackCat, opt)}
                  className={cn("r-chip", selected && "r-chip-on")}
                  style={{
                    appearance: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: 13,
                    border: selected
                      ? "1px solid var(--primary, #3f5c2e)"
                      : "1px solid var(--border, #e8e8e2)",
                    background: selected
                      ? "var(--primary-tint, rgba(63,92,46,0.08))"
                      : "var(--surface, #ffffff)",
                    color: selected
                      ? "var(--primary-hover, #2d4422)"
                      : "var(--text, #1a1a1a)",
                    cursor: "pointer",
                    transition: "border 150ms ease, background 150ms ease",
                  }}
                >
                  {selected ? <Check size={11} strokeWidth={3} /> : null}
                  {opt}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Match Found ────────────────────────────────────────────────────────────

function MatchFound({
  engineer,
  matching,
  starting,
  error,
  onBack,
  onStart,
}: {
  engineer: EngineerCandidate | null;
  matching: boolean;
  starting: boolean;
  error: string | null;
  onBack: () => void;
  onStart: () => void;
}) {
  return (
    <div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 999,
          padding: "4px 10px",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--primary-hover, #2d4422)",
          background: "var(--primary-tint, rgba(63,92,46,0.08))",
        }}
      >
        ✎ Match found
      </span>
      {matching ? (
        <div
          style={{
            marginTop: 20,
            padding: "40px 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            color: "var(--text-muted, #6b6b6b)",
          }}
        >
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: 14 }}>Finding an engineer who's shipped on your stack…</span>
        </div>
      ) : engineer ? (
        <>
          <h2
            style={{
              marginTop: 10,
              fontFamily: "var(--font-serif), serif",
              fontSize: 30,
              fontWeight: 500,
              lineHeight: 1.15,
              color: "var(--text, #1a1a1a)",
            }}
          >
            {engineer.pseudoName.split(" ")[0]} is ready.
          </h2>
          <p style={{ marginTop: 6, fontSize: 14, color: "var(--text-muted, #6b6b6b)" }}>
            {engineer.experienceLabel} engineer · {engineer.experienceYears} yrs
            {engineer.matchedTechnologies.length
              ? ` · ${engineer.matchedTechnologies.slice(0, 3).join(", ")}`
              : ""}
          </p>

          <div
            style={{
              marginTop: 18,
              padding: 16,
              borderRadius: 14,
              border: "1px solid var(--border, #e8e8e2)",
              background: "var(--surface, #ffffff)",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background: "var(--primary-tint, rgba(63,92,46,0.12))",
                color: "var(--primary-hover, #2d4422)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-serif), serif",
                fontWeight: 600,
                fontSize: 18,
              }}
            >
              {engineer.initials}
            </span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text, #1a1a1a)",
                }}
              >
                {engineer.pseudoName}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted, #6b6b6b)" }}>
                Available now · ~{engineer.etaSeconds}s to join
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {engineer.technologies.slice(0, 5).map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--surface-raised, #f4f4f0)",
                      color: "var(--text, #1a1a1a)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 12,
              background: "var(--primary-tint, rgba(63,92,46,0.06))",
              border: "1px dashed var(--primary, #3f5c2e)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text, #1a1a1a)",
              }}
            >
              First session
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-muted, #6b6b6b)",
                marginTop: 2,
              }}
            >
              10 minutes on us. No card required.{" "}
              <strong style={{ color: "var(--primary-hover, #2d4422)" }}>Free</strong>
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: "var(--text, #1a1a1a)",
              }}
            >
              Base plan (100 min) · <strong>€50</strong>
            </div>
          </div>

          <div
            style={{
              marginTop: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <button
              type="button"
              onClick={onBack}
              disabled={starting}
              style={{
                appearance: "none",
                background: "transparent",
                border: "none",
                color: "var(--text-muted, #6b6b6b)",
                fontSize: 14,
                cursor: starting ? "not-allowed" : "pointer",
                opacity: starting ? 0.4 : 1,
                padding: "8px 4px",
              }}
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="r-btn r-btn-green"
              style={{
                opacity: starting ? 0.7 : 1,
                cursor: starting ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {starting ? (
                <>
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Connecting you…
                </>
              ) : (
                "Start session now →"
              )}
            </button>
          </div>
          {error ? (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "var(--danger, #b3261e)",
                textAlign: "center",
              }}
            >
              {error}
            </div>
          ) : (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "var(--text-muted, #6b6b6b)",
                textAlign: "center",
              }}
            >
              Chat · Voice · Screen share, your choice
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--border, #e8e8e2)",
            background: "var(--surface, #ffffff)",
          }}
        >
          <div style={{ fontSize: 14, color: "var(--text, #1a1a1a)" }}>
            No engineers online right now.
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted, #6b6b6b)", marginTop: 6 }}>
            {error
              ? `(${error})`
              : "Hop into the room — we'll page someone the moment they're back."}
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            <button
              type="button"
              onClick={onBack}
              disabled={starting}
              style={{
                appearance: "none",
                background: "transparent",
                border: "none",
                color: "var(--text-muted, #6b6b6b)",
                fontSize: 14,
                cursor: starting ? "not-allowed" : "pointer",
                opacity: starting ? 0.4 : 1,
              }}
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="r-btn r-btn-green"
              style={{
                opacity: starting ? 0.7 : 1,
                cursor: starting ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {starting ? (
                <>
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Connecting you…
                </>
              ) : (
                "Open the room →"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
