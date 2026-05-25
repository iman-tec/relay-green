-- ============================================================================
--  Lead capture tables: enquiries (contact form) + enterprise_requests
-- ============================================================================
--  Wires the two public marketing forms to durable storage:
--    • Contact form ("Send message")  → public.enquiries
--    • Enterprise inquiry ("Send inquiry", + channel-partner picker)
--                                       → public.enterprise_requests
--
--  Writes happen server-side via the service role (the public API routes),
--  which bypasses RLS — so there are NO public insert policies. Reads are
--  gated: super_admin sees everything; a channel-partner owner sees the
--  enterprise requests routed to their channel partner.
-- ============================================================================

BEGIN;

-- ── 1. enquiries (general contact form) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enquiries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  email             text        NOT NULL,
  company           text,
  topic             text        NOT NULL,
  message           text        NOT NULL,
  marketing_consent boolean     NOT NULL DEFAULT false,
  status            text        NOT NULL DEFAULT 'new'
                                  CHECK (status IN ('new','contacted','closed')),
  source            text        NOT NULL DEFAULT 'contact_form',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enquiries_created ON public.enquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiries_status  ON public.enquiries(status);

ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enquiries_super_admin_read ON public.enquiries;
CREATE POLICY enquiries_super_admin_read
  ON public.enquiries FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ── 2. enterprise_requests (enterprise inquiry + channel partner) ───────────
CREATE TABLE IF NOT EXISTS public.enterprise_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text        NOT NULL,
  email                text        NOT NULL,
  company              text,
  message              text        NOT NULL,
  channel_partner_id   uuid        REFERENCES public.resellers(id) ON DELETE SET NULL,
  channel_partner_name text,       -- denormalized snapshot at submit time
  status               text        NOT NULL DEFAULT 'new'
                                     CHECK (status IN ('new','contacted','closed')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_requests_created ON public.enterprise_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_requests_partner ON public.enterprise_requests(channel_partner_id)
  WHERE channel_partner_id IS NOT NULL;

ALTER TABLE public.enterprise_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_requests_super_admin_read ON public.enterprise_requests;
CREATE POLICY enterprise_requests_super_admin_read
  ON public.enterprise_requests FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

-- A channel-partner owner can see the enterprise requests routed to them.
DROP POLICY IF EXISTS enterprise_requests_partner_read ON public.enterprise_requests;
CREATE POLICY enterprise_requests_partner_read
  ON public.enterprise_requests FOR SELECT
  USING (
    channel_partner_id IN (
      SELECT reseller_id FROM public.profiles
       WHERE id = auth.uid() AND reseller_id IS NOT NULL
    )
  );

COMMIT;
