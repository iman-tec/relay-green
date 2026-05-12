-- ============================================================================
-- Phase 4: Customer projects (lightweight)
-- ============================================================================
-- Adds a per-customer `projects` namespace and links it from `guest_calls`
-- so the sidebar can group past sessions by project. Backwards compatible —
-- existing sessions get NULL project_id / project_name and render under
-- the "General" bucket in the UI.
-- ============================================================================

-- Projects table — one row per (customer, named bucket).
CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_customer ON public.projects(customer_id, created_at DESC);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers manage own projects" ON public.projects;
CREATE POLICY "Customers manage own projects" ON public.projects
  FOR ALL
  USING      (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

-- Hang project context off each session. project_name is denormalised so
-- the sidebar can render the group label without a join.
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_name text;

CREATE INDEX IF NOT EXISTS idx_guest_calls_project ON public.guest_calls(project_id);

-- create_project(name) → upserts (idempotent on (customer, name)) and returns
-- the row. SECURITY DEFINER because the RLS policy already gates on
-- customer_id, but we want the function callable from any signed-in role.
CREATE OR REPLACE FUNCTION public.create_project(_name text)
RETURNS public.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  result public.projects;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.projects (customer_id, name)
  VALUES (auth.uid(), btrim(_name))
  ON CONFLICT (customer_id, name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING * INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.create_project(text) TO authenticated;
