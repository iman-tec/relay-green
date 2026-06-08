-- ============================================================================
-- transfer_org_to_employee — refill an employee DIRECTLY from the org wallet.
-- ============================================================================
-- The dept-pool path (transfer_to_employee) routes org → dept → employee. This
-- atomic RPC lets an enterprise admin top a member up straight from the
-- organization's pool (organizations.remaining_minutes), the brief's default
-- per-member refill source. Money-safe: single transaction, FOR UPDATE locks,
-- balance guard. Additive — does not change any existing flow.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_org_to_employee(
  _org_id     uuid,
  _profile_id uuid,
  _amount     numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  -- Member must belong to the org (lock the row).
  PERFORM 1 FROM public.profiles
    WHERE id = _profile_id AND organization_id = _org_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile % not in org %', _profile_id, _org_id;
  END IF;

  -- Org pool must have enough remaining (lock the row).
  PERFORM 1 FROM public.organizations
    WHERE id = _org_id AND remaining_minutes >= _amount
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization has insufficient remaining_minutes';
  END IF;

  UPDATE public.organizations
     SET remaining_minutes = remaining_minutes - _amount
   WHERE id = _org_id;

  UPDATE public.profiles
     SET allocated_minutes = allocated_minutes + _amount,
         remaining_minutes = remaining_minutes + _amount
   WHERE id = _profile_id;
END $$;

GRANT EXECUTE ON FUNCTION public.transfer_org_to_employee(uuid, uuid, numeric)
  TO service_role;

COMMIT;
