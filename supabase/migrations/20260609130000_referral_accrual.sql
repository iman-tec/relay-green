-- ============================================================================
-- Individual-referral commission ACCRUAL — Phase 2 money-path. ADDITIVE ONLY.
-- ============================================================================
-- The Stripe webhook (relay-stripe-webhook) calls accrue_referral_commission()
-- after crediting an individual's wallet. It is a no-op unless the buyer is an
-- attributed organic individual (an active individual_referrals row). Commission
-- basis is NET (post-discount) cents — the discount is applied in checkout, so
-- the charged amount IS net. Every accrual is a dated referral_commission_entries
-- row; idempotent on the Stripe object id (source_ref) so webhook retries are
-- safe. On a genuinely new accrual it also folds the commission into that
-- month's partner_payouts row via the dedicated referral_commission_cents column
-- (NOT earned_cents — avoids double-count with the read-time enterprise margin).
-- ============================================================================

BEGIN;

-- Stripe object ids are text, not uuid — add a text idempotency key. The uuid
-- source_id stays for optional internal linkage; source_ref is the dedup anchor
-- for external (Stripe) events.
ALTER TABLE public.referral_commission_entries
  ADD COLUMN IF NOT EXISTS source_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_commission_source_ref
  ON public.referral_commission_entries (source_ref)
  WHERE source_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.accrue_referral_commission(
  _customer_user_id uuid,
  _source_ref       text,
  _gross_cents      bigint,
  _net_cents        bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reseller_id      uuid;
  _commission_pct   numeric;
  _commission_cents bigint;
  _rows             int;
BEGIN
  IF _customer_user_id IS NULL OR _source_ref IS NULL THEN
    RETURN;
  END IF;

  -- Attributed + still active? (converted/churned individuals stop accruing.)
  SELECT reseller_id, commission_pct_applied
    INTO _reseller_id, _commission_pct
  FROM public.individual_referrals
  WHERE customer_user_id = _customer_user_id AND status = 'active'
  LIMIT 1;
  IF _reseller_id IS NULL THEN
    RETURN;
  END IF;

  _commission_cents := round(GREATEST(_net_cents, 0) * _commission_pct / 100.0);

  INSERT INTO public.referral_commission_entries
    (reseller_id, customer_user_id, source_type, source_ref,
     gross_cents, discount_cents, net_cents, commission_cents, occurred_at)
  VALUES
    (_reseller_id, _customer_user_id, 'bundle', _source_ref,
     GREATEST(_gross_cents, 0), GREATEST(_gross_cents - _net_cents, 0),
     GREATEST(_net_cents, 0), _commission_cents, now())
  ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS _rows = ROW_COUNT;
  IF _rows > 0 THEN
    -- Roll into the monthly payout cut (breakdown column only).
    INSERT INTO public.partner_payouts (reseller_id, period, referral_commission_cents)
    VALUES (_reseller_id, to_char(now(), 'YYYY-MM'), _commission_cents)
    ON CONFLICT (reseller_id, period) DO UPDATE
      SET referral_commission_cents =
            public.partner_payouts.referral_commission_cents
            + EXCLUDED.referral_commission_cents,
          updated_at = now();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.accrue_referral_commission(uuid, text, bigint, bigint)
  TO service_role;

COMMIT;
