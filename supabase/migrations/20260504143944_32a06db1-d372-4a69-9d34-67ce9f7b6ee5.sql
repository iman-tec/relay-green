
-- guest_calls: one row per visitor "Let's Relay" session
CREATE TABLE public.guest_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name text NOT NULL,
  guest_email text,
  status text NOT NULL DEFAULT 'waiting', -- waiting | live | ended
  zoom_meeting_id text,
  zoom_join_url text,
  zoom_start_url text,
  claimed_by uuid, -- engineer user id
  claimed_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  free_minutes integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.guest_calls ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can read a guest_call by its id (id is the unguessable token)
CREATE POLICY "Public read guest_calls"
ON public.guest_calls FOR SELECT
TO anon, authenticated
USING (true);

-- Staff (engineer/pod_lead/ops_manager/admin) can update (claim, end)
CREATE POLICY "Staff update guest_calls"
ON public.guest_calls FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'engineer')
  OR has_role(auth.uid(), 'pod_lead')
  OR has_role(auth.uid(), 'ops_manager')
  OR has_role(auth.uid(), 'admin')
);

-- Inserts only via service role (edge functions). No INSERT policy.

CREATE TRIGGER guest_calls_updated_at
BEFORE UPDATE ON public.guest_calls
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- guest_messages: chat thread for a guest_call
CREATE TABLE public.guest_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_call_id uuid NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  sender_kind text NOT NULL DEFAULT 'guest', -- guest | engineer | system
  sender_id uuid, -- null for guest (no auth)
  sender_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.guest_messages ENABLE ROW LEVEL SECURITY;

-- Anyone can read / insert messages for any guest_call (id is the secret).
-- Tightening to a session-token can come later.
CREATE POLICY "Public read guest_messages"
ON public.guest_messages FOR SELECT
TO anon, authenticated USING (true);

CREATE POLICY "Public insert guest_messages"
ON public.guest_messages FOR INSERT
TO anon, authenticated WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_messages;
