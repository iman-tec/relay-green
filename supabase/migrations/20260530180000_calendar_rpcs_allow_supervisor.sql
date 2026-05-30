-- ============================================================================
-- Availability calendar RPCs — allow supervisors (not just engineers)
-- ============================================================================
-- The weekly/monthly availability editor (CalendarTab) is being added to the
-- supervisor surface as an exact copy of the engineer calendar. Its write RPCs
-- were gated to has_role('engineer') and raised NOT_AN_ENGINEER, so a
-- supervisor editing their own calendar failed. Table RLS is already
-- owner-scoped (engineer_user_id = auth.uid()), so the only change needed is to
-- widen the role guard on these four SECURITY DEFINER RPCs to also accept
-- supervisor / super_admin. Bodies are otherwise byte-for-byte the originals.
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_engineer_window(_weekday smallint, _start_minute integer, _end_minute integer, _timezone text)
 RETURNS engineer_availability_windows
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_availability_windows;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me,'engineer') OR has_role(_me,'supervisor') OR has_role(_me,'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
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
END $function$;

CREATE OR REPLACE FUNCTION public.add_engineer_holiday(_date date, _label text, _kind text)
 RETURNS engineer_holidays
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_holidays;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me,'engineer') OR has_role(_me,'supervisor') OR has_role(_me,'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF _date IS NULL THEN
    RAISE EXCEPTION 'MISSING_DATE' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind)
  VALUES (_me, _date, NULLIF(trim(_label), ''), COALESCE(NULLIF(trim(_kind), ''), 'holiday'))
  ON CONFLICT (engineer_user_id, holiday_date) DO UPDATE
    SET label = EXCLUDED.label,
        kind  = EXCLUDED.kind
  RETURNING * INTO result;

  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.add_engineer_holidays_bulk(_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _me      uuid := auth.uid();
  _row     jsonb;
  _inserted int := 0;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me,'engineer') OR has_role(_me,'supervisor') OR has_role(_me,'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'EXPECTED_ARRAY' USING ERRCODE='P0001';
  END IF;

  FOR _row IN SELECT jsonb_array_elements(_rows) LOOP
    BEGIN
      INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind)
      VALUES (
        _me,
        (_row->>'date')::date,
        NULLIF(trim(_row->>'label'), ''),
        COALESCE(NULLIF(trim(_row->>'kind'), ''), 'holiday')
      )
      ON CONFLICT (engineer_user_id, holiday_date) DO UPDATE
        SET label = EXCLUDED.label,
            kind  = EXCLUDED.kind;
      _inserted := _inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN _inserted;
END $function$;

CREATE OR REPLACE FUNCTION public.apply_date_template_bulk(_dates jsonb, _slots jsonb)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT (has_role(_me,'engineer') OR has_role(_me,'supervisor') OR has_role(_me,'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(_dates) <> 'array' OR jsonb_typeof(_slots) <> 'array' THEN
    RAISE EXCEPTION 'EXPECTED_ARRAYS' USING ERRCODE='P0001';
  END IF;

  FOR _date_elem IN SELECT jsonb_array_elements(_dates) LOOP
    BEGIN
      _date := (_date_elem #>> '{}')::date;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
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
        CONTINUE;
      END;
    END LOOP;
  END LOOP;

  RETURN _count;
END $function$;

COMMIT;
