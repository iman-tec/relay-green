-- ============================================================================
-- Matching v2 — extend client_intakes with the three signals the new score uses
-- ============================================================================
-- The current match_engineer (20260520900000_sequential_matching.sql) scores
-- engineers on tech-overlap + experience_level only. engineer_profiles already
-- carries `issues text[]` and `environments text[]` (since 20260520100000) but
-- the intake side has no symmetric columns to compare against — so the score
-- ignores them.
--
-- This migration adds the missing intake signals:
--
--   client_intakes.issues       text[]   what's broken (e.g. 'memory-leak')
--   client_intakes.environments text[]   stack / OS / framework
--   client_intakes.urgency      text     'urgent' | 'standard' | 'later'
--
-- All three are populated by the LLM in `summarize-intake` (separate migration);
-- they get a safe default so existing intakes and code paths keep working
-- exactly as today until the score change in 20260527120000 lands.
--
-- Purely additive; no behaviour change.
-- ============================================================================

BEGIN;

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS issues       text[]  NOT NULL DEFAULT '{}';

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS environments text[]  NOT NULL DEFAULT '{}';

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS urgency      text    NOT NULL DEFAULT 'standard';

-- Constrain urgency to the three allowed values. Named so we can drop / extend
-- it later without grep gymnastics.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_intakes_urgency_check'
      AND conrelid = 'public.client_intakes'::regclass
  ) THEN
    ALTER TABLE public.client_intakes
      ADD CONSTRAINT client_intakes_urgency_check
      CHECK (urgency IN ('urgent','standard','later'));
  END IF;
END $$;

COMMIT;
