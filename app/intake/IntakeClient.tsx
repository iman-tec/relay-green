"use client";

/*
 * Client intake — editorial flow.
 *
 * Two paths:
 *   • First-time user → full 4-step editorial intake (tech comfort →
 *                       stack chip groups → what-you're-building → urgency).
 *   • Returning user (hasFullIntake from local profile) → QuickReturnIntake
 *                       (lightweight "Is this for [Project]?" screen).
 *
 * Existing data contract preserved:
 *   client_intakes(familiarity, ai_tools_used, developing, technologies)
 *
 * New durable signals (techComfort, stack arrays, urgency) are mirrored into
 * a local profile-context object (lib/relay/profile.ts) so returning users
 * skip the heavy intake. // TODO(profile): wire to a real backend store.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, X, Check } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { Button, Card, CardBody, Toast, cn } from "@/app/_components/ui";
import { QuickReturnIntake } from "@/app/_components/intake/QuickReturnIntake";
import { createClient } from "@/lib/supabase/browser";
import {
  hasFullIntake,
  patchProfile,
  readProfile,
  STACK_OPTIONS,
  TECH_COMFORT_OPTIONS,
  URGENCY_OPTIONS,
  type ProfileSnapshot,
  type ProfileStack,
  type TechComfort,
  type Urgency,
} from "@/lib/relay/profile";

const DEVELOPING_OPTIONS: ReadonlyArray<{
  value: "Website" | "Mobile App" | "IoT System" | "AIML product";
  label: string;
  description: string;
  emoji: string;
}> = [
  { value: "Website", label: "Website / web app", description: "Browser-based product, dashboard, or marketing site.", emoji: "🌐" },
  { value: "Mobile App", label: "Mobile app", description: "iOS, Android, or cross-platform.", emoji: "📱" },
  { value: "IoT System", label: "IoT / hardware", description: "Devices, sensors, embedded systems.", emoji: "🔌" },
  { value: "AIML product", label: "AI / ML product", description: "Model, pipeline, or AI-first feature.", emoji: "🤖" },
];

const ACTIVE_SESSION_STATES = [
  "queued", "assigned", "joining", "live", "grace", "ending", "expired_free",
] as const;

const TOTAL_STEPS = 4;

type StackCat = "aiTools" | "backend" | "frontend";
type DevelopingValue = (typeof DEVELOPING_OPTIONS)[number]["value"];

export function IntakeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get("projectId");

  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [forceFullIntake, setForceFullIntake] = useState(false);
  // Returning user starting a NEW project (§1.2): skip Q1 (tech expertise is
  // permanent) but still ask Q2–Q4 for this project. Carries the chosen name.
  const [newProjectMode, setNewProjectMode] = useState(false);
  const [newProjectName, setNewProjectName] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editorial intake state. Initial values prefill from profile so users who
  // come back via the "answer the full intake" link don't lose ground.
  const [techComfort, setTechComfort] = useState<TechComfort | null>(null);
  const [stack, setStack] = useState<ProfileStack>({
    aiTools: [],
    backend: [],
    frontend: [],
  });
  const [developing, setDeveloping] = useState<DevelopingValue | null>(null);
  const [urgency, setUrgency] = useState<Urgency | null>(null);

  // Hydrate profile + auth.
  useEffect(() => {
    const sb = createClient();
    const p = readProfile();
    setProfile(p);
    setTechComfort(p.techComfort ?? null);
    setStack(p.stack);
    setUrgency(p.urgency ?? null);

    void (async () => {
      const { data } = await sb.auth.getUser();
      if (!data.user) {
        router.replace("/login?next=/intake");
        return;
      }
      // Project-fill-in shortcut: if /intake was hit with ?projectId for an
      // already-answered project, skip the wizard and go straight to ring.
      if (projectIdParam) {
        const { data: existing } = await sb
          .from("client_intakes")
          .select("id")
          .eq("project_id", projectIdParam)
          .eq("customer_user_id", data.user.id)
          .maybeSingle();
        if (existing?.id) {
          const { data: sessRow } = await sb.rpc(
            "get_or_create_active_customer_session",
            { _project_id: projectIdParam },
          );
          const session = (Array.isArray(sessRow) ? sessRow[0] : sessRow) as {
            id?: string;
          } | null;
          if (session?.id) {
            await sb
              .from("client_intakes")
              .update({ guest_call_id: session.id, declined_by: [] })
              .eq("id", existing.id);
            await sb.rpc("match_engineer", { _intake_id: existing.id });
            router.replace(`/intake/matching/${existing.id}`);
            return;
          }
        }
      }
      setAuthLoading(false);
    })();
  }, [router, projectIdParam]);

  const showQuickReturn =
    !forceFullIntake && !newProjectMode && profile && hasFullIntake(profile);

  // New-project mode skips Q1 (step 1); the wizard runs Q2→Q4 (steps 2–4).
  const skipQ1 = newProjectMode;
  const firstStep = skipQ1 ? 2 : 1;
  const totalQuestions = skipQ1 ? TOTAL_STEPS - 1 : TOTAL_STEPS;
  const displayStep = skipQ1 ? step - 1 : step;

  const submit = useCallback(async () => {
    if (!techComfort || !developing || !urgency) {
      setError("Pick an option to continue");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      let projectId = projectIdParam;
      let projectName = newProjectName?.trim() || "Project";
      if (!projectId) {
        const { data: created, error: projErr } = await sb.rpc(
          "create_project",
          { _name: projectName },
        );
        if (projErr) throw projErr;
        const row = Array.isArray(created)
          ? (created[0] as { id?: string; name?: string } | null)
          : (created as { id?: string; name?: string } | null);
        projectId = row?.id ?? null;
        projectName = row?.name ?? projectName;
        if (!projectId) throw new Error("Could not create project");
      }

      const { data: activeSessions } = await sb
        .from("guest_calls")
        .select("id, project_id")
        .eq("customer_user_id", u.user.id)
        .in("status", ACTIVE_SESSION_STATES as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(1);
      const lingering = (activeSessions ?? [])[0] as
        | { id: string; project_id: string | null }
        | undefined;
      if (lingering && lingering.project_id !== projectId) {
        await sb.rpc("cancel_customer_session", { _session_id: lingering.id });
      }

      const { data: callData, error: rpcErr } = await sb.rpc(
        "get_or_create_active_customer_session",
        { _project_id: projectId },
      );
      if (rpcErr) {
        if ((rpcErr.message ?? "").includes("NO_ENTITLEMENT")) {
          router.replace("/room?paywall=1");
          return;
        }
        throw rpcErr;
      }
      const session = (Array.isArray(callData) ? callData[0] : callData) as {
        id: string;
      };
      if (!session?.id) throw new Error("Could not create session");

      // Map the editorial answers back onto the existing schema columns.
      // // TODO(api): widen client_intakes.ai_tools_used to text[], add
      // techComfort + urgency as first-class columns. UI is already aware.
      const familiarity =
        techComfort === "well_experienced"
          ? "Well Experienced"
          : techComfort === "semi_technical"
            ? "Semi-Technical"
            : "Totally Unknown";
      const allStack = [...stack.backend, ...stack.frontend];
      const intakePayload = {
        guest_call_id: session.id,
        customer_user_id: u.user.id,
        project_id: projectId,
        familiarity,
        ai_tools_used: stack.aiTools.join(", ") || "Other",
        developing,
        technologies: allStack,
        declined_by: [] as string[],
      };
      const { data: intakeData, error: intakeErr } = await sb
        .from("client_intakes")
        .upsert(intakePayload, { onConflict: "project_id,customer_user_id" })
        .select()
        .single();
      if (intakeErr) throw intakeErr;
      const intakeId = intakeData.id as string;

      await sb.rpc("match_engineer", { _intake_id: intakeId });

      // Persist durable signals to profile. Bind to the current user_id
      // so a different sign-in on the same browser doesn't inherit the
      // "Welcome back" greeting (see IntakeAssistant.tsx upgrade effect).
      // // TODO(profile): real backend store.
      patchProfile({
        techComfort,
        urgency,
        stack,
        hasFullIntake: true,
        lastProjectId: projectId,
        lastProjectName: projectName,
        userId: u.user.id,
      });

      router.replace(`/intake/matching/${intakeId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start matching");
      setBusy(false);
    }
  }, [router, projectIdParam, newProjectName, techComfort, stack, developing, urgency]);

  const canAdvance = useMemo(() => {
    if (step === 1) return techComfort !== null;
    if (step === 2) {
      const total =
        stack.aiTools.length + stack.backend.length + stack.frontend.length;
      return total > 0;
    }
    if (step === 3) return developing !== null;
    if (step === 4) return urgency !== null;
    return false;
  }, [step, techComfort, stack, developing, urgency]);

  const onNext = useCallback(() => {
    if (!canAdvance) return;
    if (step >= TOTAL_STEPS) {
      void submit();
      return;
    }
    setStep((s) => s + 1);
  }, [canAdvance, step, submit]);

  const onBack = step > firstStep ? () => setStep((s) => s - 1) : undefined;

  if (authLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] text-sm text-[var(--text-muted)]">
        <Loader2 size={18} className="mr-2 animate-spin" />
        Loading…
      </div>
    );
  }

  if (showQuickReturn && profile) {
    return (
      <QuickReturnIntake
        initialProfile={profile}
        onChooseFullIntake={() => {
          setForceFullIntake(true);
          setStep(1);
        }}
        onNewProject={(name) => {
          // §1.2: new project for a returning user → skip Q1, ask Q2–Q4.
          setNewProjectName(name);
          setNewProjectMode(true);
          setStep(2);
        }}
      />
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center bg-[var(--background)] px-4 py-10">
      <Wordmark />

      <Card variant="surface" className="relative mt-8 w-full max-w-2xl">
        <button
          type="button"
          onClick={() => router.replace("/room")}
          aria-label="Close intake"
          className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
        >
          <X size={16} />
        </button>

        <CardBody className="flex flex-col gap-6 px-6 py-8 sm:px-8">
          {/* Step pill + progress */}
          <div className="flex flex-col items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary-tint)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--primary-hover)]">
              Question {displayStep} of {totalQuestions}
            </span>
            <ProgressSegments current={displayStep} total={totalQuestions} />
          </div>

          {/* Headline + subline */}
          <header className="text-center">
            <Headline step={step} />
            <p className="mt-2 max-w-md mx-auto text-sm leading-relaxed text-[var(--text-muted)]">
              {subtitleFor(step)}
            </p>
          </header>

          {/* Step body */}
          <div className="flex flex-col gap-4">
            {step === 1 && (
              <RadioCardGroup
                value={techComfort}
                onChange={setTechComfort}
                options={TECH_COMFORT_OPTIONS}
              />
            )}
            {step === 2 && (
              <StackChipGroups stack={stack} onChange={setStack} />
            )}
            {step === 3 && (
              <RadioCardGroup<DevelopingValue>
                value={developing}
                onChange={setDeveloping}
                options={DEVELOPING_OPTIONS}
              />
            )}
            {step === 4 && (
              <RadioCardGroup
                value={urgency}
                onChange={setUrgency}
                options={URGENCY_OPTIONS}
              />
            )}
          </div>

          {error && <Toast tone="risk">{error}</Toast>}

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
            <Button
              variant="ghost"
              size="md"
              onClick={onBack}
              disabled={!onBack || busy}
            >
              ← Back
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={onNext}
              disabled={!canAdvance || busy}
              loading={busy}
            >
              {step === TOTAL_STEPS ? "Get an engineer →" : "Continue →"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

// ── Components ─────────────────────────────────────────────────────────────

function Headline({ step }: { step: number }) {
  // One italic green word per step — matches the editorial demo.
  if (step === 1) {
    return (
      <h1 className="font-serif text-3xl font-medium leading-tight text-[var(--text)] sm:text-4xl">
        How <em className="not-italic italic text-[var(--primary)]">comfortable</em>{" "}
        are you with code?
      </h1>
    );
  }
  if (step === 2) {
    return (
      <h1 className="font-serif text-3xl font-medium leading-tight text-[var(--text)] sm:text-4xl">
        What are you{" "}
        <em className="not-italic italic text-[var(--primary)]">building</em>{" "}
        with?
      </h1>
    );
  }
  if (step === 3) {
    return (
      <h1 className="font-serif text-3xl font-medium leading-tight text-[var(--text)] sm:text-4xl">
        What kind of{" "}
        <em className="not-italic italic text-[var(--primary)]">project</em>{" "}
        is this?
      </h1>
    );
  }
  return (
    <h1 className="font-serif text-3xl font-medium leading-tight text-[var(--text)] sm:text-4xl">
      How <em className="not-italic italic text-[var(--primary)]">soon</em> do
      you need someone?
    </h1>
  );
}

function subtitleFor(step: number): string {
  if (step === 1) return "Helps us right-size the conversation.";
  if (step === 2)
    return "We support 150+ integrations. Pick what matters — we'll match you with an engineer who's shipped on it.";
  if (step === 3) return "One option that fits best.";
  return "We'll line your engineer up accordingly.";
}

function ProgressSegments({ current, total }: { current: number; total: number }) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={`Question ${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-1.5 w-8 rounded-full transition-colors",
            i < current ? "bg-[var(--primary)]" : "bg-[var(--surface-raised)]",
          )}
        />
      ))}
    </div>
  );
}

// Radio cards — full-width selectable row w/ emoji, title, description, radio.
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
    <div role="radiogroup" className="flex flex-col gap-2.5">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "group flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
              selected
                ? "border-[var(--primary)] bg-[var(--primary-tint)]"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
            )}
          >
            <span aria-hidden className="mt-0.5 text-xl leading-none">
              {opt.emoji}
            </span>
            <span className="flex flex-1 flex-col leading-snug">
              <span className="text-sm font-semibold text-[var(--text)]">
                {opt.label}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {opt.description}
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                selected
                  ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                  : "border-[var(--border-strong)] bg-[var(--surface)]",
              )}
            >
              {selected && <Check size={12} strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Stack chip groups — three labeled multi-select clusters.
function StackChipGroups({
  stack,
  onChange,
}: {
  stack: ProfileStack;
  onChange: (s: ProfileStack) => void;
}) {
  const toggle = (cat: StackCat, option: string) => {
    const cur = stack[cat];
    const has = cur.some((x) => x.toLowerCase() === option.toLowerCase());
    onChange({
      ...stack,
      [cat]: has
        ? cur.filter((x) => x.toLowerCase() !== option.toLowerCase())
        : [...cur, option],
    });
  };
  return (
    <div className="flex flex-col gap-5">
      {STACK_OPTIONS.map((group) => (
        <section key={group.category}>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {group.label}
          </div>
          <div className="flex flex-wrap gap-1.5">
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
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    selected
                      ? "border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary-hover)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--border-strong)]",
                  )}
                >
                  {selected && <Check size={12} strokeWidth={3} />}
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
