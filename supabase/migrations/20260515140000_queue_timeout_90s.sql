-- Shorten the queue timeout from 3 minutes to 90 seconds.
--
-- Recreates abandon_stale_queued_sessions() so any session that has been
-- in 'queued' for more than 90 seconds without an engineer claim gets
-- moved to 'abandoned'. Mirrored on the client by ConnectingModal's
-- countdown and useCustomerSession's STALE_QUEUED_MS so the customer's
-- "No answer" boundary matches what the server enforces.

CREATE OR REPLACE FUNCTION public.abandon_stale_queued_sessions()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _count int;
BEGIN
  WITH abandoned AS (
    UPDATE guest_calls SET
      status       = 'abandoned',
      abandoned_at = now(),
      ended_reason = 'queue_timeout_90s',
      updated_at   = now()
    WHERE status = 'queued'
      AND created_at < now() - interval '90 seconds'
    RETURNING id
  )
  SELECT count(*)::int INTO _count FROM abandoned;
  RETURN COALESCE(_count, 0);
END $$;
