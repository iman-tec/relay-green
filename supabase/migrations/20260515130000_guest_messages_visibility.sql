-- Add a per-message visibility flag to guest_messages so supervisor-only
-- system lines (e.g., the Zoom recording URL + passcode) can live in the
-- same chat timeline as everything else, but render only for supervisor
-- viewers on the client.
--
-- 'all'        — visible to everyone who can read the chat (the default).
-- 'supervisor' — rendered only when the viewer has a pod_lead / ops_manager
--                / admin / super_admin role. The DB still returns the row
--                to anyone who can SELECT it; filtering is client-side, so
--                this is UX hygiene, not an access control boundary.

ALTER TABLE public.guest_messages
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'all'
    CHECK (visibility IN ('all', 'supervisor'));

-- Backfill: tag every pre-existing recording line so old chats hide it for
-- non-supervisors retroactively. Matches the body the zoom-webhook used
-- before this column existed.
UPDATE public.guest_messages
   SET visibility = 'supervisor'
 WHERE sender_kind = 'system'
   AND body LIKE '%Recording available%'
   AND visibility = 'all';
