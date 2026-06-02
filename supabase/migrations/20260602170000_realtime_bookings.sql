-- ============================================================================
-- Relay — Realtime for booking tables (engineer_bookings, supervisor_bookings)
-- ============================================================================
-- The customer sidebar "Scheduled Calls" pill + the center Scheduled view
-- subscribe to postgres_changes on these tables to reflect new/cancelled/
-- rescheduled bookings live. They were never added to the supabase_realtime
-- publication, so those subscriptions were silent — a new scheduled session
-- only appeared after a full reload.
--
-- REPLICA IDENTITY FULL is required so UPDATE/DELETE events carry the OLD row's
-- columns; without it the customer_user_id=eq.<id> realtime FILTER can't match
-- a cancel/reschedule (DELETE/UPDATE) and the event is dropped.
--
-- Idempotent: safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'engineer_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.engineer_bookings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'supervisor_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.supervisor_bookings;
  END IF;
END $$;

ALTER TABLE public.engineer_bookings REPLICA IDENTITY FULL;
ALTER TABLE public.supervisor_bookings REPLICA IDENTITY FULL;
