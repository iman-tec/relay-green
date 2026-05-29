-- ============================================================================
-- Bid approval workflow — engineer bids route through a supervisor review
-- ============================================================================
-- Previously `submit_project_bid` flipped a request straight to 'quoted'
-- (visible to the customer) regardless of who sent it. New flow:
--
--   • ENGINEER submits a bid        → status 'pending_review'
--                                     (parks in the supervisor's Review queue;
--                                      NOT visible to the customer yet)
--   • SUPERVISOR / admin reviews,    → status 'quoted'
--     edits, and sends                 (now visible to the customer)
--   • SUPERVISOR / admin's own bid   → status 'quoted' directly
--     (they ARE the reviewer)          (no self-review step)
--
-- Adds the 'pending_review' lifecycle state + prepared_by/prepared_at to record
-- the engineer who drafted a bid awaiting review. Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- New intermediate state: 'pending_review' (engineer bid awaiting supervisor).
ALTER TABLE public.project_quote_requests
  DROP CONSTRAINT IF EXISTS project_quote_requests_status_check;
ALTER TABLE public.project_quote_requests
  ADD CONSTRAINT project_quote_requests_status_check
  CHECK (status IN ('pending', 'pending_review', 'quoted', 'committed', 'declined', 'cancelled'));

-- Who drafted the bid that's awaiting review (distinct from responded_by, the
-- supervisor who finally sends it to the customer).
ALTER TABLE public.project_quote_requests
  ADD COLUMN IF NOT EXISTS prepared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz;

-- ── RPC: submit_project_bid (engineer / supervisor / admin) ─────────────────
-- Engineers route to 'pending_review'; supervisors/admins send straight to the
-- customer ('quoted'). Amount in EUR cents; terms_url defaults to the standard
-- T&C. Open from pending | pending_review | quoted (re-bid overwrites and, for
-- an engineer, re-enters review).
CREATE OR REPLACE FUNCTION public.submit_project_bid(
  _id            uuid,
  _amount_cents  bigint,
  _scope         text,
  _timeline      text,
  _validity_days int,
  _terms_url     text
)
RETURNS public.project_quote_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me         uuid := auth.uid();
  _is_super   boolean;
  _new_status text;
  result      public.project_quote_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  _is_super := has_role(_me,'supervisor') OR has_role(_me,'admin') OR has_role(_me,'super_admin');
  IF NOT (_is_super OR has_role(_me,'engineer')) THEN
    RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE='P0001';
  END IF;
  IF _amount_cents IS NULL OR _amount_cents < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='P0001';
  END IF;

  -- Supervisor/admin → straight to the customer. Engineer → into review.
  _new_status := CASE WHEN _is_super THEN 'quoted' ELSE 'pending_review' END;

  UPDATE project_quote_requests
     SET status             = _new_status,
         quote_amount_cents = _amount_cents,
         bid_scope          = NULLIF(btrim(_scope), ''),
         bid_timeline       = NULLIF(btrim(_timeline), ''),
         bid_validity_until = CASE WHEN COALESCE(_validity_days,0) > 0
                                   THEN now() + make_interval(days => _validity_days) END,
         terms_url          = COALESCE(NULLIF(btrim(_terms_url), ''), '/legal/relay-terms-and-conditions.pdf'),
         -- Supervisor send stamps responded_by/at (the customer-facing send);
         -- an engineer draft stamps prepared_by/at and leaves responded_* until
         -- a supervisor actually sends it.
         responded_by       = CASE WHEN _is_super THEN _me  ELSE responded_by END,
         responded_at       = CASE WHEN _is_super THEN now() ELSE responded_at END,
         prepared_by        = CASE WHEN _is_super THEN prepared_by ELSE _me  END,
         prepared_at        = CASE WHEN _is_super THEN prepared_at ELSE now() END,
         customer_viewed_at = NULL  -- fresh bid → re-trigger the blinking icon when sent
   WHERE id = _id AND status IN ('pending', 'pending_review', 'quoted')
   RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_OPEN' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_project_bid(uuid, bigint, text, text, int, text) TO authenticated;

COMMENT ON FUNCTION public.submit_project_bid(uuid, bigint, text, text, int, text) IS
  'Submit a one-page bid. Engineer → pending_review (supervisor approves & sends); supervisor/admin → quoted (sent to customer).';

COMMIT;
