-- ============================================================================
-- Booking robustness: atomic no-double-booking + projects.last_engineer_joined
-- ============================================================================
-- 1. Atomic claim. book_engineer_slot used a race-prone `count(*)` overlap
--    check (two customers confirming the same free slot could both pass it).
--    Add a PARTIAL UNIQUE INDEX on (engineer_user_id, slot_start) for ACTIVE
--    bookings so the second concurrent insert fails at the DB level, and make
--    the RPC translate that into SLOT_UNAVAILABLE ("slot just taken"). With the
--    15-min slot grid + 15-min engineer duration, two engineer bookings collide
--    iff they share slot_start, so this is sufficient for the engineer flow
--    (supervisor 30-min slots additionally rely on the overlap pre-check below).
--
-- 2. projects.last_engineer_joined. The engineer who attended the LAST session
--    for a project is the one allowed to see/raise its bid, and the pod
--    supervisor of THAT engineer is who an "Ask for appointment" routes to.
--    Track it with two columns + a trigger that stamps them when an engineer
--    joins a project's guest_call.
-- Idempotent.
-- ============================================================================

BEGIN;

-- ── 1. Atomic claim ─────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_engineer_booking_active_slot
  ON public.engineer_bookings (engineer_user_id, slot_start)
  WHERE status = 'booked';

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
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF _engineer_user_id IS NULL THEN RAISE EXCEPTION 'MISSING_ENGINEER' USING ERRCODE='P0001'; END IF;
  IF _slot_end <= _slot_start THEN RAISE EXCEPTION 'INVALID_SLOT' USING ERRCODE='P0001'; END IF;
  IF _slot_start < now() - interval '1 minute' THEN RAISE EXCEPTION 'SLOT_IN_PAST' USING ERRCODE='P0001'; END IF;

  -- Fast pre-check: refuse if any active booking overlaps the requested window
  -- (catches different-start overlaps for 30-min supervisor slots).
  SELECT count(*) INTO _exists FROM engineer_bookings
    WHERE engineer_user_id = _engineer_user_id
      AND status = 'booked'
      AND slot_start < _slot_end
      AND slot_end   > _slot_start;
  IF _exists > 0 THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;

  -- Atomic insert. The partial unique index is the real race backstop: if a
  -- concurrent caller wins the same slot_start, this raises unique_violation,
  -- which we surface as SLOT_UNAVAILABLE.
  BEGIN
    INSERT INTO engineer_bookings (
      engineer_user_id, customer_user_id, project_id, slot_start, slot_end, notes
    ) VALUES (_engineer_user_id, _me, _project_id, _slot_start, _slot_end, _notes)
    RETURNING * INTO result;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE='P0001';
  END;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.book_engineer_slot(uuid, uuid, timestamptz, timestamptz, text) TO authenticated;

-- ── 2. projects.last_engineer_joined ────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_engineer_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_engineer_joined_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_project_last_engineer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- When an engineer actually joins a project's session, record them as the
  -- project's last attending engineer.
  IF NEW.project_id IS NOT NULL
     AND NEW.claimed_by IS NOT NULL
     AND NEW.engineer_joined_at IS NOT NULL
     AND NEW.engineer_joined_at IS DISTINCT FROM OLD.engineer_joined_at
  THEN
    UPDATE public.projects
       SET last_engineer_user_id   = NEW.claimed_by,
           last_engineer_joined_at = NEW.engineer_joined_at
     WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stamp_project_last_engineer_trg ON public.guest_calls;
CREATE TRIGGER stamp_project_last_engineer_trg
  AFTER UPDATE OF engineer_joined_at ON public.guest_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_project_last_engineer();

COMMIT;
