-- ============================================================================
-- Engineer notification preferences — email opt-in flag
-- ============================================================================
-- Mirrors the customer-side prefs added in 20260526120000. Default TRUE per
-- the engineer ToS (session assignments, payout notifications, account
-- security messages) — engineer flips it OFF from the Notifications tab in
-- their Profile pane.
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_profiles
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_notifications_updated_at timestamptz;

COMMIT;
