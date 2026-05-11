REVOKE EXECUTE ON FUNCTION public.debit_credits(UUID, NUMERIC, TEXT, UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_credits(UUID, NUMERIC, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_signup_credits() FROM PUBLIC, anon, authenticated;