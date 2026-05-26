-- ============================================================================
-- Engineer holidays — one-off date overrides on top of the weekly pattern
-- ============================================================================
-- engineer_availability_windows is the recurring weekly source of truth.
-- Engineers also need to block off specific dates (national holidays,
-- vacations, sick days) without erasing the underlying pattern. Model A
-- (pattern + lazy overrides) keeps the recurring rows untouched and adds
-- date-specific blocks here.
--
-- The Schedule modal on the customer side filters slots that fall on a
-- holiday so the customer never books an engineer on their day off. The
-- monthly planner view reads these too and renders them struck through.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.engineer_holidays (
  engineer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  holiday_date      date NOT NULL,
  label             text,
  -- Why-it's-blocked. v1 surfaces a single chip per row but the kind
  -- helps the supervisor view distinguish "Independence Day" from
  -- "Bob's vacation" at a glance.
  kind              text NOT NULL DEFAULT 'holiday',
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engineer_user_id, holiday_date)
);

ALTER TABLE public.engineer_holidays
  DROP CONSTRAINT IF EXISTS engineer_holidays_kind_check;
ALTER TABLE public.engineer_holidays
  ADD CONSTRAINT engineer_holidays_kind_check
  CHECK (kind IN ('holiday', 'vacation', 'sick', 'personal', 'other'));

CREATE INDEX IF NOT EXISTS idx_engineer_holidays_engineer
  ON public.engineer_holidays (engineer_user_id, holiday_date);

ALTER TABLE public.engineer_holidays ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read holidays (same posture as
-- engineer_availability_windows). The customer-side scheduler needs to
-- exclude these dates when projecting slots, so blocking the read would
-- force a server-side join through an RPC just for that.
DROP POLICY IF EXISTS "Anyone reads holidays" ON public.engineer_holidays;
CREATE POLICY "Anyone reads holidays" ON public.engineer_holidays
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Engineer writes own holidays" ON public.engineer_holidays;
CREATE POLICY "Engineer writes own holidays" ON public.engineer_holidays
  FOR ALL TO authenticated
  USING (engineer_user_id = auth.uid())
  WITH CHECK (engineer_user_id = auth.uid());

-- ── RPC: add_engineer_holiday ────────────────────────────────────────────
-- Upserts a single holiday. Idempotent — re-adding the same date refreshes
-- the label / kind without erroring. Customer can't add holidays for an
-- engineer; supervisor-side override comes later via a separate RPC.
CREATE OR REPLACE FUNCTION public.add_engineer_holiday(
  _date date,
  _label text,
  _kind text
)
RETURNS public.engineer_holidays
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_holidays;
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

  INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind)
  VALUES (_me, _date, NULLIF(trim(_label), ''), COALESCE(NULLIF(trim(_kind), ''), 'holiday'))
  ON CONFLICT (engineer_user_id, holiday_date) DO UPDATE
    SET label = EXCLUDED.label,
        kind  = EXCLUDED.kind
  RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.add_engineer_holiday(date, text, text) TO authenticated;

-- ── RPC: remove_engineer_holiday ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_engineer_holiday(_date date)
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

  DELETE FROM engineer_holidays
   WHERE engineer_user_id = _me AND holiday_date = _date;
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN _del > 0;
END $$;

GRANT EXECUTE ON FUNCTION public.remove_engineer_holiday(date) TO authenticated;

-- ── RPC: add_engineer_holidays_bulk ──────────────────────────────────────
-- Takes a JSON array of {date, label, kind} so the engineer can paste a
-- year's worth of national holidays in one go (the UI offers "India 2026
-- holidays" preset).
CREATE OR REPLACE FUNCTION public.add_engineer_holidays_bulk(_rows jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me      uuid := auth.uid();
  _row     jsonb;
  _inserted int := 0;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
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
      -- Skip malformed rows (invalid date format etc) and continue. The
      -- caller gets a count of successful inserts back.
      CONTINUE;
    END;
  END LOOP;

  RETURN _inserted;
END $$;

GRANT EXECUTE ON FUNCTION public.add_engineer_holidays_bulk(jsonb) TO authenticated;

COMMIT;
