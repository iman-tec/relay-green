-- ============================================================================
-- Relay — engineer_ai_queries: per-project AI Q&A history
-- ============================================================================
-- Backs the "Ask anything about this customer's project" bar in the engineer
-- live session room (EngineerAiAsk component in EngineerSessionClient).
--
-- One row per question. The streaming endpoint inserts the row with the
-- question + a NULL answer, then updates `answer` + `citations` +
-- `answer_completed_at` when the OpenAI stream finishes (via the AI SDK
-- `onFinish` callback).
--
-- Scope: PROJECT, not session. Two engineers picking up future sessions on
-- the same project should see the prior Q&A so context compounds across
-- support touchpoints. session_id is recorded for audit/UX (clickable
-- "asked during which session") but not used for access control.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.engineer_ai_queries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id           uuid REFERENCES public.guest_calls(id) ON DELETE SET NULL,
  asked_by_user_id     uuid NOT NULL REFERENCES auth.users(id),
  question             text NOT NULL,
  answer               text,
  citations            jsonb NOT NULL DEFAULT '[]'::jsonb,
  model                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  answer_completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_engineer_ai_queries_project_created
  ON public.engineer_ai_queries (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engineer_ai_queries_session
  ON public.engineer_ai_queries (session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE public.engineer_ai_queries ENABLE ROW LEVEL SECURITY;

-- ── Helper: has the caller ever claimed any session on this project?
-- Single source of truth for the project-membership check used by the
-- engineer_ai_queries policies. SECURITY DEFINER so it can read
-- guest_calls regardless of the caller's own row-level access.
CREATE OR REPLACE FUNCTION public.engineer_has_project_access(_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _claimed boolean;
  _is_supervisor boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  -- Direct path: caller has claimed_by on any session of this project.
  SELECT EXISTS (
    SELECT 1 FROM public.guest_calls
     WHERE project_id = _project_id
       AND claimed_by = auth.uid()
  ) INTO _claimed;
  IF _claimed THEN RETURN true; END IF;

  -- Supervisor escalation: pod / ops / admin tiers see every project.
  -- Roles list matches lib/relay/roles.ts (SUPERVISOR_ROLES in
  -- useIsSupervisor). user_role_names is the canonical view created by
  -- the roles migration.
  SELECT EXISTS (
    SELECT 1
      FROM public.user_role_names
     WHERE user_id = auth.uid()
       AND role IN ('supervisor', 'super_admin', 'enterprise_admin',
                    'department_admin', 'reseller')
  ) INTO _is_supervisor;
  RETURN _is_supervisor;
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_has_project_access(uuid) TO authenticated;

-- ── SELECT policy: row is visible to its author OR to any engineer who
-- has access to the same project (claimed_by on a session, or supervisor
-- role). This lets the "next engineer picking up this project" see
-- prior Q&A.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'engineer_ai_queries'
       AND policyname = 'engineer_ai_queries_select'
  ) THEN
    CREATE POLICY engineer_ai_queries_select
      ON public.engineer_ai_queries FOR SELECT TO authenticated
      USING (
        asked_by_user_id = auth.uid()
        OR public.engineer_has_project_access(project_id)
      );
  END IF;
END $$;

-- ── INSERT policy: caller must be the author AND have project access.
-- Prevents engineers from logging questions against projects they never
-- worked on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'engineer_ai_queries'
       AND policyname = 'engineer_ai_queries_insert'
  ) THEN
    CREATE POLICY engineer_ai_queries_insert
      ON public.engineer_ai_queries FOR INSERT TO authenticated
      WITH CHECK (
        asked_by_user_id = auth.uid()
        AND public.engineer_has_project_access(project_id)
      );
  END IF;
END $$;

-- ── UPDATE policy: only the author can update — and the streaming
-- endpoint only writes answer / citations / answer_completed_at / model.
-- We don't column-restrict here (RLS UPDATE policies gate the row, not
-- columns) — the route is the single writer in practice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'engineer_ai_queries'
       AND policyname = 'engineer_ai_queries_update_author'
  ) THEN
    CREATE POLICY engineer_ai_queries_update_author
      ON public.engineer_ai_queries FOR UPDATE TO authenticated
      USING (asked_by_user_id = auth.uid())
      WITH CHECK (asked_by_user_id = auth.uid());
  END IF;
END $$;

-- ── DELETE policy: author or supervisor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'engineer_ai_queries'
       AND policyname = 'engineer_ai_queries_delete_author_or_supervisor'
  ) THEN
    CREATE POLICY engineer_ai_queries_delete_author_or_supervisor
      ON public.engineer_ai_queries FOR DELETE TO authenticated
      USING (
        asked_by_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_role_names
           WHERE user_id = auth.uid()
             AND role IN ('supervisor', 'super_admin')
        )
      );
  END IF;
END $$;

COMMIT;
