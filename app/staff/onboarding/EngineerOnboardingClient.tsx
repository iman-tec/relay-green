"use client";

/*
 * Engineer skill-profile wizard.
 *
 * Captures the engineer's capabilities along SIX axes — the original
 * Expertise area + Experience level, plus the four customer-intake-
 * aligned axes (project types / AI tools / backend stacks / frontend
 * stacks). Submitted answers upsert into public.engineer_profiles, then
 * redirect to /dashboard.
 *
 * The four customer-aligned axes pull their option lists from the shared
 * lib/relay/intakeOptions module — same source of truth the customer
 * connect-flow picks from, so the matcher can score directly via array
 * overlap.
 *
 * Existing engineers with an incomplete profile get bounced here by the
 * gate hook in /dashboard.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { WizardShell } from "@/app/_components/wizard/WizardShell";
import { ChipGroup } from "@/app/_components/wizard/ChipGroup";
import { createClient } from "@/lib/supabase/browser";
import {
  PROJECT_TYPE_VALUES,
  AI_TOOL_OPTIONS,
  BACKEND_STACK_OPTIONS,
  FRONTEND_STACK_OPTIONS,
} from "@/lib/relay/intakeOptions";

const EXPERTISE = [
  "Frontend Development",
  "Backend Development",
  "Full Stack Development",
  "DevOps & Cloud",
  "Mobile App Development",
  "Database Engineering",
  "Networking",
  "Cybersecurity",
  "AI Tools",
  "AI / Machine Learning",
  "Hardware / IoT",
] as const;

const EXPERIENCE_LEVELS = ["Beginner", "Intermediate", "Experienced"] as const;

const TOTAL_STEPS = 6;

export function EngineerOnboardingClient() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [expertise, setExpertise] = useState<string[]>([]);
  const [experienceLevel, setExperienceLevel] = useState<string[]>([]);
  // Four new customer-aligned axes — pulled from the shared
  // intakeOptions module so engineer + customer picks score against
  // the same option strings.
  const [projectTypes, setProjectTypes] = useState<string[]>([]);
  const [aiTools, setAiTools] = useState<string[]>([]);
  const [backendStacks, setBackendStacks] = useState<string[]>([]);
  const [frontendStacks, setFrontendStacks] = useState<string[]>([]);

  useEffect(() => {
    const sb = createClient();
    void (async () => {
      const { data } = await sb.auth.getUser();
      if (!data.user) {
        router.replace("/staff/login");
        return;
      }
      setUserId(data.user.id);
      setAuthLoading(false);
    })();
  }, [router]);

  const canAdvance =
    (step === 1 && expertise.length > 0) ||
    (step === 2 && projectTypes.length > 0) ||
    (step === 3 && aiTools.length > 0) ||
    (step === 4 && backendStacks.length > 0) ||
    (step === 5 && frontendStacks.length > 0) ||
    (step === 6 && experienceLevel.length === 1);

  const onNext = useCallback(async () => {
    if (!canAdvance) return;
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
      return;
    }
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const sb = createClient();
      const { error: upsertErr } = await sb
        .from("engineer_profiles")
        .upsert({
          user_id: userId,
          expertise,
          // Technologies kept around for backward compat with the matcher
          // and existing UI; we synthesise it from backend + frontend so
          // the engineer doesn't have to enter it twice. Once the matcher
          // is updated to read the new structured columns directly,
          // technologies can be removed entirely.
          technologies: Array.from(new Set([...backendStacks, ...frontendStacks])),
          experience_level: experienceLevel[0],
          // Customer-aligned axes — new in 20260527200000.
          project_types: projectTypes,
          ai_tools: aiTools,
          backend_stacks: backendStacks,
          frontend_stacks: frontendStacks,
          // Legacy fields no longer captured in the wizard but the DB
          // still requires NOT NULL for issues + environments. Default
          // to empty arrays.
          issues: [],
          environments: [],
          is_available: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      if (upsertErr) throw upsertErr;
      // Assign a stable privacy alias now so the engineer has a nickname from
      // the start — customers never see real names. Best-effort.
      await sb.rpc("assign_engineer_alias", { _user: userId }).then(undefined, () => {});
      setDone(true);
      setTimeout(() => router.replace("/dashboard"), 1200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save profile";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [canAdvance, step, userId, expertise, experienceLevel, projectTypes, aiTools, backendStacks, frontendStacks, router]);

  const onBack = step > 1 ? () => setStep((s) => s - 1) : undefined;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className="size-14 rounded-full inline-flex items-center justify-center"
            style={{ background: "rgba(63, 92, 46, 0.18)", color: "#3f5c2e" }}
          >
            <Check className="size-7" />
          </div>
          <h1 className="text-2xl font-medium">Registration Complete</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Taking you to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  return (
    <WizardShell
      title={STEP_TITLES[step - 1]}
      subtitle={STEP_SUBTITLES[step - 1]}
      step={step}
      totalSteps={TOTAL_STEPS}
      canAdvance={canAdvance}
      isLast={step === TOTAL_STEPS}
      busy={busy}
      onNext={onNext}
      onBack={onBack}
      footer={
        error ? (
          <p className="text-sm" style={{ color: "var(--accent-red)" }}>
            {error}
          </p>
        ) : null
      }
    >
      {step === 1 && (
        <ChipGroup options={EXPERTISE} value={expertise} multi onChange={setExpertise} />
      )}
      {step === 2 && (
        <ChipGroup options={PROJECT_TYPE_VALUES} value={projectTypes} multi onChange={setProjectTypes} />
      )}
      {step === 3 && (
        <ChipGroup options={AI_TOOL_OPTIONS} value={aiTools} multi onChange={setAiTools} />
      )}
      {step === 4 && (
        <ChipGroup options={BACKEND_STACK_OPTIONS} value={backendStacks} multi onChange={setBackendStacks} />
      )}
      {step === 5 && (
        <ChipGroup options={FRONTEND_STACK_OPTIONS} value={frontendStacks} multi onChange={setFrontendStacks} />
      )}
      {step === 6 && (
        <ChipGroup options={EXPERIENCE_LEVELS} value={experienceLevel} onChange={setExperienceLevel} />
      )}
    </WizardShell>
  );
}

const STEP_TITLES = [
  "What's your primary area of expertise?",
  "What kinds of projects can you support?",
  "Which AI tools do you know well?",
  "Backend / infrastructure you've worked with?",
  "Frontend / UI you've worked with?",
  "What's your experience level?",
];

const STEP_SUBTITLES = [
  "High-level areas — pick all that apply.",
  "Match the customer's project-type options so we can route you the right work.",
  "Customers tell us which AI tool they're building with (Claude / Cursor / Lovable / …). Pick every one you've helped with.",
  "Pick every backend / data stack you'd be confident debugging on a live call.",
  "Pick every frontend / UI stack you'd be confident debugging.",
  "Honest answer — we route accordingly.",
];
