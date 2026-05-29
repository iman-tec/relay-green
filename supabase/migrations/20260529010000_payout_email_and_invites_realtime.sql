-- Two small additions to support the channel-partner Settings tab:
--
--   1. resellers.payout_email — where commission statements + payouts are
--      sent. Per-partner, single value, free-text email. Editable from the
--      Settings tab (until now the UI surfaced the field but the save was a
--      TODO and reset on reload).
--
--   2. public.invites in supabase_realtime — so the partner's invite status
--      table updates live when our trg_mark_invites_accepted_on_signin
--      trigger flips a row to 'accepted'. RLS continues to scope events to
--      the inviter (and super_admin), so this doesn't widen any access.

BEGIN;

ALTER TABLE public.resellers
  ADD COLUMN IF NOT EXISTS payout_email text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname    = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'invites'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.invites';
  END IF;
END $$;

COMMIT;
