-- Remove signup bonus: customers start on free tier (0 balance).
-- After their free session is consumed, wallet stays at 0 until they purchase.

-- 1. Update the trigger function to create wallets with 0 balance
CREATE OR REPLACE FUNCTION public.grant_signup_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.credit_wallets (user_id, balance, lifetime_purchased)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2. Zero out wallets that only ever received the signup bonus (no real purchases)
UPDATE public.credit_wallets
SET balance = 0
WHERE user_id IN (
  SELECT user_id
  FROM public.credit_transactions
  GROUP BY user_id
  HAVING COUNT(*) = COUNT(*) FILTER (WHERE reason = 'signup_bonus')
)
AND lifetime_purchased = 0;
