-- ============================================================================
-- Relay — Customer notification preferences
-- ============================================================================
-- Email notifications are opt-IN by default per the ToS the customer signs
-- at account creation (account-related communications, session summaries,
-- recharge receipts). They can flip this off from
-- Account → Notifications at any time; the column persists per user.
--
-- In-app notifications live in the Relay desktop app (push-to-OS),
-- so they don't need a server-side toggle here — install = on,
-- uninstall = off. Only email needs storage.
-- ============================================================================

BEGIN;

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_notifications_updated_at timestamptz;

COMMENT ON COLUMN public.customer_profiles.email_notifications_enabled IS
  'Customer email preference. TRUE by default at signup (covered by ToS + privacy policy). Flipping FALSE suppresses all transactional + marketing email for this account.';

COMMIT;
