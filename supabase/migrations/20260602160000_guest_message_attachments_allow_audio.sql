-- ============================================================================
-- Relay — Fix: allow 'audio' kind on guest_message_attachments (voice messages)
-- ============================================================================
-- Voice messages insert a chat attachment with kind='audio' (see
-- lib/relay/chatAttachments.ts → AttachmentKind / classify()). The original
-- table (20260514170000_chat_attachments.sql) created an inline
--   CHECK (kind IN ('image','document'))
-- which Postgres auto-named `guest_message_attachments_kind_check`.
--
-- The migration meant to widen it for audio
-- (20260526100000_chat_attachments_audio.sql) targeted the WRONG table —
-- `public.chat_attachments` instead of `public.guest_message_attachments` —
-- so the real constraint was never updated. Sending a voicemail therefore
-- fails live with:
--   new row for relation "guest_message_attachments"
--   violates check constraint "guest_message_attachments_kind_check"
--
-- This migration fixes the constraint on the correct table. Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.guest_message_attachments
  DROP CONSTRAINT IF EXISTS guest_message_attachments_kind_check;

ALTER TABLE public.guest_message_attachments
  ADD CONSTRAINT guest_message_attachments_kind_check
  CHECK (kind IN ('image', 'document', 'audio'));

COMMIT;
