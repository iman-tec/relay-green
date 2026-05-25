-- ============================================================================
-- Relay — Projects: completion status + 90-day retention
-- ============================================================================
-- The customer can mark a project as "moved to live/production." That
-- starts a 90-day retention clock on the session artifacts attached to
-- it (chat attachments, AI summaries, transcripts). After 90 days the
-- nightly sweeper:
--   1. Deletes the Storage objects for every chat_attachments row that
--      belongs to a session in the completed project.
--   2. Marks each chat_attachments row purged=true (we keep the row so
--      the UI can render a "removed after retention" placeholder rather
--      than a broken card).
--   3. Flips the project to completion_status='archived' so the sweeper
--      skips it on subsequent runs.
--
-- "Active" projects keep their files indefinitely.
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

-- Sweeper needs to find candidates by retention clock; index supports that
-- scan cheaply even with a large project corpus.
CREATE INDEX IF NOT EXISTS idx_projects_retention_sweep
  ON public.projects (completed_at)
  WHERE completion_status = 'completed' AND completed_at IS NOT NULL;

-- ── chat_attachments: purge flag ──────────────────────────────────────────
-- We keep the row after deleting the Storage object so the chat history
-- still renders coherently — the UI shows a "Removed after 90-day
-- retention" placeholder for purged rows instead of a broken thumbnail.
ALTER TABLE public.chat_attachments
  ADD COLUMN IF NOT EXISTS purged    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_chat_attachments_unpurged
  ON public.chat_attachments (created_at)
  WHERE purged = false;

-- ── RPC: mark_project_complete ────────────────────────────────────────────
-- Customer-facing affordance to flip a project to 'completed'. Sets the
-- retention clock. Idempotent: re-calling on an already-completed project
-- is a no-op (preserves the original completed_at).
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

  -- Already past 'active' — no-op so customers can hit the button twice
  -- without resetting the retention clock.
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
-- Escape hatch in case the customer marks completion by mistake. Only
-- works while the project is still 'completed' (not yet archived) — once
-- the sweeper has purged the files, there's nothing to bring back.
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
-- Returns projects whose 90-day retention clock has elapsed. Service role
-- only — the sweeper edge function reads this list, deletes Storage
-- objects, then flips status to 'archived'.
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

-- ── Sweeper helper: archive_project ──────────────────────────────────────
-- Called by the sweeper after it deletes the Storage objects. Marks every
-- chat_attachment row attached to a session in the project as purged, and
-- flips the project itself to 'archived'. Service-role only.
CREATE OR REPLACE FUNCTION public.archive_project(_project_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.chat_attachments ca
    SET purged = true,
        purged_at = now()
    FROM public.guest_messages gm
    INNER JOIN public.guest_calls gc ON gc.id = gm.guest_call_id
    WHERE ca.message_id = gm.id
      AND gc.project_id = _project_id
      AND ca.purged = false;

  UPDATE public.projects
    SET completion_status = 'archived',
        archived_at = now()
    WHERE id = _project_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.archive_project(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
