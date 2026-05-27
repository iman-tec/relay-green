-- ============================================================================
-- Unified invites — the single onboarding primitive across all hierarchy
-- levels (partner → company → department → member). One coded, single-use,
-- expiring link per recipient; status tracked end-to-end.
-- ============================================================================
-- scope_type/scope_id say what the invitee is being attached to:
--   'partner'    + reseller_id   → company admin (org is created on accept)
--   'company'    + organization  → org admin / member (+ optional department)
--   'department' + department_id → department member
-- code is the single-use token carried by the link; status walks
-- sent → opened → accepted, or → expired / revoked.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text,
  role          text,                          -- enterprise_admin | department_admin | client
  scope_type    text NOT NULL CHECK (scope_type IN ('partner','company','department')),
  scope_id      uuid NOT NULL,                 -- reseller / organization / department id
  company_name  text,                          -- partner→company: name of org to create
  department_id uuid,                           -- optional target department (company invites)
  code          text NOT NULL UNIQUE,          -- single-use token in the link
  status        text NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent','opened','accepted','expired','revoked')),
  invited_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  opened_at     timestamptz,
  accepted_at   timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '14 days',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_scope ON public.invites (scope_type, scope_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.invites (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_code ON public.invites (code);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Inviter reads their own invites (status table). Writes go through the
-- service-role API (which scopes by the caller's partner/org/dept).
DROP POLICY IF EXISTS "Inviter reads own invites" ON public.invites;
CREATE POLICY "Inviter reads own invites" ON public.invites
  FOR SELECT TO authenticated
  USING (invited_by = auth.uid() OR has_role(auth.uid(), 'super_admin'));

COMMIT;
