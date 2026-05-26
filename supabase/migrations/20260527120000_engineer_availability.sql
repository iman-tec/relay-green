-- ============================================================================
-- Engineer availability calendar — weekly recurring windows + bookings
-- ============================================================================
-- When the customer hits an Offline engineer's "Schedule" button, the
-- calendar opens and shows 30-minute slots derived from the engineer's
-- weekly windows minus existing bookings. The customer picks a slot, we
-- INSERT into engineer_bookings, and the slot is held until the booked
-- time. (Notification machinery — email / desktop ping — is bolted on by
-- a separate edge function watching engineer_bookings; out of scope here.)
--
-- engineer_availability_windows are recurring weekly slots ("Mon 09:00–
-- 17:00"). Each row is one continuous window; the engineer can have many.
-- engineer_bookings are concrete one-off appointments.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.engineer_availability_windows (
  engineer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday           smallint NOT NULL,            -- 0=Sun, 1=Mon, …, 6=Sat
  start_minute      int NOT NULL,                 -- 0–1439 (minutes from midnight)
  end_minute        int NOT NULL,                 -- exclusive upper bound
  timezone          text NOT NULL DEFAULT 'UTC',  -- IANA tz, e.g. "America/Los_Angeles"
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engineer_user_id, weekday, start_minute)
);

ALTER TABLE public.engineer_availability_windows
  DROP CONSTRAINT IF EXISTS eaw_weekday_check;
ALTER TABLE public.engineer_availability_windows
  ADD CONSTRAINT eaw_weekday_check
  CHECK (weekday BETWEEN 0 AND 6);

ALTER TABLE public.engineer_availability_windows
  DROP CONSTRAINT IF EXISTS eaw_minute_check;
ALTER TABLE public.engineer_availability_windows
  ADD CONSTRAINT eaw_minute_check
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);

CREATE INDEX IF NOT EXISTS idx_eaw_engineer_weekday
  ON public.engineer_availability_windows (engineer_user_id, weekday);

ALTER TABLE public.engineer_availability_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads windows" ON public.engineer_availability_windows;
CREATE POLICY "Anyone reads windows" ON public.engineer_availability_windows
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Engineer writes own windows" ON public.engineer_availability_windows;
CREATE POLICY "Engineer writes own windows" ON public.engineer_availability_windows
  FOR ALL TO authenticated
  USING (engineer_user_id = auth.uid())
  WITH CHECK (engineer_user_id = auth.uid());

-- ── Bookings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engineer_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  slot_start        timestamptz NOT NULL,
  slot_end          timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'booked',
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engineer_bookings
  DROP CONSTRAINT IF EXISTS eb_status_check;
ALTER TABLE public.engineer_bookings
  ADD CONSTRAINT eb_status_check
  CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show'));

ALTER TABLE public.engineer_bookings
  DROP CONSTRAINT IF EXISTS eb_slot_order;
ALTER TABLE public.engineer_bookings
  ADD CONSTRAINT eb_slot_order
  CHECK (slot_end > slot_start);

CREATE INDEX IF NOT EXISTS idx_eb_engineer_future
  ON public.engineer_bookings (engineer_user_id, slot_start)
  WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS idx_eb_customer
  ON public.engineer_bookings (customer_user_id, slot_start DESC);

ALTER TABLE public.engineer_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Both sides read booking" ON public.engineer_bookings;
CREATE POLICY "Both sides read booking" ON public.engineer_bookings
  FOR SELECT TO authenticated
  USING (engineer_user_id = auth.uid() OR customer_user_id = auth.uid());

-- ── RPC: set_engineer_window ──────────────────────────────────────────────
-- Engineer-side. Upserts a single recurring window.
CREATE OR REPLACE FUNCTION public.set_engineer_window(
  _weekday      smallint,
  _start_minute int,
  _end_minute   int,
  _timezone     text
)
RETURNS public.engineer_availability_windows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_availability_windows;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;
  IF _weekday < 0 OR _weekday > 6 THEN
    RAISE EXCEPTION 'INVALID_WEEKDAY' USING ERRCODE='P0001';
  END IF;
  IF _start_minute < 0 OR _end_minute > 1440 OR _start_minute >= _end_minute THEN
    RAISE EXCEPTION 'INVALID_MINUTES' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_availability_windows (
    engineer_user_id, weekday, start_minute, end_minute, timezone
  )
  VALUES (_me, _weekday, _start_minute, _end_minute, COALESCE(_timezone, 'UTC'))
  ON CONFLICT (engineer_user_id, weekday, start_minute) DO UPDATE
    SET end_minute = EXCLUDED.end_minute,
        timezone   = EXCLUDED.timezone
  RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.set_engineer_window(smallint, int, int, text) TO authenticated;

-- ── RPC: remove_engineer_window ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_engineer_window(
  _weekday      smallint,
  _start_minute int
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _del    int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  DELETE FROM engineer_availability_windows
   WHERE engineer_user_id = _me
     AND weekday = _weekday
     AND start_minute = _start_minute;
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN _del > 0;
END $$;

GRANT EXECUTE ON FUNCTION public.remove_engineer_window(smallint, int) TO authenticated;

-- ── RPC: book_engineer_slot ───────────────────────────────────────────────
-- Customer-side. Books a slot. Caller is responsible for picking a slot
-- that's actually inside an availability window — we don't redo window
-- validation here (cheap to check, but the picker already filters), only
-- the no-overlap check against existing bookings.
CREATE OR REPLACE FUNCTION public.book_engineer_slot(
  _engineer_user_id uuid,
  _project_id       uuid,
  _slot_start       timestamptz,
  _slot_end         timestamptz,
  _notes            text
)
RETURNS public.engineer_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _exists int;
  result  public.engineer_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _engineer_user_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_ENGINEER' USING ERRCODE='P0001';
  END IF;
  IF _slot_end <= _slot_start THEN
    RAISE EXCEPTION 'INVALID_SLOT' USING ERRCODE='P0001';
  END IF;
  IF _slot_start < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'SLOT_IN_PAST' USING ERRCODE='P0001';
  END IF;

  -- Overlap guard — refuse if the engineer already has any booked slot
  -- intersecting the requested window.
  SELECT count(*) INTO _exists FROM engineer_bookings
    WHERE engineer_user_id = _engineer_user_id
      AND status = 'booked'
      AND slot_start < _slot_end
      AND slot_end   > _slot_start;
  IF _exists > 0 THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_bookings (
    engineer_user_id, customer_user_id, project_id, slot_start, slot_end, notes
  ) VALUES (_engineer_user_id, _me, _project_id, _slot_start, _slot_end, _notes)
  RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.book_engineer_slot(uuid, uuid, timestamptz, timestamptz, text) TO authenticated;

-- ── RPC: cancel_booking ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_booking(_id uuid)
RETURNS public.engineer_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM engineer_bookings
    WHERE id = _id
      AND (engineer_user_id = _me OR customer_user_id = _me)
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF result.status <> 'booked' THEN
    RETURN result;
  END IF;

  UPDATE engineer_bookings
    SET status = 'cancelled'
    WHERE id = _id
    RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid) TO authenticated;

COMMIT;
