-- Fix PostgreSQL 42P17 caused by admin policies selecting public.users
-- from inside an RLS policy on public.users.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT u.is_admin FROM public.users AS u WHERE u.id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all wallets" ON public.wallets;
CREATE POLICY "Admins can view all wallets"
  ON public.wallets FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all transactions" ON public.transactions;
CREATE POLICY "Admins can view all transactions"
  ON public.transactions FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all sessions" ON public.sessions;
CREATE POLICY "Admins can view all sessions"
  ON public.sessions FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage credit_packages" ON public.credit_packages;
CREATE POLICY "Admins can manage credit_packages"
  ON public.credit_packages FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all payments" ON public.crypto_payments;
CREATE POLICY "Admins can view all payments"
  ON public.crypto_payments FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update payments" ON public.crypto_payments;
CREATE POLICY "Admins can update payments"
  ON public.crypto_payments FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
