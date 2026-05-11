-- ============================================================================
-- Relay — Phase 1b: prevent duplicate active sessions per customer
-- ============================================================================
-- 1. Partial unique index → at most one non-terminal session per customer.
-- 2. Advisory lock inside get_or_create_active_customer_session →
--    serialises concurrent calls for the same customer.
-- 3. Resurrect-on-cancelled-or-abandoned: a fresh QUEUED row is created if
--    the previous attempt was cancelled / abandoned. Free quota survives
--    because consumption happens only on LIVE.
-- ============================================================================

BEGIN;

-- Defensive: clean up any duplicate active rows that already exist
-- (would block the unique index creation).
WITH dupes AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY customer_user_id
    ORDER BY created_at DESC
  ) AS rn
  FROM public.guest_calls
  WHERE customer_user_id IS NOT NULL
    AND status NOT IN ('ended','abandoned','cancelled')
)
UPDATE public.guest_calls
   SET status = 'abandoned',
       abandoned_at = now(),
       ended_reason = 'duplicate_cleanup'
 WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- Enforce at most one active session per customer.
CREATE UNIQUE INDEX IF NOT EXISTS guest_calls_one_active_per_customer
  ON public.guest_calls (customer_user_id)
  WHERE customer_user_id IS NOT NULL
    AND status NOT IN ('ended','abandoned','cancelled');

-- Update the RPC: advisory lock + idempotent return.
CREATE OR REPLACE FUNCTION public.get_or_create_active_customer_session()
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _u         auth.users%ROWTYPE;
  _name      text;
  _email     text;
  _thread    uuid;
  _session   public.guest_calls;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Advisory lock keyed on the customer's UUID — serialises this RPC for
  -- the same customer across all concurrent connections within the
  -- transaction. Two StrictMode-double-effect clients waiting in line
  -- will both end up with the same returned row.
  PERFORM pg_advisory_xact_lock(hashtextextended('relay-cust-session:' || auth.uid()::text, 0));

  SELECT * INTO _u FROM auth.users WHERE id = auth.uid();
  _email := _u.email;
  _name  := COALESCE(NULLIF(_u.raw_user_meta_data->>'full_name',''),
                     split_part(_u.email,'@',1));

  -- Find existing non-terminal session
  SELECT * INTO _session
    FROM guest_calls
    WHERE customer_user_id = auth.uid()
      AND status NOT IN ('ended','abandoned','cancelled')
    ORDER BY created_at DESC
    LIMIT 1;

  IF FOUND THEN
    RETURN _session;
  END IF;

  SELECT public.find_or_create_guest_thread(_email, NULL, _name) INTO _thread;

  INSERT INTO customer_entitlements (customer_user_id) VALUES (auth.uid())
    ON CONFLICT DO NOTHING;

  INSERT INTO guest_calls (
    guest_name, guest_email, status, thread_id,
    customer_user_id, free_minutes
  ) VALUES (
    _name, _email, 'queued', _thread,
    auth.uid(), 10
  ) RETURNING * INTO _session;

  PERFORM _log_session_event(_session.id, 'session.created', NULL, 'queued', NULL);
  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.get_or_create_active_customer_session() TO authenticated;

COMMIT;
