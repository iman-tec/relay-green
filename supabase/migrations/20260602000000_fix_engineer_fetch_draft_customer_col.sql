-- ============================================================================
-- Fix engineer_fetch_customer_draft: guest_calls has no customer_id column
-- ============================================================================
-- The original engineer_fetch_customer_draft (migration 20260527150000) read
--   SELECT gc.customer_id, gc.project_id ...
-- but guest_calls stores the customer's auth uid in `customer_user_id`, NOT
-- `customer_id` (which only exists on `projects` et al — see the NB note in
-- migration 20260527210000). So the function raised
--   column gc.customer_id does not exist
-- at runtime. The engineer's session-mount handler wraps the call in a
-- best-effort try/catch, so the error was swallowed and the customer's prep
-- text ("Tell the engineer what you're working on") never reached the
-- engineer's chat — the handoff silently no-op'd on every session.
--
-- This migration is a drop-in replacement that selects the correct column.
-- Body is otherwise identical to the original.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.engineer_fetch_customer_draft(_session_id uuid)
RETURNS public.customer_session_drafts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me        uuid := auth.uid();
  _customer  uuid;
  _project   uuid;
  result     public.customer_session_drafts;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  -- Pull the session's customer + project. The engineer must be the
  -- claimed engineer OR a supervisor to read the draft.
  SELECT gc.customer_user_id, gc.project_id INTO _customer, _project
    FROM public.guest_calls gc
   WHERE gc.id = _session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _customer IS NULL OR _project IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.guest_calls gc
   WHERE gc.id = _session_id
     AND (gc.claimed_by = _me
          OR has_role(_me, 'supervisor')
          OR has_role(_me, 'admin')
          OR has_role(_me, 'super_admin'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM public.customer_session_drafts
    WHERE customer_user_id = _customer
      AND project_id = _project
    ORDER BY updated_at DESC
    LIMIT 1;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_fetch_customer_draft(uuid) TO authenticated;

COMMIT;
