-- ============================================================================
-- Relay — Project completion/retention: corrected re-issue
-- ============================================================================
-- 20260526110000_project_completion_retention.sql targeted the WRONG table —
-- `public.chat_attachments` instead of `public.guest_message_attachments` —
-- so it could never apply against the live schema and the whole migration
-- (including the projects.completion_status column!) is missing in hosted
-- Supabase. The app has been falling back at runtime:
--   [refetchProjects] full SELECT failed, retrying without retention cols:
--   column projects.completion_status does not exist        (RoomClient:917)
-- Same wrong-table disease 20260602160000_guest_message_attachments_allow_audio
-- already documented for the audio-kind migration.
--
-- This re-issues the ENTIRE retention migration idempotently with the
-- correct table names. Safe to run even if parts somehow applied.
-- ============================================================================

BEGIN;

-- ── projects: completion lifecycle ────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS completion_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS completed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_completion_status_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_completion_status_check
  CHECK (completion_status IN ('active', 'completed', 'archived'));

CREATE INDEX IF NOT EXISTS idx_projects_retention_sweep
  ON public.projects (completed_at)
  WHERE completion_status = 'completed' AND completed_at IS NOT NULL;

-- ── guest_message_attachments: purge flag (was: chat_attachments ✗) ───────
ALTER TABLE public.guest_message_attachments
  ADD COLUMN IF NOT EXISTS purged    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_guest_message_attachments_unpurged
  ON public.guest_message_attachments (created_at)
  WHERE purged = false;

-- ── RPC: mark_project_complete ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_project_complete(_project_id uuid)
RETURNS public.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  result public.projects;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO result FROM public.projects
    WHERE id = _project_id AND customer_id = auth.uid()
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF result.completion_status <> 'active' THEN
    RETURN result;
  END IF;

  UPDATE public.projects
    SET completion_status = 'completed',
        completed_at      = now()
    WHERE id = _project_id
    RETURNING * INTO result;

  RETURN result;
END
$$;

GRANT EXECUTE ON FUNCTION public.mark_project_complete(uuid) TO authenticated;

-- ── RPC: mark_project_active ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_project_active(_project_id uuid)
RETURNS public.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  result public.projects;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO result FROM public.projects
    WHERE id = _project_id AND customer_id = auth.uid()
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF result.completion_status = 'archived' THEN
    RAISE EXCEPTION 'PROJECT_ARCHIVED' USING ERRCODE = 'P0001';
  END IF;

  IF result.completion_status = 'active' THEN
    RETURN result;
  END IF;

  UPDATE public.projects
    SET completion_status = 'active',
        completed_at      = NULL
    WHERE id = _project_id
    RETURNING * INTO result;

  RETURN result;
END
$$;

GRANT EXECUTE ON FUNCTION public.mark_project_active(uuid) TO authenticated;

-- ── Sweeper helper: list_projects_ready_for_purge ─────────────────────────
CREATE OR REPLACE FUNCTION public.list_projects_ready_for_purge()
RETURNS SETOF public.projects
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.projects
  WHERE completion_status = 'completed'
    AND completed_at IS NOT NULL
    AND completed_at < now() - interval '90 days'
  ORDER BY completed_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.list_projects_ready_for_purge() FROM PUBLIC, anon, authenticated;

-- ── Sweeper helper: archive_project (was: chat_attachments ✗) ─────────────
CREATE OR REPLACE FUNCTION public.archive_project(_project_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.guest_message_attachments ga
    SET purged = true,
        purged_at = now()
    FROM public.guest_messages gm
    INNER JOIN public.guest_calls gc ON gc.id = gm.guest_call_id
    WHERE ga.message_id = gm.id
      AND gc.project_id = _project_id
      AND ga.purged = false;

  UPDATE public.projects
    SET completion_status = 'archived',
        archived_at = now()
    WHERE id = _project_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.archive_project(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
