-- Customer responses to a bid: decline, or request changes (re-queues for a
-- fresh bid). Adds a note column the staff side can read, plus two RPCs.
-- Idempotent: safe to re-run.

ALTER TABLE project_quote_requests
  ADD COLUMN IF NOT EXISTS customer_response_note text;

-- Customer asks for changes → the request goes back to the staff queue
-- ('pending' = "needs bid") with the prior bid kept as a starting point and
-- the customer's note attached. Clears the seen flag so the re-bid blinks.
CREATE OR REPLACE FUNCTION public.request_quote_changes(_id uuid, _note text)
 RETURNS project_quote_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _me     uuid := auth.uid();
  result  public.project_quote_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  UPDATE project_quote_requests
     SET status               = 'pending',
         customer_response_note = NULLIF(btrim(_note), ''),
         customer_viewed_at     = NULL,
         responded_at           = NULL
   WHERE id = _id AND customer_user_id = _me AND status = 'quoted'
   RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_QUOTED' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $function$;

-- Customer declines the bid outright.
CREATE OR REPLACE FUNCTION public.decline_quote(_id uuid, _note text)
 RETURNS project_quote_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _me     uuid := auth.uid();
  result  public.project_quote_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  UPDATE project_quote_requests
     SET status                 = 'declined',
         customer_response_note  = NULLIF(btrim(_note), '')
   WHERE id = _id AND customer_user_id = _me AND status IN ('quoted', 'pending')
   RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_ACTIONABLE' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $function$;

GRANT EXECUTE ON FUNCTION public.request_quote_changes(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_quote(uuid, text) TO authenticated;
