-- ============================================================================
-- Intake transcript + summary
-- ============================================================================
-- Adds:
--   client_intakes.intake_messages JSONB    : append-only array of {role, body,
--                                              attachment?, created_at} entries
--                                              captured during ringing.
--   client_intakes.intake_summary  TEXT     : LLM-generated summary the engineer
--                                              reads on the staff session screen.
--   client_intakes.intake_summary_updated_at timestamptz
--
-- RPCs:
--   append_intake_message(_intake_id, _role, _body, _attachment)
--     SECURITY DEFINER, customer-only (auth.uid() must match
--     client_intakes.customer_user_id). Appends one message to the JSONB array
--     using jsonb_set so concurrent appends are race-safe.
--
-- Staff read access is already granted by the existing "Staff read intakes"
-- policy in 20260520100000_onboarding_and_matching.sql — no policy change
-- required for the engineer tray.
-- ============================================================================

BEGIN;

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS intake_messages          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS intake_summary           text,
  ADD COLUMN IF NOT EXISTS intake_summary_updated_at timestamptz;

-- ── append_intake_message ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.append_intake_message(
  _intake_id   uuid,
  _role        text,
  _body        text,
  _attachment  jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
  _entry jsonb;
BEGIN
  IF _role NOT IN ('assistant', 'user') THEN
    RAISE EXCEPTION 'role must be assistant or user, got %', _role;
  END IF;

  SELECT customer_user_id INTO _owner
  FROM public.client_intakes
  WHERE id = _intake_id;

  IF _owner IS NULL THEN
    RAISE EXCEPTION 'intake % not found', _intake_id;
  END IF;

  -- Customer can only append to their own intake. Staff (engineer/supervisor)
  -- should never write to intake_messages; tray is read-only.
  IF _owner <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized to append to intake %', _intake_id
      USING ERRCODE = '42501';
  END IF;

  _entry := jsonb_build_object(
    'role',       _role,
    'body',       _body,
    'created_at', extract(epoch from now()) * 1000
  );
  IF _attachment IS NOT NULL THEN
    _entry := _entry || jsonb_build_object('attachment', _attachment);
  END IF;

  UPDATE public.client_intakes
  SET intake_messages = COALESCE(intake_messages, '[]'::jsonb) || jsonb_build_array(_entry)
  WHERE id = _intake_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_intake_message(uuid, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.append_intake_message(uuid, text, text, jsonb) TO authenticated;

COMMIT;
