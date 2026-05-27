-- ============================================================================
-- Projects: contract_type for engineer earnings breakdown
-- ============================================================================
-- Engineers work in three phases per customer engagement:
--   • build     — initial development work; tracked in minutes
--   • golive    — taking a project to production; tracked as a count
--                 (you either go-lived it or you didn't)
--   • maintain  — ongoing maintenance contract; tracked as a count
--                 (number of projects currently being maintained)
--
-- The Payouts tab in EngineerProfilePane filters by contract_type + date
-- range and shows minutes for build, counts for golive + maintain.
--
-- Default 'build' so every existing project + every new project starts
-- there. Transitions to 'golive' / 'maintain' happen via an engineer- or
-- supervisor-driven RPC (set_project_contract_type below).
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'build';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_contract_type_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_contract_type_check
  CHECK (contract_type IN ('build', 'golive', 'maintain'));

CREATE INDEX IF NOT EXISTS idx_projects_contract_type
  ON public.projects (contract_type);

-- ── Extend engineer_session_history with contract_type ───────────────────
-- The Payouts UI joins through the project to know which phase a session
-- counts toward. We project a NULL contract_type for sessions that have no
-- project_id (legacy / general-bucket sessions) so the UI can group them
-- as "Uncategorised".
DROP VIEW IF EXISTS public.engineer_session_history;
CREATE OR REPLACE VIEW public.engineer_session_history AS
SELECT
  gc.id,
  gc.claimed_by   AS engineer_user_id,
  gc.guest_name,
  gc.guest_email,
  gc.duration_minutes,
  gc.status,
  gc.created_at,
  gc.assigned_at,
  gc.project_name,
  gc.project_id,
  gc.paid_extension_at,
  p.contract_type
FROM public.guest_calls gc
LEFT JOIN public.projects p ON p.id = gc.project_id
WHERE gc.claimed_by IS NOT NULL;

GRANT SELECT ON public.engineer_session_history TO authenticated;

-- ── RPC: set_project_contract_type ───────────────────────────────────────
-- Engineer-on-the-project (or supervisor/admin) can transition a project
-- between phases. Customer can also transition their own project (they
-- ultimately own the engagement).
CREATE OR REPLACE FUNCTION public.set_project_contract_type(
  _project_id uuid, _contract_type text
)
RETURNS public.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me        uuid := auth.uid();
  _allowed   boolean := false;
  result     public.projects;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _contract_type NOT IN ('build', 'golive', 'maintain') THEN
    RAISE EXCEPTION 'INVALID_CONTRACT_TYPE' USING ERRCODE='P0001';
  END IF;

  -- Customer who owns the project, OR engineer who's run a session on it,
  -- OR supervisor/admin can flip the contract type.
  SELECT EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = _project_id
      AND (
        pr.customer_id = _me
        OR EXISTS (
          SELECT 1 FROM public.guest_calls gc
          WHERE gc.project_id = pr.id AND gc.claimed_by = _me
        )
        OR has_role(_me, 'supervisor')
        OR has_role(_me, 'admin')
        OR has_role(_me, 'super_admin')
      )
  ) INTO _allowed;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  UPDATE public.projects
    SET contract_type = _contract_type
    WHERE id = _project_id
    RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.set_project_contract_type(uuid, text) TO authenticated;

-- ── View: engineer_revenue_by_contract ───────────────────────────────────
-- Per-engineer rollup grouped by contract_type. The Payouts UI uses this
-- for the category counters; date-range filtering happens in the query
-- since views can't accept parameters.
CREATE OR REPLACE VIEW public.engineer_contract_summary AS
SELECT
  gc.claimed_by AS engineer_user_id,
  COALESCE(p.contract_type, 'build') AS contract_type,
  COUNT(*) FILTER (WHERE gc.paid_extension_at IS NOT NULL)::int AS paid_sessions,
  COUNT(*)::int AS total_sessions,
  COALESCE(SUM(gc.duration_minutes), 0)::numeric AS total_minutes,
  COALESCE(SUM(gc.duration_minutes) FILTER (WHERE gc.status = 'ended'), 0)::numeric AS billable_minutes,
  COUNT(DISTINCT gc.project_id) FILTER (WHERE gc.project_id IS NOT NULL)::int AS distinct_projects
FROM public.guest_calls gc
LEFT JOIN public.projects p ON p.id = gc.project_id
WHERE gc.claimed_by IS NOT NULL
GROUP BY gc.claimed_by, COALESCE(p.contract_type, 'build');

GRANT SELECT ON public.engineer_contract_summary TO authenticated;

COMMIT;
