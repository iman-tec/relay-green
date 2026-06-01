-- ============================================================================
-- Supervisor call scheduling
-- ============================================================================
-- When a customer opens a bid in Contract management and clicks "Ask for
-- appointment", they book a 30-minute call on a supervisor's calendar. The
-- supervisor is resolved from the bid's project: projects.last_eng_connected
-- (the engineer who most recently joined a live session on that project) →
-- that engineer's pod → the pod's supervisor.
--
-- Supervisors already publish weekly availability through the shared
-- CalendarTab, which writes to engineer_availability_windows keyed by their own
-- user_id (see 20260530180000_calendar_rpcs_allow_supervisor.sql). The booking
-- picker reads those windows directly — this migration adds only the *booking*
-- side (a parallel table + RPCs), deliberately NOT touching the engineer
-- booking flow.
--
-- Additive only: a new column, a new table, a trigger, and new RPCs. No table
-- or column is dropped.
-- ============================================================================

BEGIN;

-- ── 1. projects.last_eng_connected ──────────────────────────────────────────
-- The engineer who most recently joined a live session on the project. Stamped
-- by a trigger on guest_calls (below). Nullable: brand-new projects with no
-- session yet have no connected engineer.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_eng_connected uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Stamp trigger ────────────────────────────────────────────────────────
-- Fires when a session flips to 'live' (the engineer actually joined). Stamps
-- the project with that engineer. SECURITY DEFINER so it can update projects
-- regardless of who triggered the status change.
CREATE OR REPLACE FUNCTION public.stamp_last_eng_connected()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NEW.claimed_by IS NOT NULL THEN
    UPDATE public.projects
       SET last_eng_connected = NEW.claimed_by
     WHERE id = NEW.project_id
       AND last_eng_connected IS DISTINCT FROM NEW.claimed_by;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_last_eng_connected ON public.guest_calls;
CREATE TRIGGER trg_stamp_last_eng_connected
  AFTER UPDATE OF status ON public.guest_calls
  FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live')
  EXECUTE FUNCTION public.stamp_last_eng_connected();

-- ── 3. supervisor_bookings ──────────────────────────────────────────────────
-- Concrete 30-minute appointments a customer books on a supervisor's calendar.
-- customer_name / project_name are denormalised at insert time so the
-- supervisor's Schedule list is a single-table read.
CREATE TABLE IF NOT EXISTS public.supervisor_bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  quote_id           uuid REFERENCES public.project_quote_requests(id) ON DELETE SET NULL,
  slot_start         timestamptz NOT NULL,
  slot_end           timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'booked',
  customer_name      text,
  project_name       text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supervisor_bookings
  DROP CONSTRAINT IF EXISTS sb_status_check;
ALTER TABLE public.supervisor_bookings
  ADD CONSTRAINT sb_status_check
  CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show'));

ALTER TABLE public.supervisor_bookings
  DROP CONSTRAINT IF EXISTS sb_slot_order;
ALTER TABLE public.supervisor_bookings
  ADD CONSTRAINT sb_slot_order
  CHECK (slot_end > slot_start);

CREATE INDEX IF NOT EXISTS idx_sb_supervisor_future
  ON public.supervisor_bookings (supervisor_user_id, slot_start)
  WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS idx_sb_customer
  ON public.supervisor_bookings (customer_user_id, slot_start DESC);

ALTER TABLE public.supervisor_bookings ENABLE ROW LEVEL SECURITY;

-- Both parties read their own bookings. (Super-admin oversight is a later step.)
DROP POLICY IF EXISTS "Both sides read supervisor booking" ON public.supervisor_bookings;
CREATE POLICY "Both sides read supervisor booking" ON public.supervisor_bookings
  FOR SELECT TO authenticated
  USING (supervisor_user_id = auth.uid() OR customer_user_id = auth.uid());

