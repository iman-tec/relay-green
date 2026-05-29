-- Reseller (Channel Partner) settings tables.
--
-- Adds three reseller-scoped tables backing the Channel Partner Settings tab:
--   1. reseller_team_members      — internal teammates managed by the partner.
--   2. reseller_notification_prefs — per-event notification toggles.
--   3. reseller_branding          — white-label config (color, display name).
--
-- All three follow the same RLS pattern as `resellers`:
--   <table>_self_*       — caller's profile.reseller_id must match the row's reseller_id.
--   <table>_super_admin_all — has_role(auth.uid(), 'super_admin') bypasses.
--
-- Notes:
--   * Active team members are also represented in `profiles.reseller_id`
--     (set when an invite is accepted); this table is the source of truth
--     for the team list + holds invites awaiting account creation.
--   * Notification prefs and branding tables hold AT MOST one row per
--     reseller (UNIQUE constraint on reseller_id). The API lazy-creates
--     defaults on first read.

-- =====================================================================
-- 1. reseller_team_members
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.reseller_team_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id   uuid NOT NULL REFERENCES public.resellers(id) ON DELETE CASCADE,
  email         text NOT NULL,
  full_name     text,
  role          text NOT NULL DEFAULT 'manager'
                CHECK (role IN ('manager', 'analyst', 'admin')),
  status        text NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'active', 'removed')),
  user_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One non-removed row per (reseller, email). Removed rows can accumulate for audit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reseller_team_members_active
  ON public.reseller_team_members (reseller_id, lower(email))
  WHERE status <> 'removed';

CREATE INDEX IF NOT EXISTS idx_reseller_team_members_reseller
  ON public.reseller_team_members (reseller_id);
CREATE INDEX IF NOT EXISTS idx_reseller_team_members_user
  ON public.reseller_team_members (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.reseller_team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY reseller_team_members_self_read
  ON public.reseller_team_members FOR SELECT
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY reseller_team_members_self_write
  ON public.reseller_team_members FOR ALL
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  )
  WITH CHECK (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY reseller_team_members_super_admin_all
  ON public.reseller_team_members FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- =====================================================================
-- 2. reseller_notification_prefs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.reseller_notification_prefs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id            uuid NOT NULL UNIQUE
                          REFERENCES public.resellers(id) ON DELETE CASCADE,
  new_client_onboarded   boolean NOT NULL DEFAULT true,
  client_low_minutes     boolean NOT NULL DEFAULT true,
  payout_processed       boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reseller_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY reseller_notification_prefs_self_read
  ON public.reseller_notification_prefs FOR SELECT
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY reseller_notification_prefs_self_write
  ON public.reseller_notification_prefs FOR ALL
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  )
  WITH CHECK (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY reseller_notification_prefs_super_admin_all
  ON public.reseller_notification_prefs FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- =====================================================================
-- 3. reseller_branding
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.reseller_branding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id           uuid NOT NULL UNIQUE
                         REFERENCES public.resellers(id) ON DELETE CASCADE,
  white_label_enabled   boolean NOT NULL DEFAULT false,
  accent_color          text NOT NULL DEFAULT '#16a34a'
                         CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  display_name          text,
  support_email         text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reseller_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY reseller_branding_self_read
  ON public.reseller_branding FOR SELECT
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY reseller_branding_self_write
  ON public.reseller_branding FOR ALL
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  )
  WITH CHECK (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY reseller_branding_super_admin_all
  ON public.reseller_branding FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- =====================================================================
-- updated_at triggers (single function reused across the three tables).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_reseller_team_members ON public.reseller_team_members;
CREATE TRIGGER trg_touch_reseller_team_members
  BEFORE UPDATE ON public.reseller_team_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_reseller_notification_prefs ON public.reseller_notification_prefs;
CREATE TRIGGER trg_touch_reseller_notification_prefs
  BEFORE UPDATE ON public.reseller_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_reseller_branding ON public.reseller_branding;
CREATE TRIGGER trg_touch_reseller_branding
  BEFORE UPDATE ON public.reseller_branding
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
