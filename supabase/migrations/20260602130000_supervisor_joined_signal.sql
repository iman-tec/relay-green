-- ============================================================================
-- supervisor_joined_at — "the moderator has joined the appointment"
-- ============================================================================
-- For an appointment, the customer should see a ringing/connecting screen until
-- SOMEONE joins — the supervisor (moderator) OR an engineer. An engineer joining
-- flips the session out of 'queued' (already a signal), but a supervisor
-- monitoring doesn't change status or claimed_by. This adds an explicit stamp
-- the supervisor sets when they open the appointment session, so the customer's
-- room can drop the ring and start the chat (and enable the Zoom call).
--
-- Additive: one nullable column + one SECURITY DEFINER RPC. Nothing dropped.
-- ============================================================================

BEGIN;

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS supervisor_joined_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_supervisor_joined(_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  -- Supervisor-tier only; anyone else is a silent no-op.
  IF NOT (public.has_role(_me, 'supervisor') OR public.has_role(_me, 'super_admin')) THEN
    RETURN;
  END IF;
  UPDATE public.guest_calls
     SET supervisor_joined_at = COALESCE(supervisor_joined_at, now())
   WHERE id = _session_id
     AND is_appointment = true;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_supervisor_joined(uuid) TO authenticated;

COMMIT;
