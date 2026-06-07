-- ============================================================================
-- Enterprise MSA terms — additive scope on terms_acceptances. ADDITIVE ONLY.
-- ============================================================================
-- terms_acceptances currently holds only the Channel-Partner commercial-terms
-- clickwrap. The enterprise-admin command center adds a separate, org-level MSA
-- acceptance (one authorized signer binds the whole org). Keep the two
-- agreements distinct — they have independent version lineages.
--
--   terms_type : 'partner_commercial' (existing rows) | 'enterprise_msa' (new)
--
-- Existing rows default to 'partner_commercial' (they ARE partner clickwraps),
-- so no backfill is needed. Nothing else is touched.
-- ============================================================================

BEGIN;

ALTER TABLE public.terms_acceptances
  ADD COLUMN IF NOT EXISTS terms_type text NOT NULL DEFAULT 'partner_commercial'
    CHECK (terms_type IN ('partner_commercial', 'enterprise_msa'));

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_type
  ON public.terms_acceptances (enterprise_id, terms_type, terms_version);

COMMIT;
