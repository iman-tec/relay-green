-- ============================================================================
-- Relay — Session-artifact edit + delete RPCs
-- ============================================================================
-- The post-session review view (RoomClient.tsx SummaryView and the engineer
-- equivalent in EngineerSessionClient.tsx) now lets the customer and engineer
-- edit the AI summary's title/overview/next-steps inline (see migration
-- 20260527160000_guest_calls_summary_edits.sql). This migration extends that
-- pattern to the other two real artifacts on the same view:
--
--   • The Zoom AI Companion summary card (a guest_messages row with
--     sender_kind='system' and a body starting with "🤖 AI Companion summary")
--   • Per-file delete on attachments listed under "Files exchanged"
--
-- The third visible artifact pair — the AI-summary + Chat-transcript download
-- buttons — needs no RPCs here. They're computed client-side from the
-- (already-editable) session row + message list; editing the upstream data
-- updates the downloads automatically.
--
-- Three SECURITY DEFINER RPCs, all gated to the session's customer_user_id
-- OR claimed_by (the engineer who took the call):
--
--   1. update_guest_message_body(_id uuid, _body text)
--      Rewrites the body text of a single guest_messages row. The realtime
--      sub on guest_messages will deliver the new body so the card re-parses
--      on the next render. Returns the updated row.
--
--   2. delete_guest_message(_id uuid)
--      Hard-deletes the row. Existing FK guest_message_attachments
--      ON DELETE CASCADE removes any attached files at the same time. The
--      storage objects are left alone — the existing 90-day retention
--      sweeper (see purge-completed-projects edge fn) reaps them.
--
--   3. purge_guest_message_attachment(_id uuid)
--      Soft-delete on guest_message_attachments — sets purged=true and
--      purged_at=now() so the existing "Removed after 90-day retention
--      window." UI placeholder kicks in. Re-uses the column the retention
--      sweep already writes to, so the UI doesn't need to branch on
--      "purged-by-user" vs "purged-by-retention." The storage object lives
--      until the retention sweeper finds it.
-- ============================================================================

BEGIN;

-- ── update_guest_message_body ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_guest_message_body(
  _id   uuid,
  _body text
)
RETURNS TABLE (
  id            uuid,
  guest_call_id uuid,
  sender_kind   text,
  body          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _msg guest_messages%ROWTYPE;
  _gc  guest_calls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _msg
    FROM guest_messages
   WHERE guest_messages.id = _id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _gc
    FROM guest_calls
   WHERE guest_calls.id = _msg.guest_call_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Either party to the session may edit any message on it (including the
  -- AI Companion system summary). This is deliberate: the post-session
  -- view is a shared record both sides should be able to refine.
  IF auth.uid() <> _gc.customer_user_id AND auth.uid() <> _gc.claimed_by THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Body may not be NULL — empty-string edits should hit the delete path.
  IF _body IS NULL OR length(btrim(_body)) = 0 THEN
    RAISE EXCEPTION 'BODY_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE guest_messages
     SET body = _body
   WHERE guest_messages.id = _id;

  RETURN QUERY
    SELECT gm.id, gm.guest_call_id, gm.sender_kind, gm.body
      FROM guest_messages gm
     WHERE gm.id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_guest_message_body(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_guest_message_body(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.update_guest_message_body(uuid, text) IS
  'Rewrite the body of a guest_messages row. Caller must be the session''s customer_user_id or claimed_by. Used for editing the post-session AI Companion summary card.';

-- ── delete_guest_message ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_guest_message(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _msg guest_messages%ROWTYPE;
  _gc  guest_calls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _msg
    FROM guest_messages
   WHERE guest_messages.id = _id
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Idempotent: deleting a row that's already gone is a no-op. Prevents
    -- a double-click on the trash icon from raising a confusing error.
    RETURN;
  END IF;

  SELECT * INTO _gc
    FROM guest_calls
   WHERE guest_calls.id = _msg.guest_call_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF auth.uid() <> _gc.customer_user_id AND auth.uid() <> _gc.claimed_by THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  -- Attachments cascade via the FK on guest_message_attachments.
  DELETE FROM guest_messages WHERE guest_messages.id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_guest_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_guest_message(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_guest_message(uuid) IS
  'Hard-delete a guest_messages row. Caller must be the session''s customer_user_id or claimed_by. Attached files cascade-delete.';

-- ── purge_guest_message_attachment ───────────────────────────────────
-- We don't hard-delete the attachment row because the "Files exchanged"
-- list is positional history — the empty slot is still meaningful
-- ("Engineer removed this file"). Setting purged=true reuses the same
-- placeholder the retention sweep produces; the UI already renders it
-- as a disabled / faded row.
CREATE OR REPLACE FUNCTION public.purge_guest_message_attachment(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _att  guest_message_attachments%ROWTYPE;
  _msg  guest_messages%ROWTYPE;
  _gc   guest_calls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _att
    FROM guest_message_attachments
   WHERE guest_message_attachments.id = _id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;  -- idempotent
  END IF;

  SELECT * INTO _msg
    FROM guest_messages
   WHERE guest_messages.id = _att.message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _gc
    FROM guest_calls
   WHERE guest_calls.id = _msg.guest_call_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF auth.uid() <> _gc.customer_user_id AND auth.uid() <> _gc.claimed_by THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE guest_message_attachments
     SET purged    = true,
         purged_at = now()
   WHERE guest_message_attachments.id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_guest_message_attachment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_guest_message_attachment(uuid) TO authenticated;

COMMENT ON FUNCTION public.purge_guest_message_attachment(uuid) IS
  'User-initiated soft-delete of a chat attachment. Sets purged=true / purged_at=now() so the existing retention-purge UI branch handles it. Caller must be the session''s customer_user_id or claimed_by.';

COMMIT;
