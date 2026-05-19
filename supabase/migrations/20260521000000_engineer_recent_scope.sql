-- ============================================================================
-- Engineer-visibility scoping for /dashboard + /inbox "recent" history
-- ============================================================================
-- Previously `useEngineerWorkspace.recent` ran an unscoped
--
--     SELECT * FROM guest_calls ORDER BY created_at DESC LIMIT 40
--
-- so every engineer saw the entire platform's call history. That leaked
-- other customers' sessions to engineers who'd never been involved.
--
-- New rule:
--   • An engineer sees a session if they themselves claimed it, OR
--   • the session shares a (customer_user_id, project_id) tuple with
--     ANY session this engineer has previously claimed.
--
-- Result:
--   • Brand-new engineer (no claims yet) → empty dashboard/inbox.
--   • After they take their first call from CLIENT1 on PROJECT_A, they
--     see EVERY past + future session for CLIENT1/PROJECT_A — including
--     ones claimed by other engineers — but nothing from CLIENT1's
--     other projects and nothing from CLIENT2.
--
-- NULL customer_user_id (anonymous guests) and NULL project_id (legacy
-- "General" sessions) don't aggregate, so only sessions an engineer
-- personally claimed show up for those.
--
-- Supervisors / pod_leads / admins / super_admins can call the RPC with
-- any engineer id (used by /supervise and /inbox-as-supervisor views).
-- Engineers can only call it with their own uid.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.engineer_recent_sessions(
  _engineer_id uuid,
  _limit       int  DEFAULT 40
)
RETURNS SETOF public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  -- An engineer can only ask about their own history. Supervisors and
  -- above can ask about anyone (used when monitoring an engineer's queue).
  IF auth.uid() <> _engineer_id
     AND NOT (
       has_role(auth.uid(), 'pod_lead')   OR
       has_role(auth.uid(), 'ops_manager') OR
       has_role(auth.uid(), 'admin')       OR
       has_role(auth.uid(), 'super_admin')
     )
  THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
  SELECT gc.*
    FROM guest_calls gc
   WHERE
     -- 1. Sessions the engineer themselves claimed (always visible).
     gc.claimed_by = _engineer_id
     OR
     -- 2. Sessions that share a (customer, project) tuple with at least
     --    one session the engineer has claimed in the past. Both fields
     --    must be non-NULL on both sides — anonymous guests and legacy
     --    no-project sessions only show via path (1).
     (
       gc.customer_user_id IS NOT NULL
       AND gc.project_id   IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM guest_calls prior
         WHERE prior.claimed_by        = _engineer_id
           AND prior.customer_user_id  = gc.customer_user_id
           AND prior.project_id        = gc.project_id
       )
     )
   ORDER BY gc.created_at DESC
   LIMIT _limit;
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_recent_sessions(uuid, int) TO authenticated;

COMMIT;
