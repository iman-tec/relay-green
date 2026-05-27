-- ============================================================================
-- Engineer profile: align with customer intake schema
-- ============================================================================
-- The customer connect-flow captures four structured axes about the project:
--   1. project_type      — what they're building (CRM, landing, mobile, ...)
--   2. ai_tool           — which AI tool drives the build (Claude, Lovable, ...)
--   3. backend_stack     — backend / infra choice (Supabase, AWS, Python, ...)
--   4. frontend_stack    — frontend / UI choice (React, Next.js, Flutter, ...)
--
-- Until now, engineer_profiles only carried two free-form arrays
-- (expertise, technologies), so the matcher couldn't score across the same
-- dimensions the customer specified. This migration adds four parallel
-- text[] columns so engineers can declare capabilities along the same axes.
--
-- Engineers pick MULTIPLE per axis (they have multiple competencies);
-- customers pick ONE per axis (one project, one stack choice).
--
-- Source-of-truth values for both sides live in lib/relay/intakeOptions.ts.
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_profiles
  ADD COLUMN IF NOT EXISTS project_types     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_tools          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS backend_stacks    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS frontend_stacks   text[] NOT NULL DEFAULT '{}';

-- GIN indexes on the new arrays so the matcher can do array-overlap (&&)
-- queries efficiently. Each engineer typically has < 30 entries per axis
-- so the index is small; the customer's intake is a single value lookup.
CREATE INDEX IF NOT EXISTS idx_engineer_profiles_project_types_gin
  ON public.engineer_profiles USING GIN (project_types);
CREATE INDEX IF NOT EXISTS idx_engineer_profiles_ai_tools_gin
  ON public.engineer_profiles USING GIN (ai_tools);
CREATE INDEX IF NOT EXISTS idx_engineer_profiles_backend_stacks_gin
  ON public.engineer_profiles USING GIN (backend_stacks);
CREATE INDEX IF NOT EXISTS idx_engineer_profiles_frontend_stacks_gin
  ON public.engineer_profiles USING GIN (frontend_stacks);

COMMENT ON COLUMN public.engineer_profiles.project_types IS
  'Multi-select capabilities aligned with customer intake project_type. Picked from PROJECT_TYPE_OPTIONS in lib/relay/intakeOptions.ts. Existing rows default to empty until the engineer re-onboards.';
COMMENT ON COLUMN public.engineer_profiles.ai_tools IS
  'Multi-select capabilities aligned with customer intake ai_tool. Picked from AI_TOOL_OPTIONS in lib/relay/intakeOptions.ts.';
COMMENT ON COLUMN public.engineer_profiles.backend_stacks IS
  'Multi-select capabilities aligned with customer intake backend_stack. Picked from BACKEND_STACK_OPTIONS.';
COMMENT ON COLUMN public.engineer_profiles.frontend_stacks IS
  'Multi-select capabilities aligned with customer intake frontend_stack. Picked from FRONTEND_STACK_OPTIONS.';

COMMIT;

-- ============================================================================
-- TODO: Update match_engineer RPC scoring
-- ============================================================================
-- The match_engineer function (latest version in
-- 20260521150000_match_engineer_role_id_fix.sql) currently scores against:
--   engineer_profiles.expertise, technologies, environments, issues
-- against the customer's free-form client_intakes.technologies / ai_tools_used
-- string. It does NOT yet read the new project_types / ai_tools /
-- backend_stacks / frontend_stacks columns.
--
-- For full alignment we need a follow-up migration that rewrites the
-- match_engineer scoring to compare the customer's intake selections
-- against the new structured arrays via && (array overlap) operators.
-- That work is intentionally deferred so this migration stays a clean
-- additive schema change with no behavioural risk to the live matcher.
-- ============================================================================
