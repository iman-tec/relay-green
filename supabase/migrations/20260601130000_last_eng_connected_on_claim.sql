-- ============================================================================
-- last_eng_connected — stamp on engineer assignment, not just a live transition
-- ============================================================================
-- The original trigger only fired on guest_calls.status -> 'live'. Real sessions
-- frequently get claimed by an engineer but never record a clean 'live' /
-- joined_at (directed connects, short calls, reassignments), so the project's
-- last_eng_connected stayed NULL — which (a) let the bid-visibility fallback
-- show the bid to ALL staff and (b) made supervisor_for_quote resolve to nobody.
--
-- New rule: a project's last connected engineer is the claimed_by of its most
-- recent NON-cancelled session. The trigger RECOMPUTES this (rather than blindly
-- taking NEW.claimed_by) so a late status change on an older call can never
-- overwrite a newer engineer with a stale one. Plus a one-time backfill.
--
-- Additive / idempotent: replaces a function + trigger, backfills a column.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_last_eng_connected()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects p
       SET last_eng_connected = (
         SELECT g.claimed_by
           FROM public.guest_calls g
          WHERE g.project_id = NEW.project_id
            AND g.claimed_by IS NOT NULL
            AND g.status <> 'cancelled'
          ORDER BY g.created_at DESC
          LIMIT 1
       )
     WHERE p.id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

-- Fire when an engineer is assigned (claimed_by) or the session status changes,
-- on any call tied to a project. The function recomputes from scratch, so the
-- firing condition just needs to be broad enough to catch assignments.
DROP TRIGGER IF EXISTS trg_stamp_last_eng_connected ON public.guest_calls;
CREATE TRIGGER trg_stamp_last_eng_connected
  AFTER INSERT OR UPDATE OF claimed_by, status ON public.guest_calls
  FOR EACH ROW
  WHEN (NEW.project_id IS NOT NULL)
  EXECUTE FUNCTION public.stamp_last_eng_connected();

-- Backfill: each project's most recent non-cancelled claimed engineer.
UPDATE public.projects p
   SET last_eng_connected = sub.claimed_by
  FROM (
    SELECT DISTINCT ON (project_id) project_id, claimed_by
      FROM public.guest_calls
     WHERE project_id IS NOT NULL
       AND claimed_by IS NOT NULL
       AND status <> 'cancelled'
     ORDER BY project_id, created_at DESC
  ) sub
 WHERE p.id = sub.project_id
   AND p.last_eng_connected IS DISTINCT FROM sub.claimed_by;

COMMIT;
