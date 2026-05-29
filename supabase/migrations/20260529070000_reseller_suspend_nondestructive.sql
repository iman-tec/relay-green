-- ============================================================================
-- Make Channel Partner suspension non-destructive (reversible)
-- ============================================================================
-- The previous deactivate_reseller converted every inorganic enterprise to
-- organic and nulled organizations.reseller_id. That PERMANENTLY orphaned the
-- partner's companies: reactivating only flips resellers.status back to
-- 'active' and cannot restore the lost links, so the partner's dashboard
-- ("reseller_id = me") showed zero companies forever after any suspend.
--
-- New behaviour: suspending only flips resellers.status='suspended' and
-- leaves the enterprises linked (reseller_id + enterprise_type='inorganic')
-- untouched. Reactivating (resellers.status='active', handled in the PATCH
-- route) therefore fully restores the partner with its companies intact.
-- The PATCH route still bans/unbans the partner owner, so suspension still
-- blocks their login.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.deactivate_reseller(_reseller_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  -- Freeze the partner only — do NOT touch its enterprises. Keeping their
  -- reseller_id + inorganic type intact is what makes reactivation reversible.
  UPDATE public.resellers
     SET status = 'suspended'
   WHERE id = _reseller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reseller not found: %', _reseller_id;
  END IF;
END $fn$;

COMMIT;
