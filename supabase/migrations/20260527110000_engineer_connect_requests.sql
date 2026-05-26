-- ============================================================================
-- Engineer connect requests — customer-initiated "ping" when an engineer
-- is Busy or Offline
-- ============================================================================
-- When a customer hits a Busy engineer's "Request" button in the picker,
-- the auto-matcher is bypassed: instead, a connect-request row is created
-- and the engineer sees it in /inbox. They Accept (which spins up a normal
-- guest_calls session and routes the customer in) or Decline.
--
-- This is intentionally narrower than the realtime auto-matcher
-- (engineer_match_offers): a connect-request is a one-to-one ping with an
-- explicit message from the customer; the matcher fans out a queue.
--
-- Why a new table vs. piggy-backing on engineer_match_offers: the matcher
-- table assumes a pre-existing guest_calls row whose session needs an
-- engineer. Connect-requests are pre-session — the customer has a project
-- but no session yet. Sharing the schema would force NULL session_ids and
-- a different lifecycle in code that already does a lot.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.engineer_connect_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engineer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  message           text,
  status            text NOT NULL DEFAULT 'pending',
  session_id        uuid REFERENCES public.guest_calls(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE public.engineer_connect_requests
  DROP CONSTRAINT IF EXISTS engineer_connect_requests_status_check;
ALTER TABLE public.engineer_connect_requests
  ADD CONSTRAINT engineer_connect_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_ecr_engineer_pending
  ON public.engineer_connect_requests (engineer_user_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ecr_customer
  ON public.engineer_connect_requests (customer_user_id, created_at DESC);

ALTER TABLE public.engineer_connect_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customer reads own requests" ON public.engineer_connect_requests;
CREATE POLICY "Customer reads own requests" ON public.engineer_connect_requests
  FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid());

DROP POLICY IF EXISTS "Engineer reads own requests" ON public.engineer_connect_requests;
CREATE POLICY "Engineer reads own requests" ON public.engineer_connect_requests
  FOR SELECT TO authenticated
  USING (engineer_user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read requests" ON public.engineer_connect_requests;
CREATE POLICY "Staff read requests" ON public.engineer_connect_requests
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- Realtime: engineer's /inbox subscribes to INSERT + UPDATE so a new
-- request appears without refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'engineer_connect_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.engineer_connect_requests;
  END IF;
END $$;

-- ── RPC: customer_request_engineer ────────────────────────────────────────
-- Customer-initiated. Creates a pending request. Returns the new row id.
CREATE OR REPLACE FUNCTION public.customer_request_engineer(
  _engineer_user_id uuid,
  _project_id       uuid,
  _message          text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me uuid := auth.uid();
  _new_id uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _engineer_user_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_ENGINEER' USING ERRCODE='P0001';
  END IF;
  IF _me = _engineer_user_id THEN
    RAISE EXCEPTION 'CANNOT_REQUEST_SELF' USING ERRCODE='P0001';
  END IF;

  -- Project (when supplied) must belong to the requester; otherwise we'd
  -- leak someone else's project ids through the request.
  IF _project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects
     WHERE id = _project_id AND customer_id = _me;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Dedupe: a customer pinging the same engineer for the same project
  -- twice in quick succession just refreshes the existing pending row.
  UPDATE public.engineer_connect_requests
     SET message      = COALESCE(_message, message),
         created_at   = now(),
         expires_at   = now() + interval '24 hours'
   WHERE customer_user_id = _me
     AND engineer_user_id = _engineer_user_id
     AND COALESCE(project_id::text, '') = COALESCE(_project_id::text, '')
     AND status = 'pending'
   RETURNING id INTO _new_id;

  IF _new_id IS NULL THEN
    INSERT INTO public.engineer_connect_requests (
      customer_user_id, engineer_user_id, project_id, message
    ) VALUES (_me, _engineer_user_id, _project_id, _message)
    RETURNING id INTO _new_id;
  END IF;

  RETURN _new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.customer_request_engineer(uuid, uuid, text) TO authenticated;

-- ── RPC: accept_connect_request ───────────────────────────────────────────
-- Engineer-side. Flips status → accepted and stamps responded_at. The
-- session itself is created in a separate customer-side step (the customer
-- subscribes to status changes and is shown an "Engineer is ready" CTA
-- which then runs the normal new-session flow). Returns the request row.
CREATE OR REPLACE FUNCTION public.accept_connect_request(_id uuid)
RETURNS public.engineer_connect_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_connect_requests;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM public.engineer_connect_requests
    WHERE id = _id AND engineer_user_id = _me
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF result.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING' USING ERRCODE='P0001';
  END IF;

  UPDATE public.engineer_connect_requests
    SET status = 'accepted', responded_at = now()
    WHERE id = _id
    RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.accept_connect_request(uuid) TO authenticated;

-- ── RPC: decline_connect_request ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decline_connect_request(_id uuid)
RETURNS public.engineer_connect_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_connect_requests;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM public.engineer_connect_requests
    WHERE id = _id AND engineer_user_id = _me
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF result.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING' USING ERRCODE='P0001';
  END IF;

  UPDATE public.engineer_connect_requests
    SET status = 'declined', responded_at = now()
    WHERE id = _id
    RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.decline_connect_request(uuid) TO authenticated;

-- ── RPC: cancel_connect_request (customer side) ───────────────────────────
-- Customer changed their mind / closed the modal. Flips pending → cancelled
-- so the engineer's inbox doesn't keep showing the stale ping.
CREATE OR REPLACE FUNCTION public.cancel_connect_request(_id uuid)
RETURNS public.engineer_connect_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_connect_requests;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM public.engineer_connect_requests
    WHERE id = _id AND customer_user_id = _me
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF result.status <> 'pending' THEN
    RETURN result;
  END IF;

  UPDATE public.engineer_connect_requests
    SET status = 'cancelled', responded_at = now()
    WHERE id = _id
    RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_connect_request(uuid) TO authenticated;

COMMIT;
