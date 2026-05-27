-- ============================================================================
-- Engineer date windows — per-specific-date availability overrides
-- ============================================================================
-- The weekly pattern (engineer_availability_windows) is the recurring source
-- of truth. Holidays (engineer_holidays) block specific dates entirely. This
-- table adds a THIRD layer: per-date overrides that REPLACE the weekly
-- pattern for a specific calendar date.
--
-- Resolution order (used by the customer ScheduleModal + the monthly grid
-- projection in EngineerProfilePane):
--
--   1. engineer_holidays has a row for the date         → unavailable
--   2. engineer_date_windows has any rows for the date  → use those exclusively
--   3. otherwise                                         → project the weekly
--                                                          pattern for that
--                                                          weekday
--
-- So a date "inherits" the weekly pattern by default, and the engineer
-- opts INTO custom slots by saving any window on that specific date.
-- Hitting "Reset to weekly pattern" wipes the date_windows rows and the
-- date falls back to projection.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.engineer_date_windows (
  engineer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  the_date          date NOT NULL,
  start_minute      int NOT NULL,
  end_minute        int NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engineer_user_id, the_date, start_minute)
);

ALTER TABLE public.engineer_date_windows
  DROP CONSTRAINT IF EXISTS edw_minute_check;
ALTER TABLE public.engineer_date_windows
  ADD CONSTRAINT edw_minute_check
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);

CREATE INDEX IF NOT EXISTS idx_engineer_date_windows_engineer_date
  ON public.engineer_date_windows (engineer_user_id, the_date);

ALTER TABLE public.engineer_date_windows ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read overrides (same posture as
-- engineer_availability_windows + engineer_holidays). The customer-side
-- scheduler needs them to project per-date slots.
DROP POLICY IF EXISTS "Anyone reads date windows" ON public.engineer_date_windows;
CREATE POLICY "Anyone reads date windows" ON public.engineer_date_windows
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Engineer writes own date windows" ON public.engineer_date_windows;
CREATE POLICY "Engineer writes own date windows" ON public.engineer_date_windows
  FOR ALL TO authenticated
  USING (engineer_user_id = auth.uid())
  WITH CHECK (engineer_user_id = auth.uid());

-- ── RPC: set_date_window ─────────────────────────────────────────────────
-- Upserts a single per-date slot. Idempotent — re-saving the same
-- (date, start_minute) just refreshes end_minute.
CREATE OR REPLACE FUNCTION public.set_date_window(
  _date date, _start_min int, _end_min int
)
RETURNS public.engineer_date_windows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_date_windows;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;
  IF _date IS NULL THEN
    RAISE EXCEPTION 'MISSING_DATE' USING ERRCODE='P0001';
  END IF;
  IF _start_min < 0 OR _end_min > 1440 OR _start_min >= _end_min THEN
    RAISE EXCEPTION 'INVALID_MINUTES' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_date_windows (engineer_user_id, the_date, start_minute, end_minute)
  VALUES (_me, _date, _start_min, _end_min)
  ON CONFLICT (engineer_user_id, the_date, start_minute) DO UPDATE
    SET end_minute = EXCLUDED.end_minute
  RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.set_date_window(date, int, int) TO authenticated;

-- ── RPC: remove_date_window ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_date_window(
  _date date, _start_min int
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me   uuid := auth.uid();
  _del  int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  DELETE FROM engineer_date_windows
   WHERE engineer_user_id = _me
     AND the_date = _date
     AND start_minute = _start_min;
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN _del > 0;
END $$;

GRANT EXECUTE ON FUNCTION public.remove_date_window(date, int) TO authenticated;

-- ── RPC: clear_date_overrides ────────────────────────────────────────────
-- Wipes ALL per-date slots for one date. Date falls back to projecting
-- from the weekly pattern. Note: this does NOT touch engineer_holidays —
-- if the date is also a holiday, it stays blocked. Hit
-- remove_engineer_holiday separately to unblock.
CREATE OR REPLACE FUNCTION public.clear_date_overrides(_date date)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me   uuid := auth.uid();
  _del  int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  DELETE FROM engineer_date_windows
   WHERE engineer_user_id = _me AND the_date = _date;
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN _del;
END $$;

GRANT EXECUTE ON FUNCTION public.clear_date_overrides(date) TO authenticated;

-- ── RPC: apply_date_template_bulk ────────────────────────────────────────
-- Multi-select primitive: for each date in _dates, REPLACE all per-date
-- slots with the slots in _slots. Used by the "5 dates selected — apply
-- 'Mornings' template" affordance.
--
-- _dates: jsonb array of date strings ('YYYY-MM-DD')
-- _slots: jsonb array of objects {"start_minute": int, "end_minute": int}
--
-- Returns the count of (date, slot) rows inserted.
CREATE OR REPLACE FUNCTION public.apply_date_template_bulk(
  _dates jsonb, _slots jsonb
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me        uuid := auth.uid();
  _date_elem jsonb;
  _slot_elem jsonb;
  _date      date;
  _start     int;
  _end       int;
  _count     int := 0;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(_dates) <> 'array' OR jsonb_typeof(_slots) <> 'array' THEN
    RAISE EXCEPTION 'EXPECTED_ARRAYS' USING ERRCODE='P0001';
  END IF;

  -- For each date: wipe existing per-date slots, then insert the template.
  FOR _date_elem IN SELECT jsonb_array_elements(_dates) LOOP
    BEGIN
      _date := (_date_elem #>> '{}')::date;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;  -- skip malformed date strings
    END;

    DELETE FROM engineer_date_windows
      WHERE engineer_user_id = _me AND the_date = _date;

    FOR _slot_elem IN SELECT jsonb_array_elements(_slots) LOOP
      BEGIN
        _start := (_slot_elem->>'start_minute')::int;
        _end   := (_slot_elem->>'end_minute')::int;
        IF _start < 0 OR _end > 1440 OR _start >= _end THEN
          CONTINUE;
        END IF;
        INSERT INTO engineer_date_windows (
          engineer_user_id, the_date, start_minute, end_minute
        )
        VALUES (_me, _date, _start, _end)
        ON CONFLICT (engineer_user_id, the_date, start_minute) DO UPDATE
          SET end_minute = EXCLUDED.end_minute;
        _count := _count + 1;
      EXCEPTION WHEN OTHERS THEN
        CONTINUE;  -- skip malformed slot objects
      END;
    END LOOP;
  END LOOP;

  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_date_template_bulk(jsonb, jsonb) TO authenticated;

-- ── RPC: clear_date_overrides_bulk ───────────────────────────────────────
-- Multi-select primitive for "Reset all selected dates to weekly pattern".
CREATE OR REPLACE FUNCTION public.clear_date_overrides_bulk(_dates jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me       uuid := auth.uid();
  _date_elem jsonb;
  _date     date;
  _count    int := 0;
  _del      int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(_dates) <> 'array' THEN
    RAISE EXCEPTION 'EXPECTED_ARRAY' USING ERRCODE='P0001';
  END IF;

  FOR _date_elem IN SELECT jsonb_array_elements(_dates) LOOP
    BEGIN
      _date := (_date_elem #>> '{}')::date;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
    DELETE FROM engineer_date_windows
      WHERE engineer_user_id = _me AND the_date = _date;
    GET DIAGNOSTICS _del = ROW_COUNT;
    _count := _count + _del;
  END LOOP;

  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.clear_date_overrides_bulk(jsonb) TO authenticated;

COMMIT;
