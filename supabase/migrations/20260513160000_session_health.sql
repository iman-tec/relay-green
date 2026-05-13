-- Session health (AI-derived sentiment per minute).
--
-- The score-session-health edge function runs every minute (pg_cron),
-- pulls the last 60s of chat per live/grace session, asks an LLM for a
-- continuous sentiment score in [-1, +1] plus a one-sentence summary,
-- and inserts one row here per scored session.
--
-- The Supervisor "observation pit" reads the LATEST row per session and
-- uses the score to drive the green/amber/red accent bar. When no row
-- exists yet (first minute of a session), the UI falls back to a
-- deterministic verdict from urgency + recall_count + wait time.

CREATE TABLE IF NOT EXISTS public.session_health (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  score         NUMERIC NOT NULL CHECK (score >= -1 AND score <= 1),
  summary       TEXT NOT NULL,
  window_start  TIMESTAMPTZ,
  window_end    TIMESTAMPTZ,
  message_count INT NOT NULL DEFAULT 0
);

-- Latest row per session — the supervisor card reads this row.
CREATE INDEX IF NOT EXISTS idx_session_health_session_time
  ON public.session_health (session_id, computed_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.session_health ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user. The supervisor page is gated client-side
-- by nav role; if we ever expose this table elsewhere we'll tighten.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'session_health'
      AND schemaname = 'public' AND policyname = 'session_health_read'
  ) THEN
    EXECUTE 'CREATE POLICY session_health_read ON public.session_health
      FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- No INSERT/UPDATE/DELETE policies → only service_role (used by the
-- edge function) can write. That's the desired posture: clients can
-- only consume scores, not fabricate them.

-- ── Convenience view: latest row per session ───────────────────────
CREATE OR REPLACE VIEW public.latest_session_health AS
SELECT DISTINCT ON (session_id)
  session_id,
  score,
  summary,
  computed_at,
  message_count
FROM public.session_health
ORDER BY session_id, computed_at DESC;

GRANT SELECT ON public.latest_session_health TO authenticated;