-- ── 4. supervisor_for_quote ─────────────────────────────────────────────────
-- Resolves the supervisor a customer would book for a given bid. The customer
-- can't traverse pod_members under RLS (they're not in any pod), so this runs
-- SECURITY DEFINER and just returns the supervisor's user_id.
CREATE OR REPLACE FUNCTION public.supervisor_for_quote(_quote_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT sup.user_id
    FROM project_quote_requests q
    JOIN projects p        ON p.id = q.project_id
    JOIN pod_members eng    ON eng.user_id = p.last_eng_connected
                           AND eng.pod_role = 'engineer'
    JOIN pod_members sup    ON sup.pod_id = eng.pod_id
                           AND sup.pod_role = 'supervisor'
   WHERE q.id = _quote_id
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.supervisor_for_quote(uuid) TO authenticated;

-- ── 5. book_supervisor_slot ─────────────────────────────────────────────────
-- Customer-side. Books a 30-minute slot on the supervisor resolved from the
-- bid. The precise slot grid + lead-time rule (15-minute grid, ≥4 slots ahead)
-- is enforced client-side in the picker; the RPC enforces the invariants that
-- must hold no matter what: caller owns the quote, 30-minute duration, a sane
-- lead-time backstop, and no overlap with the supervisor's existing bookings.
CREATE OR REPLACE FUNCTION public.book_supervisor_slot(
  _quote_id   uuid,
  _slot_start timestamptz,
  _slot_end   timestamptz,
  _notes      text
)
RETURNS public.supervisor_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me           uuid := auth.uid();
  _supervisor   uuid;
  _project_id   uuid;
  _project_name text;
  _customer_nm  text;
  _exists       int;
  result        public.supervisor_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _quote_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_QUOTE' USING ERRCODE='P0001';
  END IF;

  -- The caller must own the bid they're booking against.
  SELECT q.project_id, p.name
    INTO _project_id, _project_name
    FROM project_quote_requests q
    JOIN projects p ON p.id = q.project_id
   WHERE q.id = _quote_id
     AND q.customer_user_id = _me;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_YOUR_QUOTE' USING ERRCODE='P0001';
  END IF;

  _supervisor := public.supervisor_for_quote(_quote_id);
  IF _supervisor IS NULL THEN
    RAISE EXCEPTION 'NO_SUPERVISOR_FOR_QUOTE' USING ERRCODE='P0001';
  END IF;

  IF _slot_end <= _slot_start THEN
    RAISE EXCEPTION 'INVALID_SLOT' USING ERRCODE='P0001';
  END IF;
  IF _slot_end - _slot_start <> interval '30 minutes' THEN
    RAISE EXCEPTION 'SLOT_NOT_30_MIN' USING ERRCODE='P0001';
  END IF;
  -- Lead-time backstop. The picker enforces the exact ≥4-slot rule (~1h);
  -- here we just refuse anything obviously too soon (tolerates clock skew).
  IF _slot_start < now() + interval '45 minutes' THEN
    RAISE EXCEPTION 'SLOT_TOO_SOON' USING ERRCODE='P0001';
  END IF;

  -- Overlap guard against the supervisor's other booked slots.
  SELECT count(*) INTO _exists FROM supervisor_bookings
    WHERE supervisor_user_id = _supervisor
      AND status = 'booked'
      AND slot_start < _slot_end
      AND slot_end   > _slot_start;
  IF _exists > 0 THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  -- Customer display name (definer can read profiles regardless of RLS).
  SELECT COALESCE(pr.full_name, cp.display_name)
    INTO _customer_nm
    FROM (SELECT _me AS uid) base
    LEFT JOIN profiles pr          ON pr.id = base.uid
    LEFT JOIN customer_profiles cp ON cp.user_id = base.uid;

  INSERT INTO supervisor_bookings (
    supervisor_user_id, customer_user_id, project_id, quote_id,
    slot_start, slot_end, customer_name, project_name, notes
  ) VALUES (
    _supervisor, _me, _project_id, _quote_id,
    _slot_start, _slot_end, _customer_nm, _project_name, _notes
  )
  RETURNING * INTO result;

  -- Keep the existing "appointment requested" signal in sync so the bid viewer
  -- still shows the request marker.
  UPDATE project_quote_requests
     SET appointment_requested_at = now()
   WHERE id = _quote_id;

  -- Notify the supervisor (definer insert; notifications has no INSERT policy).
  INSERT INTO notifications (user_id, request_id, kind, title, body)
  VALUES (
    _supervisor, _quote_id, 'supervisor_appointment_booked',
    'New appointment booked',
    COALESCE(_customer_nm, 'A customer') || ' booked a call'
      || COALESCE(' about ' || _project_name, '')
      || ' for ' || to_char(_slot_start, 'Mon DD, HH24:MI') || ' UTC'
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.book_supervisor_slot(uuid, timestamptz, timestamptz, text) TO authenticated;

-- ── 6. cancel_supervisor_booking ────────────────────────────────────────────
-- Either party can cancel. Notifies the other side.
CREATE OR REPLACE FUNCTION public.cancel_supervisor_booking(_id uuid)
RETURNS public.supervisor_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _other  uuid;
  result  public.supervisor_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM supervisor_bookings
    WHERE id = _id
      AND (supervisor_user_id = _me OR customer_user_id = _me)
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF result.status <> 'booked' THEN
    RETURN result;
  END IF;

  UPDATE supervisor_bookings
     SET status = 'cancelled'
   WHERE id = _id
   RETURNING * INTO result;

  _other := CASE WHEN _me = result.supervisor_user_id
                 THEN result.customer_user_id ELSE result.supervisor_user_id END;
  INSERT INTO notifications (user_id, request_id, kind, title, body)
  VALUES (
    _other, result.quote_id, 'supervisor_appointment_cancelled',
    'Appointment cancelled',
    'The ' || to_char(result.slot_start, 'Mon DD, HH24:MI') || ' UTC call was cancelled'
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_supervisor_booking(uuid) TO authenticated;

COMMIT;
