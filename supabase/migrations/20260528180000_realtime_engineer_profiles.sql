-- ============================================================================
-- Add engineer_profiles + engineer_presence to supabase_realtime publication
-- ============================================================================
-- The presence ball (app/_components/EngineerPresenceBall.tsx) and supervisor
-- views subscribe to engineer_profiles UPDATE events via postgres_changes.
-- That subscription is silently a no-op unless the table is in the
-- supabase_realtime publication — and a query of pg_publication_tables on
-- 2026-05-28 revealed that engineer_profiles wasn't in ANY publication.
--
-- Net effect: the server-side reaper (reap_idle_engineers) was correctly
-- flipping engineers to offline, but the client UI never learned about it
-- — the row was updated in the DB but no realtime event reached the browser.
-- Users would only see the flip after a page refresh (which re-runs the
-- initial fetch in EngineerPresenceBall).
--
-- This migration adds both tables to the publication so the flip is
-- delivered to all subscribed clients (engineer dashboard, supervisor view,
-- super admin views).
--
-- engineer_presence is added as well so future code can subscribe to it
-- (e.g. for a supervisor "who's heartbeating right now" board) without
-- another publication migration.
-- ============================================================================

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.engineer_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.engineer_presence;

COMMIT;
