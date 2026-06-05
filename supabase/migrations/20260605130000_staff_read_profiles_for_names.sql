-- ============================================================================
-- Resolve a customer's display name for staff, reliably.
-- ============================================================================
-- Customer names live in two places:
--   - customer_profiles.display_name (set when a customer edits their profile)
--   - profiles.full_name             (set at sign-up / onboarding)
-- Booking surfaces resolved names client-side from customer_profiles only, so a
-- customer who never set a display_name showed as "Customer" on the engineer's
-- dashboard — even though the SAME booking's notification (built server-side via
-- the SECURITY DEFINER booking_party_names) shows the real name. The mismatch is
-- because a direct client read is subject to RLS, whereas the notification path
-- isn't.
--
-- Fix: expose a SECURITY DEFINER helper the client can call to get the name the
-- same way the notification does — independent of the caller's RLS. Also bring
-- booking_party_names in line by falling back to profiles.full_name.
-- ============================================================================

BEGIN;

-- name = customer_profiles.display_name, else profiles.full_name, else NULL.
CREATE OR REPLACE FUNCTION public.customer_display_name(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT display_name FROM customer_profiles WHERE user_id = _user_id),
    (SELECT full_name    FROM profiles          WHERE id      = _user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.customer_display_name(uuid) TO authenticated;

-- Keep the booking notification/toast names consistent with the dashboard.
CREATE OR REPLACE FUNCTION public.booking_party_names(_booking public.engineer_bookings)
RETURNS TABLE(customer_name text, engineer_name text, project_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(public.customer_display_name(_booking.customer_user_id), 'A customer'),
    COALESCE((SELECT display_alias FROM engineer_profiles WHERE user_id = _booking.engineer_user_id), 'your engineer'),
    COALESCE((SELECT name FROM projects WHERE id = _booking.project_id), 'a project');
$$;

COMMIT;
