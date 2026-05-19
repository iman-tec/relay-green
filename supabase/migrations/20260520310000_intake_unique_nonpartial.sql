-- ============================================================================
-- Forward fix: drop partial unique index, recreate non-partial.
-- ============================================================================
-- 20260520300000_intake_per_project.sql created a PARTIAL unique index on
-- (project_id, customer_user_id) WHERE project_id IS NOT NULL. Postgres
-- can only use a partial index as an ON CONFLICT arbiter when the caller
-- supplies the matching `index_predicate`, but supabase-js's `.upsert`
-- doesn't expose that knob — every wizard insert fails with
--
--     42P10: there is no unique or exclusion constraint matching the
--     ON CONFLICT specification
--
-- Recreating the index without the WHERE clause is safe because PostgreSQL
-- treats NULL values in a unique index as distinct by default, so the
-- legacy `project_id IS NULL` rows (intakes from the very first day, before
-- intake-per-project landed) don't collide with each other.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS public.uniq_client_intakes_project_customer;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_client_intakes_project_customer
  ON public.client_intakes (project_id, customer_user_id);

COMMIT;
