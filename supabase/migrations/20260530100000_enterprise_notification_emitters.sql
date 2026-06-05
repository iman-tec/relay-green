-- ============================================================================
-- Enterprise-admin notification emitters
-- ============================================================================
-- Wire the "sender" half of the three enterprise notification toggles
-- (enterprise_notification_prefs), fanning out to ALL enterprise admins of
-- the org. Each event is gated by its pref (defaults on when no row).
--
--   session_alerts → trigger on guest_calls (a member starts a session)
--   low_minutes    → trigger on organizations (remaining crosses < 10%)
--   weekly_digest  → enterprise_weekly_digest() RPC (call weekly via cron)
--
-- Triggers are AFTER + EXCEPTION-guarded so a notification can never roll
-- back the underlying operation.
-- ============================================================================

BEGIN;

-- Fan out a notification to every enterprise admin of an org.
CREATE OR REPLACE FUNCTION public.notify_enterprise_admins(
  _org uuid, _kind text, _title text, _body text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE _admin uuid;
BEGIN
  FOR _admin IN
    SELECT p.id FROM profiles p
     WHERE p.organization_id = _org
       AND EXISTS (
         SELECT 1 FROM user_role_names urn
         WHERE urn.user_id = p.id AND urn.role = 'enterprise_admin'
       )
  LOOP
    PERFORM public.create_notification(_admin, NULL, _kind, _title, _body);
  END LOOP;
END $fn$;

-- ── New session alerts ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_ent_session_started()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE _org uuid; _name text; _enabled boolean;
BEGIN
  IF NEW.customer_user_id IS NULL THEN RETURN NEW; END IF;
  BEGIN
    SELECT organization_id, COALESCE(NULLIF(btrim(full_name), ''), 'A team member')
      INTO _org, _name
      FROM profiles WHERE id = NEW.customer_user_id;
    IF _org IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(
      (SELECT session_alerts FROM enterprise_notification_prefs WHERE organization_id = _org),
      true
    ) INTO _enabled;
    IF _enabled THEN
      PERFORM public.notify_enterprise_admins(
        _org, 'ent_session_started', _name || ' started a session', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_ent_session_started ON public.guest_calls;
CREATE TRIGGER trg_ent_session_started
  AFTER INSERT ON public.guest_calls
  FOR EACH ROW EXECUTE FUNCTION public.trg_ent_session_started();

-- ── Low-minutes warning ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_ent_low_minutes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE _enabled boolean; _threshold numeric;
BEGIN
  IF NEW.allocated_minutes IS NULL OR NEW.allocated_minutes <= 0 THEN RETURN NEW; END IF;
  _threshold := NEW.allocated_minutes * 0.1;
  IF NOT (COALESCE(OLD.remaining_minutes, 0) > _threshold
          AND NEW.remaining_minutes <= _threshold) THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT COALESCE(
      (SELECT low_minutes FROM enterprise_notification_prefs WHERE organization_id = NEW.id),
      true
    ) INTO _enabled;
    IF _enabled THEN
      PERFORM public.notify_enterprise_admins(
        NEW.id, 'ent_low_minutes', 'Enterprise minutes running low',
        'Only ' || round(NEW.remaining_minutes)::text || ' of '
                || round(NEW.allocated_minutes)::text || ' minutes remain in the pool.');
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_ent_low_minutes ON public.organizations;
CREATE TRIGGER trg_ent_low_minutes
  AFTER UPDATE OF remaining_minutes ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.trg_ent_low_minutes();

-- ── Weekly usage digest (in-app) ────────────────────────────────────────────
-- Call this weekly (cron / edge function). It inserts a per-org digest
-- notification for the enterprise admins, gated by weekly_digest. Returns
-- the number of orgs notified. (Email delivery is out of scope here — no
-- Resend configured — so the digest lands in the in-app bell.)
CREATE OR REPLACE FUNCTION public.enterprise_weekly_digest()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  _org      record;
  _sessions int;
  _minutes  numeric;
  _count    int := 0;
BEGIN
  FOR _org IN
    SELECT o.id
      FROM organizations o
     WHERE COALESCE(
             (SELECT weekly_digest FROM enterprise_notification_prefs WHERE organization_id = o.id),
             true) = true
       AND EXISTS (
         SELECT 1 FROM profiles p
         JOIN user_role_names urn ON urn.user_id = p.id AND urn.role = 'enterprise_admin'
         WHERE p.organization_id = o.id)
  LOOP
    SELECT count(*)::int, COALESCE(sum(gc.duration_minutes), 0)
      INTO _sessions, _minutes
      FROM guest_calls gc
      JOIN profiles p ON p.id = gc.customer_user_id AND p.organization_id = _org.id
     WHERE gc.status = 'ended' AND gc.created_at >= now() - interval '7 days';

    PERFORM public.notify_enterprise_admins(
      _org.id, 'ent_weekly_digest', 'Weekly usage digest',
      _sessions::text || ' sessions · ' || round(_minutes)::text
        || ' minutes used in the last 7 days.');
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END $fn$;

GRANT EXECUTE ON FUNCTION public.enterprise_weekly_digest() TO service_role;

COMMIT;
