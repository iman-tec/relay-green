-- ============================================================================
-- Relay — Project quote requests (GoLive / Maintain-Enhance)
-- ============================================================================
-- Two new customer-initiated workflows that sit alongside the existing
-- live-session flow:
--
--   • "Quote to GoLive"          — customer wants to ship the project they've
--                                  been building with Relay. Picks the project,
--                                  drops a comment, submits.
--   • "Quote to Maintain/Enhance" — same flow, but for ongoing maintenance or
--                                  feature work after launch.
--
-- Both write to this one table with a `kind` discriminator. Supervisor +
-- engineer surfaces (built in a later engineer-parity commit) will read
-- pending rows from their /inbox / /supervise queues and follow up over
-- email — the SLA messaged to the customer is "within 24 hours."
--
-- We don't try to compute the quote in-app: this is an inbound lead — the
-- supervisor or assigned engineer replies via email with the actual figure,
-- and may later flip status to 'quoted' (we keep the lifecycle open so we
-- can hang quote_amount_cents / quote_notes on it without another migration).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_quote_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- 'golive'  : customer wants to ship the project
  -- 'maintain': customer wants ongoing maintenance / enhancement
  kind              text NOT NULL CHECK (kind IN ('golive', 'maintain')),
  comments          text,
  -- Lifecycle:
  --   pending    : submitted, not yet quoted
  --   quoted     : supervisor/engineer has emailed back with a figure
  --   declined   : we can't take it on
  --   cancelled  : customer withdrew the request
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'quoted', 'declined', 'cancelled')),
  -- Optional: when supervisor flips to 'quoted', they can attach the
  -- agreed figure + a short note. Both stay nullable so the lead-capture
  -- path doesn't depend on them being filled in.
  quote_amount_cents bigint,
  quote_notes        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz
);

-- Indexes:
--   • engineer/supervisor /inbox query: pending rows newest-first
--   • customer-side "my requests" query
CREATE INDEX IF NOT EXISTS idx_pqr_pending_kind
  ON public.project_quote_requests (kind, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pqr_customer
  ON public.project_quote_requests (customer_user_id, created_at DESC);

ALTER TABLE public.project_quote_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customer reads own quote requests" ON public.project_quote_requests;
CREATE POLICY "Customer reads own quote requests"
  ON public.project_quote_requests FOR SELECT
  TO authenticated
  USING (customer_user_id = auth.uid());

-- Staff (engineer + above) read everything. Engineers see their inbound
-- leads in /inbox; supervisors see them in /supervise. We don't scope by
-- claimed_by here because no engineer is "assigned" to a quote until a
-- supervisor routes it — the assignment workflow lives in a later commit.
DROP POLICY IF EXISTS "Staff read quote requests" ON public.project_quote_requests;
CREATE POLICY "Staff read quote requests"
  ON public.project_quote_requests FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'engineer')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- No INSERT / UPDATE policies: those happen through the RPCs below. Direct
-- INSERTs from the client are blocked.

-- Realtime: engineer + supervisor /inbox surfaces subscribe to pending
-- INSERTs so new leads appear without refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname    = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'project_quote_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_quote_requests;
  END IF;
END $$;

-- ── RPC: create_project_quote_request ────────────────────────────────
-- Customer-initiated. Verifies the customer owns the project (so they
-- can't request a quote on someone else's row), then inserts a pending
-- record and returns its id.
CREATE OR REPLACE FUNCTION public.create_project_quote_request(
  _project_id uuid,
  _kind       text,
  _comments   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _new_id  uuid;
  _owner   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF _kind NOT IN ('golive', 'maintain') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = 'P0001';
  END IF;

  -- The customer must own the project. We don't surface a list of other
  -- people's projects in the UI, but defending here closes the obvious
  -- forge-a-uuid attack. NB: projects.customer_id (not customer_user_id)
  -- is the owner column — predates the auth.users rename.
  SELECT customer_id INTO _owner FROM projects WHERE id = _project_id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF _owner <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO project_quote_requests (
    customer_user_id, project_id, kind, comments
  ) VALUES (
    auth.uid(), _project_id, _kind, NULLIF(btrim(_comments), '')
  )
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_quote_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project_quote_request(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_project_quote_request(uuid, text, text) IS
  'Customer-initiated quote-request lead. _kind is "golive" or "maintain". Comments are optional. Returns the new row id.';

COMMENT ON TABLE public.project_quote_requests IS
  'Customer-initiated quote leads: "GoLive" = ship the project; "Maintain" = ongoing maintenance/enhancement. Supervisor/engineer follows up over email within 24h SLA.';

COMMIT;
