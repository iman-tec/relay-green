-- ============================================================================
-- H2 — cross-pod escalation fall-through to ops
-- ============================================================================
-- If an open session escalation isn't resolved within N minutes, it falls
-- through to ops (super-admin): we stamp ops_escalated_at so the super-admin
-- surface can flag it. A pg_cron job runs the sweep every 5 minutes; the
-- Next side can also call escalate_stale_escalations() as a fallback.
-- ============================================================================

BEGIN;

ALTER TABLE public.session_escalations
  ADD COLUMN IF NOT EXISTS ops_escalated_at timestamptz;

-- Flag open escalations older than _minutes that haven't been picked up.
CREATE OR REPLACE FUNCTION public.escalate_stale_escalations(_minutes int DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _count int;
BEGIN
  UPDATE session_escalations
     SET ops_escalated_at = now()
   WHERE status = 'open'
     AND ops_escalated_at IS NULL
     AND created_at < now() - make_interval(mins => _minutes);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.escalate_stale_escalations(int) TO service_role;

-- Schedule every 5 minutes if pg_cron is available.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'relay-escalation-fall-through',
      '*/5 * * * *',
      $cron$SELECT public.escalate_stale_escalations(15);$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

COMMIT;
