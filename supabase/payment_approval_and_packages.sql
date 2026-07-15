-- Run after fix_admin_rls_recursion.sql.
-- Creates pending payment requests and allows only admins to approve/decline them.

-- Some clients use this column to control how packages are displayed.
ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Give existing packages a stable order based on their credit amount. Preserve
-- any non-zero ordering already assigned by an admin.
WITH ordered_packages AS (
  SELECT id, row_number() OVER (ORDER BY credits, created_at, id) - 1 AS position
  FROM public.credit_packages
)
UPDATE public.credit_packages AS package
SET sort_order = ordered.position
FROM ordered_packages AS ordered
WHERE package.id = ordered.id
  AND package.sort_order = 0;

CREATE INDEX IF NOT EXISTS credit_packages_sort_order_idx
  ON public.credit_packages (sort_order, credits);

-- Shared-backend wallet compatibility:
-- - the desktop app uses credits
-- - the website uses balance and currency
-- Both representations are kept on the same wallet row.
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wallets'
      AND column_name = 'balance'
  ) THEN
    EXECUTE $backfill$
      UPDATE public.wallets
      SET credits = GREATEST(credits, FLOOR(COALESCE(balance, 0))::integer)
    $backfill$;
  END IF;
END;
$$;

-- Finish the initial migration with both clients seeing the same value.
UPDATE public.wallets
SET balance = credits::numeric,
    currency = COALESCE(NULLIF(currency, ''), 'NGN');

CREATE OR REPLACE FUNCTION public.sync_wallet_balance_and_credits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.credits, 0) = 0 AND COALESCE(NEW.balance, 0) <> 0 THEN
      NEW.credits := GREATEST(0, FLOOR(NEW.balance)::integer);
    ELSE
      NEW.balance := COALESCE(NEW.credits, 0)::numeric;
    END IF;
  ELSIF NEW.credits IS DISTINCT FROM OLD.credits THEN
    -- Desktop/admin changed credits: expose that value to the website.
    NEW.balance := NEW.credits::numeric;
  ELSIF NEW.balance IS DISTINCT FROM OLD.balance THEN
    -- Website changed balance: expose that value to the desktop/admin.
    NEW.credits := GREATEST(0, FLOOR(NEW.balance)::integer);
    NEW.balance := NEW.credits::numeric;
  END IF;

  NEW.currency := COALESCE(NULLIF(NEW.currency, ''), 'NGN');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_wallet_balance_and_credits ON public.wallets;
CREATE TRIGGER sync_wallet_balance_and_credits
  BEFORE INSERT OR UPDATE OF credits, balance, currency
  ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_wallet_balance_and_credits();

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all transactions" ON public.transactions;
CREATE POLICY "Admins can view all transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (public.is_admin());

-- Website compatibility: subscription records share the same users and admin
-- backend. plan_id is intentionally not tied to the removed legacy plans table.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id uuid,
  plan_name text NOT NULL,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'NGN',
  credits integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Bring partially existing website tables up to the shared schema.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS credits_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.subscriptions
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('pending', 'active', 'expired', 'cancelled'));

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx
  ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON public.subscriptions (status);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can insert own subscriptions"
  ON public.subscriptions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can update own subscriptions"
  ON public.subscriptions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all subscriptions" ON public.subscriptions;
CREATE POLICY "Admins can view all subscriptions"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (public.is_admin());

-- Website compatibility: older website code checks public.admin_users by
-- user_id. Keep users.is_admin as the single source of truth and expose it
-- through a read-only security-invoker view.
DROP VIEW IF EXISTS public.admin_users;
CREATE VIEW public.admin_users
WITH (security_invoker = true)
AS
SELECT
  id AS user_id,
  email,
  created_at
FROM public.users
WHERE is_admin = true;

REVOKE ALL ON public.admin_users FROM PUBLIC;
GRANT SELECT ON public.admin_users TO authenticated;

-- Shared payment destinations managed by the desktop admin dashboard and read
-- by both the website and desktop checkout screens.
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  crypto_currency text NOT NULL DEFAULT 'USDT',
  network text NOT NULL,
  wallet_address text NOT NULL,
  qr_code_url text,
  instructions text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_methods_active_order_idx
  ON public.payment_methods (is_active, sort_order);

DROP TRIGGER IF EXISTS set_payment_methods_updated_at ON public.payment_methods;
CREATE TRIGGER set_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active payment methods" ON public.payment_methods;
CREATE POLICY "Anyone can view active payment methods"
  ON public.payment_methods FOR SELECT
  USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage payment methods" ON public.payment_methods;
CREATE POLICY "Admins can manage payment methods"
  ON public.payment_methods FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Public QR images. Only admins can upload, replace, or delete objects.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-qr-codes',
  'payment-qr-codes',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Admins can upload payment QR codes" ON storage.objects;
CREATE POLICY "Admins can upload payment QR codes"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-qr-codes' AND public.is_admin());

DROP POLICY IF EXISTS "Admins can update payment QR codes" ON storage.objects;
CREATE POLICY "Admins can update payment QR codes"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-qr-codes' AND public.is_admin())
  WITH CHECK (bucket_id = 'payment-qr-codes' AND public.is_admin());

DROP POLICY IF EXISTS "Admins can delete payment QR codes" ON storage.objects;
CREATE POLICY "Admins can delete payment QR codes"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-qr-codes' AND public.is_admin());

