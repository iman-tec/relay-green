-- ============================================================================
-- Per-project intake — bugs2.txt #4 follow-up
-- ============================================================================
-- Pre-existing projects used the legacy chat-first pull queue when a
-- customer started a session in them: get_or_create_active_customer_session
-- created a queued guest_calls row that every engineer could see and claim.
-- The push-ring matching path (match_engineer → engineer_match_offers)
-- only fired for brand-new projects created via /intake.
--
-- Fix: bind the intake to the PROJECT, not just the session. The wizard
-- saves answers against a project_id; every subsequent session in that
-- project re-uses the same intake row (with declined_by cleared between
-- sessions) and goes through the same match_engineer flow. Result:
-- ALL authenticated customer sessions are push-ring routed.
-- ============================================================================

BEGIN;

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

-- One canonical intake per project per customer. NULL project_id (legacy
-- session-only intakes from before this migration) is excluded via the
-- partial WHERE so we don't break those rows.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_client_intakes_project_customer
  ON public.client_intakes (project_id, customer_user_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_intakes_project
  ON public.client_intakes (project_id);

COMMIT;
