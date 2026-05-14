-- Three-tier AI summary hierarchy: session → project → customer.
--
-- Session-level summaries already live on guest_calls.ai_summary_* (populated
-- by summarize-guest-call → OpenAI). This migration adds the two roll-ups
-- above it:
--
--   projects.ai_summary_*           → roll-up of every session in that project
--   customer_summaries.ai_summary_* → roll-up of every project for one customer
--
-- The two new edge functions (summarize-project / summarize-customer) write
-- to these columns; the cascade fires automatically when a session ends.

-- ────────────────────────────────────────────────────────────────────────────
-- Project-level summary columns
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ai_summary_title    text,
  ADD COLUMN IF NOT EXISTS ai_summary_overview text,
  ADD COLUMN IF NOT EXISTS ai_next_steps       jsonb,
  ADD COLUMN IF NOT EXISTS summary             text,
  ADD COLUMN IF NOT EXISTS summary_updated_at  timestamptz;

-- ────────────────────────────────────────────────────────────────────────────
-- Customer-level summary table — one row per logged-in customer
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_summaries (
  customer_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_summary_title    text,
  ai_summary_overview text,
  ai_next_steps       jsonb,
  summary             text,
  summary_updated_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_summaries ENABLE ROW LEVEL SECURITY;

-- Customer reads own summary.
DROP POLICY IF EXISTS "Customers read own summary" ON public.customer_summaries;
CREATE POLICY "Customers read own summary" ON public.customer_summaries
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

-- Staff (engineer / pod_lead / ops_manager / admin) read all — useful when an
-- engineer is helping a customer and wants the full history at a glance.
-- Matches the existing guest_threads read policy.
DROP POLICY IF EXISTS "Staff read customer_summaries" ON public.customer_summaries;
CREATE POLICY "Staff read customer_summaries" ON public.customer_summaries
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'engineer')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
  );

-- All write paths go through the service role from the edge function, so
-- we deliberately don't grant INSERT/UPDATE to authenticated. RLS bypasses
-- for service role automatically.

CREATE TRIGGER customer_summaries_set_updated_at
  BEFORE UPDATE ON public.customer_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
