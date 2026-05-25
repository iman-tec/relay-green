-- ============================================================================
-- Relay — chat_attachments: allow 'audio' kind
-- ============================================================================
-- Voice messages: customers and engineers can now record audio in the
-- composer (via MediaRecorder) and send the resulting blob as a chat
-- attachment with kind='audio'. The recipient sees an inline <audio>
-- player instead of a file-download chip.
--
-- The 50 MB size cap and image-count trigger stay as-is — audio rows
-- count toward neither because the image trigger is keyed off kind.
-- ============================================================================

BEGIN;

-- 1. Drop the old kind CHECK so we can replace it with the wider set.
ALTER TABLE public.chat_attachments
  DROP CONSTRAINT IF EXISTS chat_attachments_kind_check;

-- 2. New CHECK including 'audio'. Keep the constraint name predictable so
--    follow-up migrations can drop it again without scanning for it.
ALTER TABLE public.chat_attachments
  ADD CONSTRAINT chat_attachments_kind_check
  CHECK (kind IN ('image', 'document', 'audio'));

COMMIT;
