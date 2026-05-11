-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  primary_role text,
  ai_tool_preference text,
  tech_stack text,
  is_onboarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- user_roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('builder','engineer','pod_lead','ops_manager','admin')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_user_roles_user_role ON public.user_roles(user_id, role);

-- has_role security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- requests
CREATE TABLE public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_engineer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  leg text NOT NULL CHECK (leg IN ('get_unstuck','get_it_live','keep_it_growing')),
  ai_tool text NOT NULL CHECK (ai_tool IN ('lovable','cursor','claude','chatgpt','replit','bolt','v0','other')),
  title text NOT NULL,
  description text NOT NULL,
  urgency text NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','assigned','in_progress','awaiting_builder','resolved','closed')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_requests_builder ON public.requests(builder_id);
CREATE INDEX idx_requests_engineer ON public.requests(assigned_engineer_id);
CREATE INDEX idx_requests_status ON public.requests(status);
CREATE INDEX idx_requests_last_message ON public.requests(last_message_at DESC);

-- request_messages
CREATE TABLE public.request_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  body text NOT NULL,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.request_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_request_messages_request_created ON public.request_messages(request_id, created_at);

-- helper: can_view_request
CREATE OR REPLACE FUNCTION public.can_view_request(_request_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.requests r
    WHERE r.id = _request_id
    AND (
      r.builder_id = _user_id
      OR r.assigned_engineer_id = _user_id
      OR public.has_role(_user_id, 'pod_lead')
      OR public.has_role(_user_id, 'ops_manager')
      OR public.has_role(_user_id, 'admin')
    )
  )
$$;

-- RLS: profiles
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'pod_lead') OR public.has_role(auth.uid(),'ops_manager') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- RLS: user_roles
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'ops_manager') OR public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Users insert own role during onboarding" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- RLS: requests
CREATE POLICY "View requests" ON public.requests
  FOR SELECT TO authenticated
  USING (
    builder_id = auth.uid()
    OR assigned_engineer_id = auth.uid()
    OR public.has_role(auth.uid(),'ops_manager')
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'pod_lead')
  );
CREATE POLICY "Builders create own requests" ON public.requests
  FOR INSERT TO authenticated WITH CHECK (builder_id = auth.uid());
CREATE POLICY "Update own or assigned requests" ON public.requests
  FOR UPDATE TO authenticated
  USING (
    builder_id = auth.uid()
    OR assigned_engineer_id = auth.uid()
    OR public.has_role(auth.uid(),'pod_lead')
    OR public.has_role(auth.uid(),'ops_manager')
    OR public.has_role(auth.uid(),'admin')
  );

-- RLS: request_messages
CREATE POLICY "View messages on visible requests" ON public.request_messages
  FOR SELECT TO authenticated
  USING (public.can_view_request(request_id, auth.uid()));
CREATE POLICY "Send messages on visible requests" ON public.request_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.can_view_request(request_id, auth.uid()));

-- trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- trigger to bump last_message_at on new message
CREATE OR REPLACE FUNCTION public.bump_request_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.requests SET last_message_at = NEW.created_at WHERE id = NEW.request_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_last_message
  AFTER INSERT ON public.request_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_request_last_message();