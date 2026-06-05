-- ============================================================================
-- Notify every engineer when a customer creates a bid (quote) request.
-- ============================================================================
-- Mirrors notify_engineer_on_booking (20260602220000) but for the bid queue:
-- project_quote_requests is a GLOBAL queue — any engineer can pick up a pending
-- request — so a new 'pending' row fans a `bid_request` notification out to
-- EVERY engineer (one row per engineer in public.notifications). The dashboard
-- bell reads these via /api/engineer/notifications (kind added to its
-- allowlist) and they persist there until the engineer clears them — separate
-- from the transient/sticky top-of-screen toast (EngineerAlerts), whose × only
-- dismisses the popup.
--
-- The notifications table is already in the supabase_realtime publication, so
-- the bell's existing subscription auto-refreshes on insert.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_engineers_on_bid_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _customer text;
  _project  text;
  _body     text;
BEGIN
  -- Only a brand-new, unanswered request is a "bid request" for the engineers.
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    -- Name = customer_profiles.display_name, else profiles.full_name. NOTE:
    -- customer_profiles has NO email column — referencing one here aborts the
    -- INSERT (and thus create_project_quote_request) for the customer.
    _customer := COALESCE(
      (SELECT display_name FROM customer_profiles WHERE user_id = NEW.customer_user_id),
      (SELECT full_name    FROM profiles          WHERE id      = NEW.customer_user_id),
      'A customer');

    SELECT p.name INTO _project
      FROM public.projects p
     WHERE p.id = NEW.project_id;

    _body := _customer || COALESCE(' · ' || _project, '');

    -- Fan out: one notification per engineer (the global bid queue).
    INSERT INTO public.notifications (user_id, request_id, kind, title, body)
    SELECT urn.user_id, NEW.id, 'bid_request', 'New bid request', _body
      FROM public.user_role_names urn
     WHERE urn.role = 'engineer';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_engineers_on_bid_request
  ON public.project_quote_requests;

CREATE TRIGGER trg_notify_engineers_on_bid_request
  AFTER INSERT ON public.project_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_engineers_on_bid_request();

COMMIT;
