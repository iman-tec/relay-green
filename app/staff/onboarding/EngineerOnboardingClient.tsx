"use client";

/*
 * Engineer skill-profile wizard.
 *
 * 5-step questionnaire from `todo.txt`. Submitted answers upsert into
 * public.engineer_profiles, then redirect to /dashboard. Existing engineers
 * with an incomplete profile get bounced here by the gate hook in
 * /dashboard.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { WizardShell } from "@/app/_components/wizard/WizardShell";
import { ChipGroup } from "@/app/_components/wizard/ChipGroup";
import { createClient } from "@/lib/supabase/browser";

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

const TECHNOLOGIES = [
  "Python", "Java", "Node.js", "React", "Angular",
  "AWS", "Docker", "Kubernetes", "MySQL", "PostgreSQL",
  "MongoDB", "Linux", "Firebase", "TensorFlow", "Flutter",
  "React Native",
] as const;

const EXPERIENCE_LEVELS = ["Beginner", "Intermediate", "Experienced"] as const;

const ISSUES = [
  "Bug Fixing", "API Issues", "Server Downtime", "Deployment Problems",
  "Database Errors", "Security Issues", "UI/UX Problems",
  "Mobile App Crashes", "Other Issues",
] as const;

const ENVIRONMENTS = [
  "Linux Server", "Windows Server", "AWS Cloud", "Google Cloud",
  "macOS", "Docker", "Kubernetes",
] as const;

const TOTAL_STEPS = 5;

export function EngineerOnboardingClient() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [expertise, setExpertise] = useState<string[]>([]);
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [experienceLevel, setExperienceLevel] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);

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
    (step === 2 && technologies.length > 0) ||
    (step === 3 && experienceLevel.length === 1) ||
    (step === 4 && issues.length > 0) ||
    (step === 5 && environments.length > 0);

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
          technologies,
          experience_level: experienceLevel[0],
          issues,
          environments,
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
  }, [canAdvance, step, userId, expertise, technologies, experienceLevel, issues, environments, router]);

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
        <ChipGroup options={TECHNOLOGIES} value={technologies} multi onChange={setTechnologies} />
      )}
      {step === 3 && (
        <ChipGroup options={EXPERIENCE_LEVELS} value={experienceLevel} onChange={setExperienceLevel} />
      )}
      {step === 4 && (
        <ChipGroup options={ISSUES} value={issues} multi onChange={setIssues} />
      )}
      {step === 5 && (
        <ChipGroup options={ENVIRONMENTS} value={environments} multi onChange={setEnvironments} />
      )}
    </WizardShell>
  );
}

const STEP_TITLES = [
  "What's your primary area of expertise?",
  "Which technologies have you worked with?",
  "What's your experience level?",
  "What kinds of issues are you comfortable solving?",
  "Which environments have you worked in?",
];

const STEP_SUBTITLES = [
  "Select all that apply.",
  "Pick every stack you'd be confident debugging.",
  "Honest answer — we match accordingly.",
  "We use this to route the right tickets to you.",
  "Production setups you've shipped to.",
];
