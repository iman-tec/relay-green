-- Org compensation: per-user monthly salary set by the org's Internal
-- Admin (ops_manager) or Enterprise Admin. Used on the /finance page to
-- track payroll alongside session revenue and feedback.
--
-- One row per (organization, user). Currency tracks the org's billing
-- currency at the time the row was written; we don't try to convert.

CREATE TABLE IF NOT EXISTS public.org_compensation (
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_cents    integer NOT NULL DEFAULT 0 CHECK (monthly_cents >= 0),
  currency         text    NOT NULL DEFAULT 'EUR',
  notes            text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_compensation_org
  ON public.org_compensation (organization_id);

-- RLS: only org-admin roles (enterprise_admin, ops_manager) read/write,
-- scoped to their own org. Service role bypasses for the API handlers.
ALTER TABLE public.org_compensation ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'org_compensation'
      AND schemaname = 'public' AND policyname = 'org_compensation_read_same_org'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY org_compensation_read_same_org ON public.org_compensation
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.user_roles ur ON ur.user_id = p.id
            WHERE p.id = auth.uid()
              AND p.organization_id = org_compensation.organization_id
              AND ur.role IN ('enterprise_admin', 'ops_manager')
          )
        )
    $POL$;
  END IF;
END $$;

-- Writes are funnelled through the API (service role); no client-side
-- INSERT/UPDATE policies. This keeps audit attribution (updated_by) honest.
