-- ============================================================================
-- Quote requests — supervisor respond (issue a proposal) + Terms & Conditions
-- ============================================================================
-- Adds the supervisor-side write path to project_quote_requests: scope the
-- estimate, attach an amount + notes + a Terms & Conditions link, and flip the
-- lead to 'quoted'. terms_url defaults to the standard T&C page.
-- ============================================================================

BEGIN;

ALTER TABLE public.project_quote_requests
  ADD COLUMN IF NOT EXISTS terms_url text;

-- ── RPC: respond_project_quote_request (supervisor / staff) ─────────────────
-- Issues the proposal. Staff-only (supervisor and above). Amount is in EUR
-- cents; notes + terms_url optional (terms_url defaults to /legal/terms-of-use).
CREATE OR REPLACE FUNCTION public.respond_project_quote_request(
  _id           uuid,
  _amount_cents bigint,
  _notes        text,
  _terms_url    text
)
RETURNS public.project_quote_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.project_quote_requests;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (
    has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')
    OR has_role(_me, 'engineer')
  ) THEN
    RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE='P0001';
  END IF;
  IF _amount_cents IS NULL OR _amount_cents < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='P0001';
  END IF;

  UPDATE project_quote_requests
     SET status             = 'quoted',
         quote_amount_cents = _amount_cents,
         quote_notes        = NULLIF(btrim(_notes), ''),
         terms_url          = COALESCE(NULLIF(btrim(_terms_url), ''), '/legal/terms-of-use'),
         responded_at       = now()
   WHERE id = _id AND status = 'pending'
   RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'QUOTE_NOT_PENDING' USING ERRCODE='P0001';
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.respond_project_quote_request(uuid, bigint, text, text) TO authenticated;

COMMIT;