CREATE TABLE IF NOT EXISTS public.crypto_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_id uuid REFERENCES public.credit_packages(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  credits integer NOT NULL CHECK (credits > 0),
  crypto_currency text NOT NULL DEFAULT 'USDT',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.crypto_payments
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.crypto_payments
  DROP CONSTRAINT IF EXISTS crypto_payments_status_check;

ALTER TABLE public.crypto_payments
  ADD CONSTRAINT crypto_payments_status_check
  CHECK (status IN ('pending', 'completed', 'failed'));

ALTER TABLE public.crypto_payments ENABLE ROW LEVEL SECURITY;

-- Users cannot insert payment values directly. The RPC below derives them from
-- an active package and forces status to pending.
DROP POLICY IF EXISTS "Users can insert their own payments" ON public.crypto_payments;

DROP POLICY IF EXISTS "Users can view their own payments" ON public.crypto_payments;
CREATE POLICY "Users can view their own payments"
  ON public.crypto_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all payments" ON public.crypto_payments;
CREATE POLICY "Admins can view all payments"
  ON public.crypto_payments FOR SELECT TO authenticated
  USING (public.is_admin());

-- No direct client UPDATE policy is created. Approval happens only through this RPC.
DROP POLICY IF EXISTS "Admins can update payments" ON public.crypto_payments;

CREATE OR REPLACE FUNCTION public.create_pending_crypto_payment(
  p_package_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package public.credit_packages%ROWTYPE;
  v_payment_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_package
  FROM public.credit_packages
  WHERE id = p_package_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit package not found or inactive';
  END IF;

  INSERT INTO public.crypto_payments (
    user_id, package_id, amount, currency, credits, crypto_currency, status
  ) VALUES (
    auth.uid(),
    v_package.id,
    CASE WHEN COALESCE(v_package.price_usd, 0) > 0
      THEN v_package.price_usd ELSE v_package.price_ngn END,
    CASE WHEN COALESCE(v_package.price_usd, 0) > 0 THEN 'USD' ELSE 'NGN' END,
    v_package.credits,
    'USDT',
    'pending'
  )
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_crypto_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_crypto_payment(uuid) TO authenticated;

-- Replace any legacy implementation that still references wallets.balance.
CREATE OR REPLACE FUNCTION public.add_to_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_reference text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  IF p_amount <= 0 OR p_amount <> trunc(p_amount) THEN
    RAISE EXCEPTION 'Credit amount must be a positive whole number';
  END IF;

  INSERT INTO public.wallets (user_id, credits)
  VALUES (p_user_id, p_amount::integer)
  ON CONFLICT (user_id) DO UPDATE
    SET credits = public.wallets.credits + EXCLUDED.credits,
        updated_at = now()
  RETURNING id INTO v_wallet_id;

  INSERT INTO public.transactions (
    user_id, wallet_id, amount, credits, type, status, reference, description
  ) VALUES (
    p_user_id,
    v_wallet_id,
    p_amount,
    p_amount::integer,
    'credit',
    'success',
    p_reference,
    'Credit top-up'
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.add_to_wallet(uuid, numeric, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_confirm_payment(
  p_payment_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.crypto_payments%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can process payments';
  END IF;

  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Status must be completed or failed';
  END IF;

  SELECT * INTO v_payment
  FROM public.crypto_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment has already been processed';
  END IF;

  IF p_status = 'completed' THEN
    PERFORM public.add_to_wallet(
      v_payment.user_id,
      v_payment.credits::numeric,
      v_payment.id::text
    );
  END IF;

  UPDATE public.crypto_payments
  SET status = p_status,
      confirmed_at = now(),
      confirmed_by = auth.uid()
  WHERE id = p_payment_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_confirm_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment(uuid, text) TO authenticated;

-- Process purchases created by the website in public.transactions. This uses
-- the existing pending row as the ledger record and credits the shared wallet
-- exactly once.
CREATE OR REPLACE FUNCTION public.admin_confirm_website_transaction(
  p_transaction_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction public.transactions%ROWTYPE;
  v_credits integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can process website transactions';
  END IF;

  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Status must be completed or failed';
  END IF;

  SELECT * INTO v_transaction
  FROM public.transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Website transaction not found';
  END IF;

  IF v_transaction.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction has already been processed';
  END IF;

  IF p_status = 'completed' THEN
    v_credits := COALESCE(
      NULLIF(v_transaction.credits, 0),
      NULLIF(v_transaction.metadata->>'credits', '')::integer
    );

    IF v_credits IS NULL OR v_credits <= 0 THEN
      RAISE EXCEPTION 'Transaction does not contain a valid credit amount';
    END IF;

    INSERT INTO public.wallets (user_id, credits)
    VALUES (v_transaction.user_id, v_credits)
    ON CONFLICT (user_id) DO UPDATE
      SET credits = public.wallets.credits + EXCLUDED.credits,
          updated_at = now();
  END IF;

  UPDATE public.transactions
  SET status = CASE WHEN p_status = 'completed' THEN 'success' ELSE 'failed' END,
      description = COALESCE(description, 'Website credit purchase')
  WHERE id = p_transaction_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_confirm_website_transaction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_confirm_website_transaction(uuid, text) TO authenticated;

-- Package management: everyone can read active packages; admins can add/edit them.
ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active credit_packages" ON public.credit_packages;
CREATE POLICY "Anyone can view active credit_packages"
  ON public.credit_packages FOR SELECT
  USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage credit_packages" ON public.credit_packages;
CREATE POLICY "Admins can manage credit_packages"
  ON public.credit_packages FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Ask PostgREST to refresh immediately after this migration is run.
NOTIFY pgrst, 'reload schema';
