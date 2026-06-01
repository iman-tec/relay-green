-- ============================================================================
-- Scheduled-appointment lifecycle: cancel-with-reason, reschedule, 15-min
-- heads-up + auto-expire, all with notifications to the right parties.
-- ============================================================================
-- Reuses the existing `notifications` table + `create_notification()` and the
-- `engineer_bookings` table. A booked engineer's supervisor is resolved as any
-- supervisor sharing a pod with the engineer (pod_members + has_role).
-- Idempotent.
-- ============================================================================

BEGIN;

-- ── Schema: link a launched session, record cancel reason, track heads-up ────
ALTER TABLE public.engineer_bookings
  ADD COLUMN IF NOT EXISTS guest_call_id    uuid REFERENCES public.guest_calls(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason    text,
  ADD COLUMN IF NOT EXISTS heads_up_sent_at timestamptz;

ALTER TABLE public.engineer_bookings DROP CONSTRAINT IF EXISTS eb_status_check;
ALTER TABLE public.engineer_bookings
  ADD CONSTRAINT eb_status_check
  CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show', 'expired'));

-- ── Helper: notify the supervisors who share a pod with an engineer ──────────
CREATE OR REPLACE FUNCTION public.notify_engineer_supervisors(
  _engineer_user_id uuid, _kind text, _title text, _body text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _sup uuid;
BEGIN
  FOR _sup IN
    SELECT DISTINCT pm2.user_id
      FROM pod_members pm1
      JOIN pod_members pm2 ON pm2.pod_id = pm1.pod_id
     WHERE pm1.user_id = _engineer_user_id
       AND pm2.user_id <> _engineer_user_id
       AND public.has_role(pm2.user_id, 'supervisor')
  LOOP
    PERFORM public.create_notification(_sup, NULL, _kind, _title, _body);
  END LOOP;
END $$;

-- Names used in notification copy.
CREATE OR REPLACE FUNCTION public.booking_party_names(_booking public.engineer_bookings)
RETURNS TABLE(customer_name text, engineer_name text, project_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT display_name FROM customer_profiles WHERE user_id = _booking.customer_user_id), 'A customer'),
    COALESCE((SELECT display_alias FROM engineer_profiles WHERE user_id = _booking.engineer_user_id), 'your engineer'),
    COALESCE((SELECT name FROM projects WHERE id = _booking.project_id), 'a project');
$$;

-- ── cancel_booking_with_reason ──────────────────────────────────────────────
-- Customer OR engineer cancels; records the reason and notifies the other side
-- plus the engineer's supervisor(s).
CREATE OR REPLACE FUNCTION public.cancel_booking_with_reason(_id uuid, _reason text)
RETURNS public.engineer_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_bookings;
  _n      record;
  _when   text;
  _byCust boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO result FROM engineer_bookings
    WHERE id = _id AND (engineer_user_id = _me OR customer_user_id = _me)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF result.status <> 'booked' THEN RETURN result; END IF;

  UPDATE engineer_bookings
     SET status = 'cancelled', cancel_reason = NULLIF(btrim(_reason), '')
   WHERE id = _id RETURNING * INTO result;

  SELECT * INTO _n FROM public.booking_party_names(result);
  _when := to_char(result.slot_start, 'Mon DD, HH24:MI');
  _byCust := (_me = result.customer_user_id);

  IF _byCust THEN
    PERFORM public.create_notification(result.engineer_user_id, NULL, 'appointment_cancelled',
      _n.customer_name || ' cancelled the ' || _when || ' session',
      'Project: ' || _n.project_name || COALESCE(' · ' || result.cancel_reason, ''));
    PERFORM public.notify_engineer_supervisors(result.engineer_user_id, 'appointment_cancelled',
      'Booking cancelled', _n.customer_name || ' cancelled the ' || _when || ' session with ' || _n.engineer_name);
  ELSE
    PERFORM public.create_notification(result.customer_user_id, NULL, 'appointment_cancelled',
      _n.engineer_name || ' cancelled your ' || _when || ' session',
      'Project: ' || _n.project_name || COALESCE(' · ' || result.cancel_reason, ''));
    PERFORM public.notify_engineer_supervisors(result.engineer_user_id, 'appointment_cancelled',
      'Booking cancelled', _n.engineer_name || ' cancelled the ' || _when || ' session');
  END IF;

  RETURN result;
END $$;

-- ── reschedule_booking ──────────────────────────────────────────────────────
-- Customer chooses "Schedule for later": drop the current booking (freeing the
-- slot) and notify the engineer + supervisor that the slot is now free. Returns
-- the row so the client can reopen the scheduler for the same engineer/project.
CREATE OR REPLACE FUNCTION public.reschedule_booking(_id uuid)
RETURNS public.engineer_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_bookings;
  _n      record;
  _when   text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO result FROM engineer_bookings
    WHERE id = _id AND customer_user_id = _me
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF result.status <> 'booked' THEN RETURN result; END IF;

  UPDATE engineer_bookings
     SET status = 'cancelled', cancel_reason = 'rescheduled'
   WHERE id = _id RETURNING * INTO result;

  SELECT * INTO _n FROM public.booking_party_names(result);
  _when := to_char(result.slot_start, 'Mon DD, HH24:MI');

  PERFORM public.create_notification(result.engineer_user_id, NULL, 'appointment_freed',
    'Slot freed — ' || _n.customer_name || ' is rescheduling',
    'The ' || _when || ' slot is now free (project: ' || _n.project_name || ')');
  PERFORM public.notify_engineer_supervisors(result.engineer_user_id, 'appointment_freed',
    'Slot freed', _n.customer_name || '''s ' || _when || ' slot with ' || _n.engineer_name || ' is now free');

  RETURN result;
END $$;

-- ── tick_appointment_lifecycle ──────────────────────────────────────────────
-- Cron heartbeat: (1) fire a one-time 15-min heads-up to engineer + customer;
-- (2) auto-expire booked slots whose window has passed with no live session,
-- notifying customer, engineer, and supervisor.
CREATE OR REPLACE FUNCTION public.tick_appointment_lifecycle()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _b public.engineer_bookings; _n record; _when text;
BEGIN
  -- (1) 15-min heads-up.
  FOR _b IN
    SELECT * FROM engineer_bookings
     WHERE status = 'booked'
       AND heads_up_sent_at IS NULL
       AND slot_start > now()
       AND slot_start <= now() + interval '15 minutes'
  LOOP
    SELECT * INTO _n FROM public.booking_party_names(_b);
    _when := to_char(_b.slot_start, 'HH24:MI');
    PERFORM public.create_notification(_b.engineer_user_id, NULL, 'appointment_soon',
      'Session with ' || _n.customer_name || ' at ' || _when,
      'Starts in ~15 min · project: ' || _n.project_name);
    PERFORM public.create_notification(_b.customer_user_id, NULL, 'appointment_soon',
      'Your session with ' || _n.engineer_name || ' at ' || _when,
      'Starts in ~15 min · project: ' || _n.project_name);
    UPDATE engineer_bookings SET heads_up_sent_at = now() WHERE id = _b.id;
  END LOOP;

  -- (2) Auto-expire: window passed, never launched into a live session.
  FOR _b IN
    SELECT * FROM engineer_bookings
     WHERE status = 'booked'
       AND slot_end < now()
       AND guest_call_id IS NULL
  LOOP
    UPDATE engineer_bookings SET status = 'expired' WHERE id = _b.id;
    SELECT * INTO _n FROM public.booking_party_names(_b);
    _when := to_char(_b.slot_start, 'Mon DD, HH24:MI');
    PERFORM public.create_notification(_b.customer_user_id, NULL, 'appointment_expired',
      'Missed session with ' || _n.engineer_name,
      'The ' || _when || ' session expired — nobody joined. You can reschedule.');
    PERFORM public.create_notification(_b.engineer_user_id, NULL, 'appointment_expired',
      'Missed session with ' || _n.customer_name,
      'The ' || _when || ' session expired — nobody joined.');
    PERFORM public.notify_engineer_supervisors(_b.engineer_user_id, 'appointment_expired',
      'Session missed', _n.customer_name || '''s ' || _when || ' session with ' || _n.engineer_name || ' expired (no-show)');
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_booking_with_reason(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid) TO authenticated;

-- ── cron: run every minute ──────────────────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'appointment_lifecycle';
SELECT cron.schedule('appointment_lifecycle', '* * * * *',
  $job$ SELECT public.tick_appointment_lifecycle(); $job$);

COMMIT;
