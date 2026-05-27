-- ============================================================================
-- Relay — Extend chat-attachments bucket allowed_mime_types to include audio
-- ============================================================================
-- The chat-attachments bucket was originally provisioned (migration
-- 20260514170000_chat_attachments.sql) with a docs+images allowlist. When
-- migration 20260526100000_chat_attachments_audio.sql extended the
-- guest_message_attachments.kind CHECK to allow 'audio', the bucket-level
-- MIME allowlist wasn't updated to match. Audio uploads (MediaRecorder
-- blobs from the voice-record button) would be rejected by the bucket
-- before our app code ever saw them.
--
-- This migration aligns the bucket allowlist with the audio MIMEs we
-- already accept in lib/relay/chatAttachments.ts (ACCEPTED_AUDIO_MIME).
-- Same set + adds the two browser-recorded defaults (webm/opus for
-- Chrome/Firefox, audio/mp4 for Safari).
-- ============================================================================

BEGIN;

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
     -- documents
     'application/pdf',
     'text/plain',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/msword',
     -- images
     'image/jpeg', 'image/png', 'image/webp', 'image/gif',
     -- audio (MediaRecorder defaults + common user-uploaded voice notes)
     'audio/webm',
     'audio/ogg',
     'audio/mp4',
     'audio/mpeg',
     'audio/wav',
     'audio/x-wav',
     'audio/x-m4a'
   ]
 WHERE id = 'chat-attachments';

COMMIT;
