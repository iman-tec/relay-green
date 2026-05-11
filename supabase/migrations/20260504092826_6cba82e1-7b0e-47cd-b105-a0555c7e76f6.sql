-- ============ PODS ============
CREATE TABLE public.pods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pods ENABLE ROW LEVEL SECURITY;

-- ============ POD MEMBERS ============
CREATE TABLE public.pod_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pod_id uuid NOT NULL REFERENCES public.pods(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  pod_role text NOT NULL DEFAULT 'builder', -- builder | engineer | pod_lead
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pod_id, user_id)
);

ALTER TABLE public.pod_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_pod_members_user ON public.pod_members(user_id);
CREATE INDEX idx_pod_members_pod ON public.pod_members(pod_id);

-- ============ POD INVITATIONS ============
CREATE TABLE public.pod_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pod_id uuid NOT NULL REFERENCES public.pods(id) ON DELETE CASCADE,
  email text NOT NULL,
  pod_role text NOT NULL DEFAULT 'builder',
  app_role text, -- optional: app-level role to grant on accept (e.g., 'engineer')
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invited_by uuid,
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | revoked
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_by uuid
);

ALTER TABLE public.pod_invitations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_pod_invitations_email ON public.pod_invitations(lower(email));
CREATE INDEX idx_pod_invitations_pod ON public.pod_invitations(pod_id);

-- ============ REQUESTS.POD_ID ============
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS pod_id uuid REFERENCES public.pods(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_pod ON public.requests(pod_id);

-- ============ HELPER: is_pod_member / is_pod_lead ============
CREATE OR REPLACE FUNCTION public.is_pod_member(_pod_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pod_members
    WHERE pod_id = _pod_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_pod_lead(_pod_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pod_members
    WHERE pod_id = _pod_id AND user_id = _user_id AND pod_role = 'pod_lead'
  )
$$;

-- ============ RLS: pods ============
CREATE POLICY "View pods (members + staff)"
  ON public.pods FOR SELECT TO authenticated
  USING (
    public.is_pod_member(id, auth.uid())
    OR public.has_role(auth.uid(), 'pod_lead')
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Manage pods (admin/ops)"
  ON public.pods FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  );

-- ============ RLS: pod_members ============
CREATE POLICY "View pod members"
  ON public.pod_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_pod_member(pod_id, auth.uid())
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'pod_lead')
  );

CREATE POLICY "Manage pod members (lead/ops/admin)"
  ON public.pod_members FOR ALL TO authenticated
  USING (
    public.is_pod_lead(pod_id, auth.uid())
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.is_pod_lead(pod_id, auth.uid())
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  );

-- ============ RLS: pod_invitations ============
CREATE POLICY "View pod invitations"
  ON public.pod_invitations FOR SELECT TO authenticated
  USING (
    public.is_pod_lead(pod_id, auth.uid())
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Create pod invitations"
  ON public.pod_invitations FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND (
      public.is_pod_lead(pod_id, auth.uid())
      OR public.has_role(auth.uid(), 'ops_manager')
      OR public.has_role(auth.uid(), 'admin')
    )
  );

CREATE POLICY "Revoke pod invitations"
  ON public.pod_invitations FOR UPDATE TO authenticated
  USING (
    public.is_pod_lead(pod_id, auth.uid())
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  );

-- ============ AUTO-REDEEM INVITATIONS ON SIGNUP ============
-- Replace handle_new_user to also redeem any pending invitations matching the email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  -- Create the profile (existing behavior)
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)));

  -- Redeem any pending invitations for this email
  FOR inv IN
    SELECT * FROM public.pod_invitations
    WHERE lower(email) = lower(NEW.email) AND status = 'pending'
  LOOP
    -- Add to pod
    INSERT INTO public.pod_members (pod_id, user_id, pod_role)
    VALUES (inv.pod_id, NEW.id, inv.pod_role)
    ON CONFLICT (pod_id, user_id) DO NOTHING;

    -- Optionally grant an app role
    IF inv.app_role IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, inv.app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    -- Mark accepted
    UPDATE public.pod_invitations
    SET status = 'accepted', accepted_at = now(), accepted_by = NEW.id
    WHERE id = inv.id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Ensure the trigger exists on auth.users (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ updated_at trigger for pods ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER pods_set_updated_at
  BEFORE UPDATE ON public.pods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
