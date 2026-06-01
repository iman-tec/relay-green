-- ============================================================================
-- Stream session_captions over Supabase Realtime
-- ============================================================================
-- session_captions (20260514135000) is meant to be subscribed to live by
-- supervisors on /supervise ("Supervisors subscribe to this table via Supabase
-- Realtime ... for live streaming captions"), but the table was never added to
-- the `supabase_realtime` publication, so INSERTs didn't broadcast. Add it.
--
-- Captions are insert-only, so the default REPLICA IDENTITY (primary key) is
-- sufficient — realtime delivers the new row on INSERT. Idempotent.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'session_captions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_captions;
  END IF;
END $$;

COMMIT;
