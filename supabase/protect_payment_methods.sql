-- Prevent application clients (including stale desktop/browser builds) from
-- mutating configured payment methods directly. The current admin dashboard
-- sends authenticated changes through the supervisor API, which verifies the
-- admin and writes with the server role. Customers retain read-only access.

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Admins can insert payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Admins can update payment methods" ON public.payment_methods;
DROP POLICY IF EXISTS "Admins can delete payment methods" ON public.payment_methods;

-- Intentionally no client INSERT, UPDATE, or DELETE policy. Payment methods are
-- saved by the authenticated supervisor API and may be made unavailable to
-- customers by setting is_active = false.

NOTIFY pgrst, 'reload schema';
