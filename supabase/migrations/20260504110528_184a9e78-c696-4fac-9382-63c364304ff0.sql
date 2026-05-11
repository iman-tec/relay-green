-- =========================================
-- CREDITS SYSTEM
-- =========================================

-- Wallets: one row per user, holds current balance
CREATE TABLE public.credit_wallets (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_purchased NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own wallet"
  ON public.credit_wallets FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'pod_lead')
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  );

-- No direct insert/update from clients; only SECURITY DEFINER functions mutate the wallet.

-- Transactions ledger (immutable history)
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('signup_bonus','call_charge','purchase','adjustment','refund')),
  request_id UUID REFERENCES public.requests(id) ON DELETE SET NULL,
  call_session_id UUID,
  stripe_session_id TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_tx_user_created ON public.credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_credit_tx_request ON public.credit_transactions(request_id);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own transactions"
  ON public.credit_transactions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'ops_manager')
    OR public.has_role(auth.uid(), 'admin')
  );

-- Buyable packages
CREATE TABLE public.credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  credits NUMERIC(12,2) NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_price_id TEXT,
  badge TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authed can view active packages"
  ON public.credit_packages FOR SELECT TO authenticated
  USING (active = true OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'ops_manager'));

CREATE POLICY "Admins manage packages"
  ON public.credit_packages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'ops_manager'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'ops_manager'));

-- Call sessions: actual call timings driven by Zoom webhooks
CREATE TABLE public.call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.request_messages(id) ON DELETE SET NULL,
  zoom_meeting_id TEXT NOT NULL,
  builder_id UUID NOT NULL REFERENCES public.profiles(id),
  engineer_id UUID REFERENCES public.profiles(id),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  actual_minutes NUMERIC(8,2),
  billed_credits NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','billed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_call_sessions_zoom ON public.call_sessions(zoom_meeting_id);
CREATE INDEX idx_call_sessions_request ON public.call_sessions(request_id);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View call sessions on visible requests"
  ON public.call_sessions FOR SELECT TO authenticated
  USING (public.can_view_request(request_id, auth.uid()));

CREATE TRIGGER trg_call_sessions_updated
  BEFORE UPDATE ON public.call_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- FUNCTIONS
-- =========================================

-- Grant signup bonus on profile creation
CREATE OR REPLACE FUNCTION public.grant_signup_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.credit_wallets (user_id, balance, lifetime_purchased)
  VALUES (NEW.id, 1000, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.credit_transactions (user_id, delta, balance_after, reason, description)
  VALUES (NEW.id, 1000, 1000, 'signup_bonus', 'Welcome bonus: 1 free hour of help');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_grant_signup_credits
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_signup_credits();

-- Atomic debit (called by zoom webhook edge function with service role)
-- Allows balance to go as low as -500 so an in-progress call always finishes.
CREATE OR REPLACE FUNCTION public.debit_credits(
  _user_id UUID,
  _amount NUMERIC,
  _reason TEXT,
  _request_id UUID DEFAULT NULL,
  _call_session_id UUID DEFAULT NULL,
  _description TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  -- Ensure wallet exists
  INSERT INTO public.credit_wallets (user_id, balance)
  VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.credit_wallets
  SET balance = balance - _amount,
      lifetime_spent = lifetime_spent + _amount,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING balance INTO new_balance;

  INSERT INTO public.credit_transactions
    (user_id, delta, balance_after, reason, request_id, call_session_id, description, metadata)
  VALUES
    (_user_id, -_amount, new_balance, _reason, _request_id, _call_session_id, _description, _metadata);

  RETURN new_balance;
END;
$$;

-- Atomic credit (purchase / refund / adjustment)
CREATE OR REPLACE FUNCTION public.credit_credits(
  _user_id UUID,
  _amount NUMERIC,
  _reason TEXT,
  _stripe_session_id TEXT DEFAULT NULL,
  _description TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  -- Idempotency: skip if we already recorded this stripe session
  IF _stripe_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_transactions WHERE stripe_session_id = _stripe_session_id
  ) THEN
    SELECT balance INTO new_balance FROM public.credit_wallets WHERE user_id = _user_id;
    RETURN new_balance;
  END IF;

  INSERT INTO public.credit_wallets (user_id, balance)
  VALUES (_user_id, _amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.credit_wallets.balance + EXCLUDED.balance,
        lifetime_purchased = public.credit_wallets.lifetime_purchased
          + CASE WHEN _reason = 'purchase' THEN _amount ELSE 0 END,
        updated_at = now()
  RETURNING balance INTO new_balance;

  INSERT INTO public.credit_transactions
    (user_id, delta, balance_after, reason, stripe_session_id, description, metadata)
  VALUES
    (_user_id, _amount, new_balance, _reason, _stripe_session_id, _description, _metadata);

  RETURN new_balance;
END;
$$;

-- Backfill wallets for existing profiles (one-time, no transaction row)
INSERT INTO public.credit_wallets (user_id, balance)
SELECT id, 1000 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.credit_transactions (user_id, delta, balance_after, reason, description)
SELECT p.id, 1000, 1000, 'signup_bonus', 'Welcome bonus (backfill)'
FROM public.profiles p
LEFT JOIN public.credit_transactions t
  ON t.user_id = p.id AND t.reason = 'signup_bonus'
WHERE t.id IS NULL;

-- Seed packages (stripe_price_id will be filled in after batch_create_product)
INSERT INTO public.credit_packages (code, name, credits, price_cents, currency, badge, sort_order) VALUES
  ('credits_500',   '500 credits',    500,   1500, 'USD', NULL,            1),
  ('credits_2000',  '2,000 credits',  2000,  5500, 'USD', '8% OFF',        2),
  ('credits_5000',  '5,000 credits',  5000,  13000,'USD', '13% OFF',       3),
  ('credits_12000', '12,000 credits', 12000, 30000,'USD', 'BEST VALUE',    4);
