-- ============================================================================
-- Access audit log — who read which account's data, when (GDPR Art. 30).
-- ============================================================================
-- The existing session_audit_log records session STATE TRANSITIONS, not data
-- reads. Back-office roles (enterprise admin, department manager, channel
-- partner) read other people's data through service-role API routes; this
-- table records each such read so access is accountable.
--
-- Written server-side via the service role (see lib/relay/accessAudit.ts).
-- Readable only by super_admin (compliance review).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.access_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_role    text NOT NULL,                 -- role under which the read happened
  tenant_scope  text,                          -- e.g. 'org:<uuid>' / 'dept:<uuid>' / 'reseller:<uuid>'
  resource      text NOT NULL,                 -- e.g. 'enterprise.department.employees'
  member_ids    uuid[] NOT NULL DEFAULT '{}',  -- subjects whose data was accessed
  member_count  integer NOT NULL DEFAULT 0,
  accessed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_audit_actor
  ON public.access_audit_log (actor_user_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_audit_scope
  ON public.access_audit_log (tenant_scope, accessed_at DESC);

ALTER TABLE public.access_audit_log ENABLE ROW LEVEL SECURITY;

-- Only super_admin can read the audit trail. Inserts happen via the service
-- role (which bypasses RLS), so no INSERT policy is granted to end-users.
DROP POLICY IF EXISTS "Super admin reads access audit" ON public.access_audit_log;
CREATE POLICY "Super admin reads access audit" ON public.access_audit_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'));

COMMIT;
