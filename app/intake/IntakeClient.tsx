"use client";

/*
 * Client intake wizard.
 *
 * Runs for every new project per spec — `app/_components/wizard/*` chips
 * collect 3-4 answers (Step 4 is conditional on Step 1). The Find Engineer
 * CTA mints:
 *   1. a guest_calls row via get_or_create_active_customer_session
 *   2. a client_intakes row referencing it
 *   3. an engineer_match_offers row via match_engineer(intake_id)
 *
 * Then routes to /intake/matching/[intake_id] which owns the waiting +
 * accept/decline retry flow.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "@/app/_components/wizard/WizardShell";
import { ChipGroup } from "@/app/_components/wizard/ChipGroup";
import { createClient } from "@/lib/supabase/browser";

const FAMILIARITY = ["Totally Unknown", "Semi-Technical", "Well Experienced"] as const;
const AI_TOOLS = ["Claude", "ChatGPT (Codex)", "Deep Seek", "Lovable", "Replit", "Some Other"] as const;
const DEVELOPING = ["Website", "Mobile App", "IoT System", "AIML product"] as const;
const TECHNOLOGIES = [
  "React", "Angular", "Vue", "Node.js", "Python", "Java", "PHP",
  "AWS", "Azure", "Google Cloud", "Docker", "Kubernetes",
  "MySQL", "PostgreSQL", "MongoDB", "Linux", "iOS", "Android", "Firebase",
] as const;

export function IntakeClient() {
  const router = useRouter();

  const [authLoading, setAuthLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [familiarity, setFamiliarity] = useState<string[]>([]);
  const [aiTools, setAiTools] = useState<string[]>([]);
  const [developing, setDeveloping] = useState<string[]>([]);
  const [technologies, setTechnologies] = useState<string[]>([]);

  const wantsTechStep =
    familiarity[0] === "Semi-Technical" || familiarity[0] === "Well Experienced";
  const totalSteps = wantsTechStep ? 4 : 3;

  useEffect(() => {
    const sb = createClient();
    void (async () => {
      const { data } = await sb.auth.getUser();
      if (!data.user) {
        router.replace("/login?next=/intake");
        return;
      }
      setAuthLoading(false);
    })();
  }, [router]);

  const canAdvance =
    (step === 1 && familiarity.length === 1) ||
    (step === 2 && aiTools.length === 1) ||
    (step === 3 && developing.length === 1) ||
    (step === 4 && technologies.length > 0);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      const { data: callData, error: rpcErr } = await sb.rpc(
        "get_or_create_active_customer_session",
      );
      if (rpcErr) {
        if ((rpcErr.message ?? "").includes("NO_ENTITLEMENT")) {
          router.replace("/room?paywall=1");
          return;
        }
        throw rpcErr;
      }
      const session = (Array.isArray(callData) ? callData[0] : callData) as { id: string };
      if (!session?.id) throw new Error("Could not create session");

      const { data: intakeData, error: intakeErr } = await sb
        .from("client_intakes")
        .insert({
          guest_call_id: session.id,
          customer_user_id: u.user.id,
          familiarity: familiarity[0],
          ai_tools_used: aiTools[0],
          developing: developing[0],
          technologies: wantsTechStep ? technologies : [],
        })
        .select()
        .single();
      if (intakeErr) throw intakeErr;

      const intakeId = intakeData.id as string;
      await sb.rpc("match_engineer", { _intake_id: intakeId });
      router.replace(`/intake/matching/${intakeId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start matching");
      setBusy(false);
    }
  }, [router, familiarity, aiTools, developing, technologies, wantsTechStep]);

  const onNext = useCallback(() => {
    if (!canAdvance) return;
    if (step === 1 && !wantsTechStep && totalSteps === 3) {
      setStep(2); return;
    }
    if (step >= totalSteps) {
      void submit(); return;
    }
    setStep((s) => s + 1);
  }, [canAdvance, step, totalSteps, wantsTechStep, submit]);

  const onBack = step > 1 ? () => setStep((s) => s - 1) : undefined;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <WizardShell
      title={titleFor(step)}
      subtitle={subtitleFor(step)}
      step={step}
      totalSteps={totalSteps}
      canAdvance={canAdvance}
      isLast={step === totalSteps}
      busy={busy}
      nextLabel={step === totalSteps ? "Find Engineer" : "Next"}
      onNext={onNext}
      onBack={onBack}
      footer={
        error ? (
          <p className="text-sm" style={{ color: "var(--accent-red)" }}>{error}</p>
        ) : null
      }
    >
      {step === 1 && (
        <ChipGroup options={FAMILIARITY} value={familiarity} onChange={setFamiliarity} />
      )}
      {step === 2 && (
        <ChipGroup options={AI_TOOLS} value={aiTools} onChange={setAiTools} />
      )}
      {step === 3 && (
        <ChipGroup options={DEVELOPING} value={developing} onChange={setDeveloping} />
      )}
      {step === 4 && wantsTechStep && (
        <ChipGroup options={TECHNOLOGIES} value={technologies} multi onChange={setTechnologies} />
      )}
    </WizardShell>
  );
}

function titleFor(step: number) {
  return [
    "How familiar are you with development?",
    "Which AI tool have you been using?",
    "What are you building?",
    "Which technologies are you working with?",
  ][step - 1];
}
function subtitleFor(step: number) {
  return [
    "Helps us right-size the conversation.",
    "We tailor the engineer match to your tooling.",
    "One option that fits best.",
    "Select all that apply.",
  ][step - 1];
}
