-- Pods: staff hierarchy management
--
-- Existing tables (created earlier, unused) — `pods` + `pod_members` — get
-- formalized here for the supervisor / engineer hierarchy.
--
-- Constraints decided with the user:
--   • One user is in AT MOST one pod (covers "one engineer, one pod" and
--     "one supervisor, one pod" with the same rule).
--   • pod_role is exactly 'supervisor' or 'engineer'.
--   • Pods soft-delete via archived_at (preserves history of past
--     assignments even after a team reorg).
--
-- RLS posture:
--   • super_admin: full read/write on both tables.
--   • Pod members: can read their own pod row and other members of the
--     same pod (so a supervisor can see who's on their team without an
--     admin RPC, and an engineer can see their teammates).
--   • Everyone else: no access.
--   • Admin API routes use service_role to bypass RLS for writes.

BEGIN;

-- ── 1. Soft-delete on pods ─────────────────────────────────────────────────
ALTER TABLE public.pods
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- ── 2. pod_role check constraint ───────────────────────────────────────────
ALTER TABLE public.pod_members
  DROP CONSTRAINT IF EXISTS pod_members_pod_role_check;
ALTER TABLE public.pod_members
  ADD CONSTRAINT pod_members_pod_role_check
  CHECK (pod_role IN ('supervisor', 'engineer'));

-- ── 3. One user per pod ────────────────────────────────────────────────────
-- A user can only belong to one pod, regardless of role. Trying to add
-- them to a second pod throws a unique violation; the API surfaces it
-- with a friendly "this user is already in <other pod>" message.
ALTER TABLE public.pod_members
  DROP CONSTRAINT IF EXISTS pod_members_user_unique;
ALTER TABLE public.pod_members
  ADD CONSTRAINT pod_members_user_unique UNIQUE (user_id);

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.pods         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pod_members  ENABLE ROW LEVEL SECURITY;

-- pods: super_admin full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pods' AND policyname='pods_super_admin_all'
  ) THEN
    EXECUTE 'CREATE POLICY pods_super_admin_all ON public.pods
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), ''super_admin''))
      WITH CHECK (public.has_role(auth.uid(), ''super_admin''))';
  END IF;
END $$;

-- pods: pod members read their own pod row
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pods' AND policyname='pods_member_read'
  ) THEN
    EXECUTE 'CREATE POLICY pods_member_read ON public.pods
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.pod_members pm
        WHERE pm.pod_id = pods.id AND pm.user_id = auth.uid()
      ))';
  END IF;
END $$;

-- pod_members: super_admin full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pod_members' AND policyname='pod_members_super_admin_all'
  ) THEN
    EXECUTE 'CREATE POLICY pod_members_super_admin_all ON public.pod_members
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), ''super_admin''))
      WITH CHECK (public.has_role(auth.uid(), ''super_admin''))';
  END IF;
END $$;

-- pod_members: a user can read all members of THEIR pod (so supervisors
-- see their engineers, engineers see their teammates and supervisor).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pod_members' AND policyname='pod_members_same_pod_read'
  ) THEN
    EXECUTE 'CREATE POLICY pod_members_same_pod_read ON public.pod_members
      FOR SELECT TO authenticated
      USING (pod_id IN (
        SELECT pod_id FROM public.pod_members WHERE user_id = auth.uid()
      ))';
  END IF;
END $$;

-- ── 5. Indexes for the common queries ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pod_members_pod_id  ON public.pod_members (pod_id);
CREATE INDEX IF NOT EXISTS idx_pod_members_user_id ON public.pod_members (user_id);
CREATE INDEX IF NOT EXISTS idx_pods_archived       ON public.pods (archived_at) WHERE archived_at IS NULL;

COMMIT;
