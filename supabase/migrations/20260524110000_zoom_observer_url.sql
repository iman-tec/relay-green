-- ============================================================================
-- Zoom observer URL — lets a supervisor join the live call (anonymously)
-- ============================================================================
-- mint-zoom-for-session registers the engineer (under their alias) and the
-- customer as Zoom meeting registrants, each getting a personalised join URL.
-- Supervisors had no way into the call — the read-only session view only
-- exposed the customer's join URL. We add a dedicated third registrant
-- ("Relay Supervisor", anonymous — no real identity) and store its join URL
-- here so any covering supervisor can drop into the call as an observer.
-- ============================================================================

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS zoom_observer_url text;
