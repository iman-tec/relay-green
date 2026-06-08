-- ============================================================================
--  partner_applications — public "become a partner" application queue
-- ============================================================================
--  Backs the public /partner/apply form and the super-admin review queue.
--
--    • Public submit (POST /api/partner/apply) writes a row via the service
--      role, which bypasses RLS — so there is NO public insert policy.
--    • Super-admin reads/updates the queue; approve links the row to the
--      reseller it provisioned (reseller_id) and stamps reviewed_by/_at.
--
--  Additive only: new table + new RPC. Touches nothing in the money path.
--  Mirrors the enquiries / enterprise_requests pattern (20260525190000).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.partner_applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name    text        NOT NULL,
  work_email      text        NOT NULL,             -- lowercased at write time
  company_name    text        NOT NULL,
  company_website text        NOT NULL,
  country_region  text        NOT NULL,
  clients_text    text        NOT NULL,             -- "who are your clients / what you sell"
  heard_about     text,                             -- optional, low-friction
  anything_else   text,                             -- optional
  source          text        NOT NULL DEFAULT 'partner_apply',
  status          text        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new','approved','rejected')),
  reseller_id     uuid        REFERENCES public.resellers(id) ON DELETE SET NULL,
  reviewed_by     uuid        REFERENCES public.profiles(id)  ON DELETE SET NULL,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_applications_created
  ON public.partner_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_applications_status
  ON public.partner_applications(status);
-- Duplicate-detection lookups (queue flags repeats; not a unique constraint —
-- a genuine re-apply must still land, just flagged).
CREATE INDEX IF NOT EXISTS idx_partner_applications_email
  ON public.partner_applications(lower(work_email));

ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_applications_super_admin_read ON public.partner_applications;
CREATE POLICY partner_applications_super_admin_read
  ON public.partner_applications FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ── Atomic status claim — the idempotency anchor for approve/reject ─────────
--  Flips status new → (approved|rejected) only if it is still 'new', stamping
--  the reviewer. Returns the row if THIS call won the race, NULL otherwise —
--  so a double-approve provisions exactly one reseller (the second call gets
--  NULL and short-circuits). reseller_id is set by approve after provisioning.
CREATE OR REPLACE FUNCTION public.claim_partner_application(
  _id        uuid,
  _status    text,
  _reviewer  uuid
)
RETURNS SETOF public.partner_applications
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.partner_applications
     SET status      = _status,
         reviewed_by = _reviewer,
         reviewed_at = now()
   WHERE id = _id
     AND status = 'new'
     AND _status IN ('approved','rejected')
  RETURNING *;
$$;

GRANT EXECUTE ON FUNCTION public.claim_partner_application(uuid, text, uuid)
  TO service_role;

COMMIT;
