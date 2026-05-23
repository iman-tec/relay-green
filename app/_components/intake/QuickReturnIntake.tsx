"use client";

/*
 * QuickReturnIntake — the lightweight "Is this for [Project Name]?" screen
 * shown to returning users who have already completed the full intake at
 * least once.
 *
 * Decided by Order 2 of the Commander brief: do NOT re-ask comfort or stack
 * once we have a profile. Returning users see only ONE question — which
 * project this session is for — defaulted to their most recent project.
 * Comfort + stack are pulled from profile silently. The actual stack
 * increment ("Anything new since last time?") happens IN CHAT while the
 * engineer is ringing — see IntakeAssistant.
 *
 * Submit reuses the same path as IntakeClient: pick/mint a project, mint a
 * session, upsert intake (from profile), match_engineer, hop to matching.
 * Payload shape is identical so the engineer side sees no difference.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Folder, ChevronRight, Plus } from "lucide-react";
import { Button, Card, CardBody, EmptyState, Toast, cn } from "@/app/_components/ui";
import { Wordmark } from "@/app/_components/Wordmark";
import { createClient } from "@/lib/supabase/browser";
import {
  patchProfile,
  readProfile,
  type ProfileSnapshot,
} from "@/lib/relay/profile";

type Project = { id: string; name: string; created_at: string };

const ACTIVE_SESSION_STATES = [
  "queued", "assigned", "joining", "live", "grace", "ending", "expired_free",
] as const;

export function QuickReturnIntake({
  initialProfile,
  onChooseFullIntake,
}: {
  initialProfile: ProfileSnapshot;
  /** "I'm here for something new" → drop back to the full editorial intake. */
  onChooseFullIntake: () => void;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [picked, setPicked] = useState<string | null>(initialProfile.lastProjectId);
  const [newProjectName, setNewProjectName] = useState("");
  const [mode, setMode] = useState<"pick" | "new">(
    initialProfile.lastProjectId ? "pick" : "new",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) {
        router.replace("/login?next=/intake");
        return;
      }
      const { data } = await sb
        .from("projects")
        .select("id, name, created_at")
        .eq("customer_id", u.user.id)
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as Project[];
      setProjects(rows);
      if (!picked && rows.length > 0) setPicked(rows[0].id);
    })();
  }, [router, picked]);

  const defaultProject = useMemo(() => {
    if (!projects) return null;
    return projects.find((p) => p.id === picked) ?? projects[0] ?? null;
  }, [projects, picked]);

  const canSubmit = mode === "pick"
    ? Boolean(picked)
    : newProjectName.trim().length > 0;

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("Not signed in");

      let projectId = picked;
      let projectName = defaultProject?.name ?? "";

      if (mode === "new") {
        const { data: created, error: projErr } = await sb.rpc(
          "create_project",
          { _name: newProjectName.trim() },
        );
        if (projErr) throw projErr;
        const row = Array.isArray(created)
          ? (created[0] as { id?: string; name?: string } | null)
          : (created as { id?: string; name?: string } | null);
        projectId = row?.id ?? null;
        projectName = row?.name ?? newProjectName.trim();
        if (!projectId) throw new Error("Could not create project");
      }
      if (!projectId) throw new Error("Pick a project to continue");

      // Cancel any lingering active session in a different project.
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

      // Pull cached profile to fill the existing intake columns. Keeps the
      // engineer-side payload identical to the full-intake flow.
      // TODO(api): when client_intakes.ai_tools_used is widened to text[]
      // pass profile.stack.aiTools directly here.
      const allStack = [
        ...initialProfile.stack.backend,
        ...initialProfile.stack.frontend,
      ];
      const familiarity =
        initialProfile.techComfort === "well_experienced"
          ? "Well Experienced"
          : initialProfile.techComfort === "semi_technical"
            ? "Semi-Technical"
            : "Totally Unknown";

      const intakePayload = {
        guest_call_id: session.id,
        customer_user_id: u.user.id,
        project_id: projectId,
        familiarity,
        ai_tools_used: initialProfile.stack.aiTools.join(", ") || "Other",
        // The DB CHECK constraint requires one of:
        //   Website | Mobile App | IoT System | AIML product
        // Returning-user flow has no UI for this — we keep "Website" as the
        // sane default. The in-chat assistant can refine context once the
        // engineer is on.
        developing: "Website",
        technologies: allStack,
        declined_by: [] as string[],
      };
      const { data: intakeData, error: intakeErr } = await sb
        .from("client_intakes")
        .upsert(intakePayload, {
          onConflict: "project_id,customer_user_id",
        })
        .select()
        .single();
      if (intakeErr) throw intakeErr;
      const intakeId = intakeData.id as string;

      await sb.rpc("match_engineer", { _intake_id: intakeId });

      patchProfile({
        lastProjectId: projectId,
        lastProjectName: projectName,
      });

      router.replace(`/intake/matching/${intakeId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start matching");
      setBusy(false);
    }
  }, [
    picked,
    defaultProject,
    mode,
    newProjectName,
    initialProfile,
    router,
  ]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center bg-[var(--background)] px-4 py-10">
      <Wordmark />

      <Card variant="surface" className="mt-8 w-full max-w-xl">
        <CardBody className="flex flex-col gap-5 py-8">
          <div className="flex items-center justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary-tint)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--primary-hover)]">
              <span aria-hidden className="inline-flex size-1.5 rounded-full bg-[var(--primary)]" />
              Welcome back
            </span>
          </div>

          <div className="text-center">
            <h1 className="font-serif text-3xl font-medium leading-tight text-[var(--text)]">
              Picking up where you{" "}
              <em className="not-italic text-[var(--primary)] italic">left off</em>
              .
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              We&apos;ve got your tech background on file. Which project is this
              for?
            </p>
          </div>

          {projects === null ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              icon={<Folder size={28} />}
              title="No projects yet"
              body="Give this one a name and we'll spin it up."
            />
          ) : (
            <div className="flex flex-col gap-4">
              <ProjectModePicker
                mode={mode}
                onChange={setMode}
              />

              {mode === "pick" && (
                <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                  {projects.map((p) => {
                    const selected = picked === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(p.id)}
                          aria-pressed={selected}
                          className={cn(
                            "group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                            selected
                              ? "border-[var(--primary)] bg-[var(--primary-tint)]"
                              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex size-9 items-center justify-center rounded-lg",
                              selected
                                ? "bg-[var(--primary)] text-white"
                                : "bg-[var(--surface-raised)] text-[var(--text-muted)]",
                            )}
                          >
                            <Folder size={16} />
                          </span>
                          <span className="flex flex-1 flex-col leading-tight">
                            <span className="text-sm font-medium text-[var(--text)]">
                              {p.name}
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">
                              Started {new Date(p.created_at).toLocaleDateString()}
                            </span>
                          </span>
                          <ChevronRight
                            size={16}
                            className={cn(
                              "transition-transform",
                              selected
                                ? "text-[var(--primary)]"
                                : "text-[var(--text-faint)] group-hover:text-[var(--text-muted)]",
                            )}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {mode === "new" && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    Project name
                  </span>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g. Acme CRM redesign"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-soft)]"
                    autoFocus
                  />
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Your engineer will see this name when they join.
                  </span>
                </label>
              )}
            </div>
          )}

          {error && <Toast tone="risk">{error}</Toast>}

          <div className="mt-2 flex flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              full
              loading={busy}
              disabled={!canSubmit}
              onClick={submit}
            >
              Find my engineer →
            </Button>
            <button
              type="button"
              onClick={onChooseFullIntake}
              className="text-xs text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
            >
              Something has changed about my setup — answer the full intake
            </button>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

function ProjectModePicker({
  mode,
  onChange,
}: {
  mode: "pick" | "new";
  onChange: (m: "pick" | "new") => void;
}) {
  return (
    <div
      role="tablist"
      className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1"
    >
      {(
        [
          { id: "pick" as const, label: "Existing project" },
          { id: "new" as const, label: "New project" },
        ]
      ).map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={mode === opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            mode === opt.id
              ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
        >
          {opt.id === "new" && <Plus size={11} className="mr-1 inline-block" />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export { readProfile };
