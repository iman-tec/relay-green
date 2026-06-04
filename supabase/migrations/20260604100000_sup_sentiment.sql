-- ============================================================================
-- Relay — sup_sentiment: supervisor-facing realtime session sentiment
-- ============================================================================
-- One row per scoring tick (every minute while a session is active) plus a
-- final post-end row. Written by the score-session-health edge function
-- (live ticks, phase='live') and summarize-guest-call (cumulative post-end
-- score, phase='final'). Consumed by /supervise via latest_sup_sentiment.
--
-- score ∈ [-1.0, +1.0]. `state` is GENERATED from score so the
-- orange/red thresholds live in exactly one place and can never drift
-- from the number:   score < -0.3 → red · score < 0.3 → orange · else green
--
-- activeness ∈ [0.0, 1.0] — how engaged both sides are (frequency and
-- responsiveness across chat + voice), independent of polarity. A dead-quiet
-- call is activeness ~0 even if nobody is angry.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.sup_sentiment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  -- -1.0 .. +1.0, two-decimal precision from the model, clamped by the writer.
  score         numeric NOT NULL CHECK (score >= -1.0 AND score <= 1.0),
  -- Dynamic state, derived — never written directly:
  --   red    score < -0.3
  --   orange score <  0.3
  --   green  otherwise
  state         text GENERATED ALWAYS AS (
                  CASE
                    WHEN score < -0.3 THEN 'red'
                    WHEN score <  0.3 THEN 'orange'
                    ELSE 'green'
                  END
                ) STORED,
  -- One-sentence model explanation (<= ~120 chars).
  summary       text NOT NULL,
  -- 0.0 .. 1.0 engagement signal (chat + voice combined). Nullable: the
  -- final post-end row has no meaningful "current activity".
  activeness    numeric CHECK (activeness IS NULL OR (activeness >= 0 AND activeness <= 1)),
  -- 'live'  → minute tick computed from the FULL conversation so far
  -- 'final' → post-end score computed from the cumulative session summary
  phase         text NOT NULL DEFAULT 'live' CHECK (phase IN ('live', 'final')),
  -- Raw signal counts that went into this tick (for UI trust-gating).
  chat_count    integer NOT NULL DEFAULT 0,
  caption_count integer NOT NULL DEFAULT 0,
  computed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sup_sentiment_session_computed
  ON public.sup_sentiment (session_id, computed_at DESC);

-- Latest row per session — 'final' rows naturally win after session end
-- because they're written last; while live, the newest minute tick wins.
CREATE OR REPLACE VIEW public.latest_sup_sentiment AS
  SELECT DISTINCT ON (session_id)
    session_id, score, state, summary, activeness, phase,
    chat_count, caption_count, computed_at
  FROM public.sup_sentiment
  ORDER BY session_id, computed_at DESC;

-- ── RLS — staff read; writes come from the service role only ──────────────
ALTER TABLE public.sup_sentiment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read sup_sentiment" ON public.sup_sentiment;
CREATE POLICY "Staff read sup_sentiment" ON public.sup_sentiment
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'engineer')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );
-- No INSERT/UPDATE policies — service-role writers bypass RLS.

-- Realtime: /supervise subscribes to INSERTs for instant tile updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sup_sentiment'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sup_sentiment;
  END IF;
END $$;

COMMENT ON TABLE public.sup_sentiment IS
  'Supervisor-facing session sentiment. Minute ticks (phase=live, cumulative chat+voice) from score-session-health; one cumulative post-end row (phase=final) from summarize-guest-call. state is generated: <-0.3 red, <0.3 orange, else green.';

COMMIT;
