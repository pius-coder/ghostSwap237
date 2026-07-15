-- 1. Add is_admin to users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- 2. Add price_usd to credit_packages (create table if it doesn't exist, though it seems to exist)
CREATE TABLE IF NOT EXISTS public.credit_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credits INTEGER NOT NULL,
  price_ngn NUMERIC NOT NULL,
  price_usd NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS price_usd NUMERIC DEFAULT 0;

ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- 3. Create crypto_payments table
CREATE TABLE IF NOT EXISTS public.crypto_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_id UUID REFERENCES public.credit_packages(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL, -- Total amount they were supposed to pay
  currency TEXT NOT NULL DEFAULT 'USD', -- USD or NGN equivalent
  credits INTEGER NOT NULL, -- Credits to be awarded
  crypto_currency TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- ============================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_payments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- users table policies update (if needed to see is_admin)
-- We might need a policy so admins can view all users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Admins can view all users' AND tablename = 'users'
  ) THEN
    CREATE POLICY "Admins can view all users"
      ON public.users FOR SELECT
      USING (
        (SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE
      );
  END IF;
END
$$;

-- credit_packages policies
CREATE POLICY "Anyone can view active credit_packages"
  ON public.credit_packages FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage credit_packages"
  ON public.credit_packages FOR ALL
  USING (
    (SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE
  );

-- crypto_payments policies
CREATE POLICY "Users can insert their own payments"
  ON public.crypto_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own payments"
  ON public.crypto_payments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all payments"
  ON public.crypto_payments FOR SELECT
  USING (
    (SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE
  );

CREATE POLICY "Admins can update payments"
  ON public.crypto_payments FOR UPDATE
  USING (
    (SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE
  );

-- Function to confirm payment and add credits
CREATE OR REPLACE FUNCTION public.confirm_crypto_payment(
  p_payment_id UUID,
  p_admin_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_payment RECORD;
  v_is_admin BOOLEAN;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin FROM public.users WHERE id = p_admin_id;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get payment
  SELECT * INTO v_payment FROM public.crypto_payments WHERE id = p_payment_id FOR UPDATE;
  
  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status != 'pending' THEN
    RAISE EXCEPTION 'Payment already processed';
  END IF;

  -- Add credits using existing function
  PERFORM public.add_to_wallet(v_payment.user_id, v_payment.credits, p_payment_id::text);

  -- Update payment status
  UPDATE public.crypto_payments
  SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = p_admin_id
  WHERE id = p_payment_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for manual admin credit addition
CREATE OR REPLACE FUNCTION public.admin_add_credits(
  p_admin_id UUID,
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin FROM public.users WHERE id = p_admin_id;
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Add credits using existing function
  PERFORM public.add_to_wallet(p_user_id, p_amount, 'Admin manual addition');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
