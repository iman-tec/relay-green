-- ============================================================================
-- Department notification emitters
-- ============================================================================
-- Fire in-app notifications to a department's admin (departments.admin_user_id)
-- for the three Department-Settings toggles, each gated by
-- department_notification_prefs (defaults on when no row):
--
--   new_member_joined    → trigger on profiles  (department_id set)
--   new_session_alerts   → trigger on guest_calls (session created)
--   low_minutes_warning  → trigger on departments (remaining crosses < 10%)
--
-- Triggers are AFTER and their bodies are wrapped in EXCEPTION guards: a
-- notification failure must NEVER roll back the underlying operation
-- (member provisioning / session creation / minute update).
-- ============================================================================

BEGIN;

-- ── New member joined ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_dept_member_joined()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  _dept    uuid := NEW.department_id;
  _admin   uuid;
  _enabled boolean;
  _name    text;
BEGIN
  IF _dept IS NULL THEN RETURN NEW; END IF;
  -- Only on a transition INTO a department (insert with dept, or dept changed).
  IF TG_OP = 'UPDATE' AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT admin_user_id INTO _admin FROM departments WHERE id = _dept;
    -- No admin yet (e.g. the admin themselves is being attached) → skip.
    IF _admin IS NULL OR _admin = NEW.id THEN RETURN NEW; END IF;
    SELECT COALESCE(
      (SELECT new_member_joined FROM department_notification_prefs WHERE department_id = _dept),
      true
    ) INTO _enabled;
    IF _enabled THEN
      _name := COALESCE(NULLIF(btrim(NEW.full_name), ''), 'A new member');
      PERFORM public.create_notification(
        _admin, NULL, 'dept_member_joined',
        _name || ' joined the department', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- never break member provisioning
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_dept_member_joined ON public.profiles;
CREATE TRIGGER trg_dept_member_joined
  AFTER INSERT OR UPDATE OF department_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_dept_member_joined();

-- ── New session started ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_dept_session_started()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  _dept    uuid;
  _admin   uuid;
  _enabled boolean;
  _name    text;
BEGIN
  IF NEW.customer_user_id IS NULL THEN RETURN NEW; END IF;
  BEGIN
    SELECT department_id, COALESCE(NULLIF(btrim(full_name), ''), 'A team member')
      INTO _dept, _name
      FROM profiles WHERE id = NEW.customer_user_id;
    IF _dept IS NULL THEN RETURN NEW; END IF;
    SELECT admin_user_id INTO _admin FROM departments WHERE id = _dept;
    IF _admin IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(
      (SELECT new_session_alerts FROM department_notification_prefs WHERE department_id = _dept),
      true
    ) INTO _enabled;
    IF _enabled THEN
      PERFORM public.create_notification(
        _admin, NULL, 'dept_session_started',
        _name || ' started a session', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- never break session creation
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_dept_session_started ON public.guest_calls;
CREATE TRIGGER trg_dept_session_started
  AFTER INSERT ON public.guest_calls
  FOR EACH ROW EXECUTE FUNCTION public.trg_dept_session_started();

-- ── Low-minutes warning ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_dept_low_minutes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  _admin     uuid;
  _enabled   boolean;
  _threshold numeric;
BEGIN
  IF NEW.allocated_minutes IS NULL OR NEW.allocated_minutes <= 0 THEN RETURN NEW; END IF;
  _threshold := NEW.allocated_minutes * 0.1;   -- 10% of the pool
  -- Fire once, only when crossing from above the threshold to at/below it.
  IF NOT (COALESCE(OLD.remaining_minutes, 0) > _threshold
          AND NEW.remaining_minutes <= _threshold) THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT admin_user_id INTO _admin FROM departments WHERE id = NEW.id;
    IF _admin IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(
      (SELECT low_minutes_warning FROM department_notification_prefs WHERE department_id = NEW.id),
      true
    ) INTO _enabled;
    IF _enabled THEN
      PERFORM public.create_notification(
        _admin, NULL, 'dept_low_minutes',
        'Department minutes running low',
        'Only ' || round(NEW.remaining_minutes)::text || ' of '
                || round(NEW.allocated_minutes)::text || ' minutes remain in the pool.');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- never break a minute update
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_dept_low_minutes ON public.departments;
CREATE TRIGGER trg_dept_low_minutes
  AFTER UPDATE OF remaining_minutes ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.trg_dept_low_minutes();

COMMIT;
