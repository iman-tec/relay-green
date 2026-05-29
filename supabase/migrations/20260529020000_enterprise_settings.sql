-- Enterprise admin Settings tab — backing tables + columns.
--
-- Adds the three things the Settings tab needed but didn't have storage
-- for, plus a profile column for GDPR-style member erasure:
--
--   1. enterprise_notification_prefs
--        Per-event toggles (session_alerts, low_minutes, weekly_digest).
--        Mirror of reseller_notification_prefs (same RLS pattern).
--
--   2. organizations.retention_days
--        Org-chosen retention window. NULL or 0 means "indefinite" — only
--        a positive int means "purge sessions/content older than N days".
--        Persistence-only in this phase; no sweeper yet. The future sweeper
--        will key off this column.
--
--   3. profiles.erased_at
--        Timestamp of a per-member GDPR erasure. When non-null, the API
--        nulls full_name / avatar_url at erase time and the UI renders
--        "Erased member" for any reference to that profile. We preserve
--        the row (and any FK pointing to it from sessions / billing) so
--        aggregate counts and reconciliation still work.
--
-- All RLS mirrors existing patterns (enterprise_admin scoped by
-- profiles.organization_id; super_admin bypasses).

BEGIN;

-- =====================================================================
-- 1. enterprise_notification_prefs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.enterprise_notification_prefs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL UNIQUE
                    REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_alerts   boolean NOT NULL DEFAULT true,
  low_minutes      boolean NOT NULL DEFAULT true,
  weekly_digest    boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.enterprise_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY enterprise_notification_prefs_self_read
  ON public.enterprise_notification_prefs FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.organization_id IS NOT NULL
    )
  );

CREATE POLICY enterprise_notification_prefs_self_write
  ON public.enterprise_notification_prefs FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.organization_id IS NOT NULL
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.organization_id IS NOT NULL
    )
  );

CREATE POLICY enterprise_notification_prefs_super_admin_all
  ON public.enterprise_notification_prefs FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- Reuse the touch_updated_at() function created in 20260528140000.
DROP TRIGGER IF EXISTS trg_touch_enterprise_notification_prefs ON public.enterprise_notification_prefs;
CREATE TRIGGER trg_touch_enterprise_notification_prefs
  BEFORE UPDATE ON public.enterprise_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 2. organizations.retention_days
-- =====================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS retention_days int
    CHECK (retention_days IS NULL OR retention_days = 0 OR retention_days BETWEEN 1 AND 3650);

-- =====================================================================
-- 3. profiles.erased_at
-- =====================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS erased_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_erased_at
  ON public.profiles (erased_at) WHERE erased_at IS NOT NULL;

COMMIT;
