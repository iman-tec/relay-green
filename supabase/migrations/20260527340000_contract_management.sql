-- ============================================================================
-- Contract management — quote → 1-page bid → contract (customer ↔ engineer)
-- ============================================================================
-- Builds the post-"bid sent" lifecycle on top of project_quote_requests:
-- engineer submits a one-page bid (amount + scope + timeline + T&C); customer
-- views it (clears the blinking icon), optionally requests an appointment, or
-- pays & commits. Supervisor incorporation is deferred to its module.
-- ============================================================================

BEGIN;

-- New terminal state: 'committed' (paid, work starts).
ALTER TABLE public.project_quote_requests
  DROP CONSTRAINT IF EXISTS project_quote_requests_status_check;
ALTER TABLE public.project_quote_requests
  ADD CONSTRAINT project_quote_requests_status_check
  CHECK (status IN ('pending', 'quoted', 'committed', 'declined', 'cancelled'));

ALTER TABLE public.project_quote_requests
  ADD COLUMN IF NOT EXISTS bid_scope            text,
  ADD COLUMN IF NOT EXISTS bid_timeline         text,
  ADD COLUMN IF NOT EXISTS bid_validity_until   timestamptz,
  ADD COLUMN IF NOT EXISTS responded_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_viewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_note     text,
  ADD COLUMN IF NOT EXISTS payment_intent_id    text,
  ADD COLUMN IF NOT EXISTS paid_at              timestamptz,
  ADD COLUMN IF NOT EXISTS committed_at         timestamptz;

-- ── RPC: submit_project_bid (engineer / staff) ──────────────────────────────
-- The one-page bid. Staff-only. Flips pending|quoted → quoted (re-bid
-- overwrites). Amount in EUR cents; terms_url defaults to the standard T&C.
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
  _me     uuid := auth.uid();
  result  public.project_quote_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF NOT (
    has_role(_me,'engineer') OR has_role(_me,'supervisor')
    OR has_role(_me,'admin') OR has_role(_me,'super_admin')
  ) THEN
    RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE='P0001';
  END IF;
  IF _amount_cents IS NULL OR _amount_cents < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='P0001';
  END IF;

  UPDATE project_quote_requests
     SET status             = 'quoted',
         quote_amount_cents = _amount_cents,
         bid_scope          = NULLIF(btrim(_scope), ''),
         bid_timeline       = NULLIF(btrim(_timeline), ''),
         bid_validity_until = CASE WHEN COALESCE(_validity_days,0) > 0
                                   THEN now() + make_interval(days => _validity_days) END,
         terms_url          = COALESCE(NULLIF(btrim(_terms_url), ''), '/legal/relay-terms-and-conditions.pdf'),
         responded_by       = _me,
         responded_at       = now(),
         customer_viewed_at = NULL  -- fresh bid → re-trigger the blinking icon
   WHERE id = _id AND status IN ('pending', 'quoted')
   RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_OPEN' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_project_bid(uuid, bigint, text, text, int, text) TO authenticated;

-- ── RPC: mark_quote_viewed (customer) ───────────────────────────────────────
-- Customer opened the bid → clears the blinking icon. Owner-only.
CREATE OR REPLACE FUNCTION public.mark_quote_viewed(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  UPDATE project_quote_requests
     SET customer_viewed_at = COALESCE(customer_viewed_at, now())
   WHERE id = _id AND customer_user_id = _me AND status = 'quoted';
END $$;

GRANT EXECUTE ON FUNCTION public.mark_quote_viewed(uuid) TO authenticated;

-- ── RPC: request_quote_appointment (customer) ───────────────────────────────
-- Customer wants to talk before committing. Owner-only; stays 'quoted'.
CREATE OR REPLACE FUNCTION public.request_quote_appointment(_id uuid, _note text)
RETURNS public.project_quote_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.project_quote_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  UPDATE project_quote_requests
     SET appointment_requested_at = now(), appointment_note = NULLIF(btrim(_note), '')
   WHERE id = _id AND customer_user_id = _me AND status = 'quoted'
   RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_QUOTED' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.request_quote_appointment(uuid, text) TO authenticated;

COMMIT;
