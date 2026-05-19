"use client";

/*
 * Client intake wizard.
 *
 * Two modes:
 *   • no ?projectId — wizard creates a brand-new project, writes the intake
 *     against that project_id, mints the first session, and fires
 *     match_engineer.
 *   • ?projectId=X  — wizard fills the intake for an EXISTING project that
 *     doesn't have one yet (legacy projects that pre-date intake-per-project).
 *     Same final steps: session + match_engineer + redirect to matching.
 *
 * The intake row is the canonical "answers about this project". Sessions in
 * the same project reuse the intake (with declined_by cleared between
 * sessions) so engineer-matching uses consistent answers every time.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

const ACTIVE_SESSION_STATES = [
  "queued", "assigned", "joining", "live", "grace", "ending", "expired_free",
] as const;

export function IntakeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get("projectId");

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
      // Short-circuit: if we were handed a project that already has an
      // intake, skip the wizard entirely and fire match_engineer with
      // the stored answers. This makes "Start in this old project"
      // resolve to the same push-ring matching UX as "Create new project".
      if (projectIdParam) {
        const { data: existing } = await sb
          .from("client_intakes")
          .select("id")
          .eq("project_id", projectIdParam)
          .eq("customer_user_id", data.user.id)
          .maybeSingle();
        if (existing?.id) {
          // Mint a fresh session, point the intake at it, clear the
          // declined_by set so prior decliners can be re-rung, then match.
          const { data: callData } = await sb.rpc(
            "get_or_create_active_customer_session",
            { _project_id: projectIdParam },
          );
          const session = (Array.isArray(callData) ? callData[0] : callData) as { id: string } | null;
          if (session?.id) {
            await sb.from("client_intakes")
              .update({ guest_call_id: session.id, declined_by: [] })
              .eq("id", existing.id);
            await sb.rpc("match_engineer", { _intake_id: existing.id });
            router.replace(`/room?matching=${existing.id}`);
            return;
          }
        }
      }
      setAuthLoading(false);
    })();
  }, [router, projectIdParam]);

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

      // 1. Resolve the project. Either we were handed one (legacy-project
      //    fill-in mode), or we create a new one.
      let projectId = projectIdParam;
      if (!projectId) {
        const { data: created, error: projErr } = await sb.rpc(
          "create_project",
          { _name: "Project" },
        );
        if (projErr) throw projErr;
        const row = Array.isArray(created)
          ? (created[0] as { id?: string } | null)
          : (created as { id?: string } | null);
        projectId = row?.id ?? null;
        if (!projectId) throw new Error("Could not create project");
      }

      // 2. Cancel any lingering active session that belongs to a different
      //    project — otherwise get_or_create returns the old session.
      const { data: activeSessions } = await sb
        .from("guest_calls")
        .select("id, project_id")
        .eq("customer_user_id", u.user.id)
        .in("status", ACTIVE_SESSION_STATES as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(1);
      const lingering = (activeSessions ?? [])[0] as { id: string; project_id: string | null } | undefined;
      if (lingering && lingering.project_id !== projectId) {
        await sb.rpc("cancel_customer_session", { _session_id: lingering.id });
      }

      // 3. Mint the session for this project.
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
      const session = (Array.isArray(callData) ? callData[0] : callData) as { id: string };
      if (!session?.id) throw new Error("Could not create session");

      // 4. Upsert the intake row keyed on (project_id, customer_user_id).
      //    declined_by is cleared so a fresh session can re-try engineers
      //    that declined in a previous session for this project.
      const intakePayload = {
        guest_call_id: session.id,
        customer_user_id: u.user.id,
        project_id: projectId,
        familiarity: familiarity[0],
        ai_tools_used: aiTools[0],
        developing: developing[0],
        technologies: wantsTechStep ? technologies : [],
        declined_by: [] as string[],
      };
      const { data: intakeData, error: intakeErr } = await sb
        .from("client_intakes")
        .upsert(intakePayload, { onConflict: "project_id,customer_user_id" })
        .select()
        .single();
      if (intakeErr) throw intakeErr;
      const intakeId = intakeData.id as string;

      // 5. Match.
      await sb.rpc("match_engineer", { _intake_id: intakeId });

      // 6. Back to /room — the MatchingModal there picks the intake up
      //    from the ?matching query param and pops in-place.
      router.replace(`/room?matching=${intakeId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start matching");
      setBusy(false);
    }
  }, [router, projectIdParam, familiarity, aiTools, developing, technologies, wantsTechStep]);

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
