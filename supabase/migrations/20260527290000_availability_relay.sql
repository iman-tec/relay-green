-- ============================================================================
-- Availability / leave relay — supervisor flags up to super-admin
-- ============================================================================
-- The supervisor MONITORS availability; the super-admin OWNS leave + roster
-- administration. So a supervisor doesn't mutate an engineer's leave directly
-- — they raise a request that routes up for approval/action. This is the relay
-- path: raise (supervisor) → resolve (super-admin).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.availability_change_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engineer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pod_id            uuid REFERENCES public.pods(id) ON DELETE SET NULL,
  kind              text NOT NULL DEFAULT 'availability'
                    CHECK (kind IN ('leave', 'availability', 'other')),
  detail            text,
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'approved', 'rejected', 'actioned')),
  resolution_note   text,
  resolved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_acr_open ON public.availability_change_requests (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_acr_engineer ON public.availability_change_requests (engineer_user_id, created_at DESC);

ALTER TABLE public.availability_change_requests ENABLE ROW LEVEL SECURITY;

-- Supervisor reads what they raised; super-admin/admin read everything.
DROP POLICY IF EXISTS "Raiser reads own" ON public.availability_change_requests;
CREATE POLICY "Raiser reads own" ON public.availability_change_requests
  FOR SELECT TO authenticated USING (raised_by = auth.uid());

DROP POLICY IF EXISTS "Admins read all availability requests" ON public.availability_change_requests;
CREATE POLICY "Admins read all availability requests" ON public.availability_change_requests
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- Writes via RPCs only.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'availability_change_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_change_requests;
  END IF;
END $$;

-- ── RPC: raise_availability_request (supervisor) ────────────────────────────
CREATE OR REPLACE FUNCTION public.raise_availability_request(
  _engineer_user_id uuid, _kind text, _detail text
)
RETURNS public.availability_change_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _pod    uuid;
  result  public.availability_change_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;
  IF _kind NOT IN ('leave', 'availability', 'other') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE='P0001';
  END IF;

  SELECT pod_id INTO _pod FROM pod_members WHERE user_id = _engineer_user_id AND pod_role = 'engineer' LIMIT 1;

  INSERT INTO availability_change_requests (raised_by, engineer_user_id, pod_id, kind, detail)
  VALUES (_me, _engineer_user_id, _pod, _kind, NULLIF(btrim(_detail), ''))
  RETURNING * INTO result;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.raise_availability_request(uuid, text, text) TO authenticated;

-- ── RPC: resolve_availability_request (super-admin) ─────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_availability_request(
  _id uuid, _status text, _note text
)
RETURNS public.availability_change_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.availability_change_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF NOT (has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AN_ADMIN' USING ERRCODE='P0001';
  END IF;
  IF _status NOT IN ('approved', 'rejected', 'actioned') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE='P0001';
  END IF;

  UPDATE availability_change_requests
     SET status = _status, resolution_note = NULLIF(btrim(_note), ''),
         resolved_by = _me, resolved_at = now()
   WHERE id = _id AND status = 'open'
   RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_OPEN' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_availability_request(uuid, text, text) TO authenticated;

COMMIT;
