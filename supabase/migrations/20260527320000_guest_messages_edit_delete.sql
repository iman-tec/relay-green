-- ============================================================================
-- Relay — guest_messages: WhatsApp-parity edit + delete for chat messages
-- ============================================================================
-- The customer-side ChatPanelStub (app/room/RoomClient.tsx) supports per-
-- bubble Edit / Delete on local DRAFTS. The engineer-side session-review
-- chat (app/session-review/[id]/SessionReviewClient.tsx) writes the same
-- shape directly to guest_messages for post-call follow-ups. To bring
-- the engineer's experience to WhatsApp parity — and to let the customer
-- edit their own message after it has reached an engineer — guest_messages
-- needs:
--
--   1. edited_at  timestamptz   audit column, set on UPDATE of body
--   2. deleted_at timestamptz   soft-delete marker (we keep the row so
--      realtime listeners can react; the client filters deleted rows out)
--   3. UPDATE RLS policy   author of the row can edit their own body
--   4. DELETE RLS policy   author of the row can hard-delete their own
--      messages (we expose both soft- and hard-delete; the UI uses soft-
--      delete by default but the policy permits a true DELETE for cleanup
--      paths like the 90-day retention sweeper)
--
-- Sender identity for RLS comes from guest_messages.sender_id, which we
-- set on every insert from both engineer + customer composers. Rows with
-- sender_id IS NULL (legacy / anonymous guest rows from the pre-auth
-- window) cannot be edited or deleted — they're effectively immutable.
-- ============================================================================

BEGIN;

-- 1. New audit columns.
ALTER TABLE public.guest_messages
  ADD COLUMN IF NOT EXISTS edited_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.guest_messages.edited_at IS
  'Timestamp of the last edit to body. NULL = never edited. Set by the client on edit.';
COMMENT ON COLUMN public.guest_messages.deleted_at IS
  'Soft-delete marker. NULL = visible. When set, the client filters the row out of the chat view.';

-- 2. UPDATE policy — author can edit their own body / set edited_at /
--    set deleted_at. We don't restrict which columns the UPDATE touches
--    because Postgres' RLS UPDATE policy gates the whole row; the client
--    is responsible for only modifying intended columns. Hardening can
--    come later via a column-level grant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'guest_messages'
       AND policyname = 'guest_messages_author_update'
  ) THEN
    CREATE POLICY guest_messages_author_update
      ON public.guest_messages FOR UPDATE TO authenticated
      USING (sender_id = auth.uid())
      WITH CHECK (sender_id = auth.uid());
  END IF;
END $$;

-- 3. DELETE policy — author can hard-delete their own messages. The
--    primary delete path in the UI is the soft-delete (UPDATE deleted_at)
--    so this policy mainly serves cleanup tooling + the retention sweeper.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'guest_messages'
       AND policyname = 'guest_messages_author_delete'
  ) THEN
    CREATE POLICY guest_messages_author_delete
      ON public.guest_messages FOR DELETE TO authenticated
      USING (sender_id = auth.uid());
  END IF;
END $$;

COMMIT;
