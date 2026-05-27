-- ============================================================================
-- User devices — 3-device-per-user sign-in cap with auto-rotation
-- ============================================================================
-- Each browser+user pair = one "device". When the user signs in on a 4th
-- device, the LEAST-recently-active of their 3 existing devices is
-- automatically signed out (no friction at sign-in, but the kicked device's
-- next request will 401 and bounce them back to /staff/login).
--
-- Linkage:
--   • Client generates a stable fingerprint UUID at first visit and persists
--     it in localStorage. This is what makes "Chrome on this laptop" a
--     stable identity even across sign-out/sign-in cycles.
--   • Each user_devices row stores auth_session_id read from auth.jwt() so
--     we can revoke the precise Supabase session (which also kills the
--     refresh-token, so the device can't silently re-auth).
--
-- Why a custom table vs. just reading auth.sessions:
--   • auth.sessions doesn't have a device concept — every refresh creates a
--     new session row, so the same browser looks like many sessions over
--     time. We need a stable per-browser identity for the limit to make
--     sense to users.
--   • Last-seen tracking lets us pick the oldest "device" not the oldest
--     "session" when rotating.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_devices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Client-generated UUID persisted in localStorage. Same value across
  -- sign-out/sign-in cycles on the same browser, so "this device" is
  -- stable over time.
  device_fingerprint  text NOT NULL,
  -- Snapshot of the auth.sessions.id from the JWT when the device last
  -- registered. Used to revoke the session when the device is kicked.
  -- May be NULL for legacy rows or if the JWT didn't carry session_id.
  auth_session_id     uuid,
  -- Pretty label we derive client-side (e.g. "Chrome on macOS"). Stored
  -- so the UI doesn't have to re-parse the UA on every render.
  device_label        text,
  -- Raw UA — kept for forensic purposes and for the UI to detail if the
  -- engineer wants to inspect a specific row.
  user_agent          text,
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_last_seen
  ON public.user_devices (user_id, last_seen_at DESC);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User reads own devices" ON public.user_devices;
CREATE POLICY "User reads own devices" ON public.user_devices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "User writes own devices" ON public.user_devices;
CREATE POLICY "User writes own devices" ON public.user_devices
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- The hard cap. If you ever want to change this, update the constant in
-- register_my_device — it's referenced directly in the function body.
-- ── RPC: register_my_device ──────────────────────────────────────────────
-- Called from the client on staff-shell mount. Upserts the row for the
-- current (user, fingerprint) pair, refreshes last_seen_at, and returns
-- a JSONB with:
--   • device_id:       the upserted device's id
--   • over_limit:      boolean — did this push the user over the 3-device cap?
--   • to_revoke:       array of user_devices.id rows the client should
--                      call revoke_my_device on (oldest-first, just the
--                      overflow — usually 0 or 1 ids)
--
-- The function itself doesn't revoke — it just identifies the victims.
-- The client makes the explicit revoke call so the revocation is visible
-- in the action log (and so a flaky client doesn't keep silently
-- evicting devices on every load).
CREATE OR REPLACE FUNCTION public.register_my_device(
  _fingerprint  text,
  _device_label text,
  _user_agent   text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me            uuid := auth.uid();
  _max_devices   constant int := 3;
  _session_id    uuid;
  _device_id     uuid;
  _excess_ids    uuid[];
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _fingerprint IS NULL OR trim(_fingerprint) = '' THEN
    RAISE EXCEPTION 'MISSING_FINGERPRINT' USING ERRCODE='P0001';
  END IF;

  -- session_id is a JWT claim that supabase auth populates. Used to revoke
  -- the precise session when the device is kicked.
  BEGIN
    _session_id := (auth.jwt() ->> 'session_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    _session_id := NULL;
  END;

  INSERT INTO user_devices (
    user_id, device_fingerprint, auth_session_id, device_label, user_agent, last_seen_at
  ) VALUES (
    _me, _fingerprint, _session_id, NULLIF(trim(_device_label), ''), _user_agent, now()
  )
  ON CONFLICT (user_id, device_fingerprint) DO UPDATE
    SET auth_session_id = COALESCE(EXCLUDED.auth_session_id, user_devices.auth_session_id),
        device_label    = COALESCE(EXCLUDED.device_label,    user_devices.device_label),
        user_agent      = COALESCE(EXCLUDED.user_agent,      user_devices.user_agent),
        last_seen_at    = now()
  RETURNING id INTO _device_id;

  -- Identify rows over the cap: oldest by last_seen_at, excluding the one
  -- we just registered. ARRAY_AGG returns the id list the client should
  -- revoke. If the user is at or under the cap, returns NULL → []::uuid[].
  SELECT array_agg(id)
    INTO _excess_ids
    FROM (
      SELECT id FROM user_devices
       WHERE user_id = _me AND id <> _device_id
       ORDER BY last_seen_at DESC
       OFFSET (_max_devices - 1)
    ) victims;

  RETURN jsonb_build_object(
    'device_id', _device_id,
    'over_limit', COALESCE(array_length(_excess_ids, 1), 0) > 0,
    'to_revoke', COALESCE(to_jsonb(_excess_ids), '[]'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.register_my_device(text, text, text) TO authenticated;

-- ── RPC: list_my_devices ─────────────────────────────────────────────────
-- For the Active Sessions UI. Returns own rows sorted by last_seen_at DESC
-- so the most-recent device (typically "this one") is on top.
CREATE OR REPLACE FUNCTION public.list_my_devices()
RETURNS SETOF public.user_devices
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.user_devices
   WHERE user_id = auth.uid()
   ORDER BY last_seen_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_devices() TO authenticated;

-- ── RPC: revoke_my_device ────────────────────────────────────────────────
-- Hard sign-out of one device. Three writes:
--   1. user_devices row deleted (so it disappears from the UI)
--   2. auth.refresh_tokens for the session_id deleted (so the device
--      can't silently re-auth via refresh)
--   3. auth.sessions row deleted (so the access token is invalidated
--      at the next request)
--
-- Step 2 + 3 require write access to the auth schema. SECURITY DEFINER on
-- a function owned by the supabase admin role grants that. The function
-- guards by checking the caller owns the device before touching anything.
CREATE OR REPLACE FUNCTION public.revoke_my_device(_device_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me         uuid := auth.uid();
  _session_id uuid;
  _owned      boolean;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT auth_session_id, true
    INTO _session_id, _owned
    FROM public.user_devices
    WHERE id = _device_id AND user_id = _me;

  IF NOT _owned THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  -- Order matters: kill the refresh tokens first so a race between this
  -- function and a refresh request doesn't leave a dangling refresh path.
  IF _session_id IS NOT NULL THEN
    BEGIN
      DELETE FROM auth.refresh_tokens WHERE session_id = _session_id;
    EXCEPTION WHEN OTHERS THEN
      -- Insufficient privileges or schema unexpectedly different — fall
      -- through and let the API-route fallback handle it. The device row
      -- still gets removed below so the UI reflects the user's intent.
      NULL;
    END;
    BEGIN
      DELETE FROM auth.sessions WHERE id = _session_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  DELETE FROM public.user_devices WHERE id = _device_id;
  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_my_device(uuid) TO authenticated;

COMMIT;
