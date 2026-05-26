-- ============================================================================
-- Relay — Editable session summary (title / overview / next steps)
-- ============================================================================
-- The post-session "Summary" pane was read-only: title, overview, and next
-- steps came from the summarize-guest-call edge fn and stayed frozen for the
-- life of the row. Per product, both parties to the session — the customer
-- (guest_calls.customer_user_id) and the engineer (guest_calls.claimed_by)
-- — should be able to refine the AI's output: edit the title, rewrite the
-- overview, or add/remove/rewrite next steps.
--
-- This migration:
--   1. Adds summary_edited_by / summary_edited_at audit columns so the UI
--      can render "Last edited by Alex 3m ago" affordances later.
--   2. Adds update_guest_call_summary(_call_id, _title, _overview, _next_steps)
--      — SECURITY DEFINER RPC that enforces auth.uid() must equal either the
--      session's customer_user_id or claimed_by. Anything else raises
--      NOT_AUTHORIZED.
--
-- NULL inputs are treated as "don't touch this field" so the UI can submit
-- partial patches (edit just the title without re-sending the overview).
-- Pass an empty string to deliberately clear a text field; pass an empty
-- jsonb array '[]'::jsonb to clear next steps.
-- ============================================================================

BEGIN;

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS summary_edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS summary_edited_at timestamptz;

COMMENT ON COLUMN public.guest_calls.summary_edited_by IS
  'auth.users.id of the last person to manually edit ai_summary_title / ai_summary_overview / ai_next_steps via update_guest_call_summary RPC. NULL if the row is still the original AI-generated draft.';

COMMENT ON COLUMN public.guest_calls.summary_edited_at IS
  'Timestamp of the last manual edit via update_guest_call_summary. Distinct from updated_at, which also bumps on engineer state changes etc.';

-- ── RPC ───────────────────────────────────────────────────────────────
-- Caller passes NULL for any of title / overview / next_steps they don't
-- want to touch. The function builds a sparse UPDATE so untouched fields
-- keep their server-side values exactly.
CREATE OR REPLACE FUNCTION public.update_guest_call_summary(
  _call_id    uuid,
  _title      text,
  _overview   text,
  _next_steps jsonb
)
RETURNS TABLE (
  id                   uuid,
  ai_summary_title     text,
  ai_summary_overview  text,
  ai_next_steps        jsonb,
  summary_edited_by    uuid,
  summary_edited_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row guest_calls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _row
    FROM guest_calls
   WHERE guest_calls.id = _call_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Either party to the session may edit. We do NOT extend this to pod
  -- leads / admins here — those would each warrant their own audit trail
  -- and notification, so it's a deliberate scope limit.
  IF auth.uid() <> _row.customer_user_id AND auth.uid() <> _row.claimed_by THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Validate next_steps shape (if provided): must be a JSON array of either
  -- strings or {text}/{description} objects. We don't normalize here — the
  -- client renderer already handles both shapes — but we reject obvious
  -- garbage so a buggy caller can't store an object in a list field.
  IF _next_steps IS NOT NULL AND jsonb_typeof(_next_steps) <> 'array' THEN
    RAISE EXCEPTION 'NEXT_STEPS_MUST_BE_ARRAY' USING ERRCODE = 'P0001';
  END IF;

  UPDATE guest_calls
     SET ai_summary_title    = CASE WHEN _title      IS NULL THEN ai_summary_title    ELSE NULLIF(_title, '') END,
         ai_summary_overview = CASE WHEN _overview   IS NULL THEN ai_summary_overview ELSE NULLIF(_overview, '') END,
         ai_next_steps       = CASE WHEN _next_steps IS NULL THEN ai_next_steps       ELSE _next_steps END,
         summary_edited_by   = auth.uid(),
         summary_edited_at   = now(),
         updated_at          = now()
   WHERE guest_calls.id = _call_id;

  RETURN QUERY
    SELECT g.id,
           g.ai_summary_title,
           g.ai_summary_overview,
           g.ai_next_steps,
           g.summary_edited_by,
           g.summary_edited_at
      FROM guest_calls g
     WHERE g.id = _call_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_guest_call_summary(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_guest_call_summary(uuid, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_guest_call_summary(uuid, text, text, jsonb) IS
  'Patch ai_summary_title / ai_summary_overview / ai_next_steps on guest_calls. Caller must be the session''s customer_user_id or claimed_by. NULL args leave the corresponding field untouched.';

COMMIT;
