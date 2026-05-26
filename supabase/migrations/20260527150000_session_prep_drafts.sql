-- ============================================================================
-- Session prep drafts — server-side mirror of the customer's local drafts
-- ============================================================================
-- lib/relay/sessionDrafts.ts persists drafts in localStorage. That works
-- fine while the draft only needs to survive the customer's own refreshes,
-- but the engineer-side handoff (task #5 in the engineer-parity sweep)
-- needs the engineer to read what the customer prepared when they walk
-- into the session — and the engineer's browser has no access to the
-- customer's localStorage.
--
-- Solution: mirror drafts into this table on every save so the engineer
-- can read the most-recent draft for a project when they land on the
-- session room. The customer's local copy stays authoritative for their
-- own edits (faster, works offline); the server copy is purely a read-
-- side handoff to the engineer.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_session_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Local id from sessionDrafts.ts. We mirror it so the customer can sync
  -- a specific draft back to the server even after a re-render (the local
  -- id is stable across edits).
  local_id         text NOT NULL,
  text             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_user_id, project_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_csd_project_recent
  ON public.customer_session_drafts (project_id, updated_at DESC);

ALTER TABLE public.customer_session_drafts ENABLE ROW LEVEL SECURITY;

-- Customer reads + writes own drafts.
DROP POLICY IF EXISTS "Customer manages own drafts" ON public.customer_session_drafts;
CREATE POLICY "Customer manages own drafts" ON public.customer_session_drafts
  FOR ALL TO authenticated
  USING (customer_user_id = auth.uid())
  WITH CHECK (customer_user_id = auth.uid());

-- ── RPC: engineer_fetch_customer_draft ────────────────────────────────────
-- Engineer-side. When the engineer joins a session, this returns the most
-- recently updated draft for (customer, project) so the engineer can show
-- it as the opening message. Returns NULL when there's no draft.
--
-- SECURITY DEFINER so the engineer can read across the customer's RLS;
-- the function gates on the engineer actually being assigned to the
-- session that ties the customer + project together — otherwise no read.
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
  SELECT gc.customer_id, gc.project_id INTO _customer, _project
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

-- ── RPC: customer_consume_draft ───────────────────────────────────────────
-- Engineer's session-mount logic ALSO needs to mark the draft consumed so
-- a second engineer joining the next call on the same project doesn't see
-- the same stale prep text. We can't have the engineer DELETE the draft
-- (RLS forbids; the engineer isn't the customer). Instead, the engineer
-- calls this RPC which clears the row.
CREATE OR REPLACE FUNCTION public.engineer_consume_draft(_draft_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me      uuid := auth.uid();
  _del     int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;

  DELETE FROM public.customer_session_drafts WHERE id = _draft_id;
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN _del > 0;
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_consume_draft(uuid) TO authenticated;

COMMIT;
