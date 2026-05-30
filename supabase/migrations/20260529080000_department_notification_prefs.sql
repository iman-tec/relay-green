-- ============================================================================
-- Department-admin notification preferences
-- ============================================================================
-- Backs the three toggles on the Department Settings tab:
--   new_session_alerts  — a team member starts a session
--   low_minutes_warning — the department pool runs low
--   new_member_joined   — someone is added to the department
--
-- One row per department (UNIQUE on department_id). The API lazy-defaults to
-- all-on when no row exists. Mirrors enterprise_notification_prefs.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.department_notification_prefs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id        uuid NOT NULL UNIQUE
                        REFERENCES public.departments(id) ON DELETE CASCADE,
  new_session_alerts   boolean NOT NULL DEFAULT true,
  low_minutes_warning  boolean NOT NULL DEFAULT true,
  new_member_joined    boolean NOT NULL DEFAULT true,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.department_notification_prefs ENABLE ROW LEVEL SECURITY;

-- The department's own admin (their profile.department_id matches the row).
CREATE POLICY department_notification_prefs_self_read
  ON public.department_notification_prefs FOR SELECT
  TO authenticated
  USING (
    department_id IN (
      SELECT p.department_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.department_id IS NOT NULL
    )
  );

CREATE POLICY department_notification_prefs_self_write
  ON public.department_notification_prefs FOR ALL
  TO authenticated
  USING (
    department_id IN (
      SELECT p.department_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.department_id IS NOT NULL
    )
  )
  WITH CHECK (
    department_id IN (
      SELECT p.department_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.department_id IS NOT NULL
    )
  );

CREATE POLICY department_notification_prefs_super_admin_all
  ON public.department_notification_prefs FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS trg_touch_department_notification_prefs ON public.department_notification_prefs;
CREATE TRIGGER trg_touch_department_notification_prefs
  BEFORE UPDATE ON public.department_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
