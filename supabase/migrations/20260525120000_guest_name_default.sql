-- ============================================================================
-- guest_calls.guest_name fallback — never NULL, never empty.
-- ============================================================================
-- guest_calls.guest_name is NOT NULL. The customer-session RPC
-- (get_or_create_active_customer_session) derives the name from the user's
-- full_name → email. Anonymous guests (Try-RELAY funnel) have no email and
-- may have no full_name metadata, so the derived name comes through NULL and
-- the INSERT fails with a 23502 not-null violation.
--
-- The client now seeds a "Guest" full_name, but that only covers the funnel
-- path. This trigger makes the database resilient for EVERY insert path
-- (RPC, edge functions, future callers): a NULL/blank guest_name is coerced
-- to 'Guest' before the row is written. A plain column DEFAULT would not
-- help — the RPC supplies guest_name explicitly (as NULL), which overrides
-- any default.
-- ============================================================================

BEGIN;

-- Backfill any existing rows that slipped through with a blank name.
UPDATE public.guest_calls
   SET guest_name = 'Guest'
 WHERE guest_name IS NULL OR btrim(guest_name) = '';

CREATE OR REPLACE FUNCTION public.guest_calls_default_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.guest_name IS NULL OR btrim(NEW.guest_name) = '' THEN
    NEW.guest_name := 'Guest';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guest_calls_default_name ON public.guest_calls;
CREATE TRIGGER trg_guest_calls_default_name
  BEFORE INSERT OR UPDATE OF guest_name ON public.guest_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.guest_calls_default_name();

COMMIT;
