-- Canonical finance ledger, provider product mappings, payment profiles,
-- automatic fulfilment, webhook evidence, and notification outbox.
-- Do NOT apply this migration to production from this task.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A previous partial execution may already have installed the immutable
-- evidence triggers. Remove only those known triggers for the duration of
-- this transaction so the schema can be reconciled safely. PostgreSQL rolls
-- this DDL back automatically if any later statement fails, and the triggers
-- are recreated below before COMMIT.
DO $$
BEGIN
  IF to_regclass('public.wallet_ledger') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wallet_ledger_immutable ON public.wallet_ledger';
  END IF;
  IF to_regclass('public.payment_webhook_events') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS payment_webhook_events_immutable ON public.payment_webhook_events';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Credit package catalogue (functional definition)
-- ---------------------------------------------------------------------------
ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.credit_packages AS package
SET
  credits = seed.credits,
  price_xaf = seed.price_xaf,
  price_usd = seed.price_usd,
  is_active = true,
  sort_order = seed.sort_order,
  updated_at = now()
FROM (
  VALUES
    ('Starter', 18000, 15000, 30::numeric, 1),
    ('Basic', 36000, 30000, 60::numeric, 2),
    ('Pro', 72000, 60000, 120::numeric, 3),
    ('Enterprise', 180000, 150000, 300::numeric, 4)
) AS seed(name, credits, price_xaf, price_usd, sort_order)
WHERE package.name = seed.name;

-- Keep legacy chariow columns if present but they are no longer checkout authority.
ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS chariow_product_id text,
  ADD COLUMN IF NOT EXISTS chariow_enabled boolean NOT NULL DEFAULT false;

UPDATE public.credit_packages
SET chariow_enabled = false
WHERE chariow_enabled IS DISTINCT FROM false;

-- ---------------------------------------------------------------------------
-- Provider product mappings (checkout authority)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_provider_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.credit_packages(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('fapshi', 'chariow')),
  currency text NOT NULL CHECK (char_length(currency) = 3 AND currency = upper(currency)),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  external_product_id text,
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, provider, currency)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_products_external_idx
  ON public.payment_provider_products (provider, external_product_id)
  WHERE external_product_id IS NOT NULL;

ALTER TABLE public.payment_provider_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_provider_products FROM PUBLIC, anon, authenticated;

INSERT INTO public.payment_provider_products (
  package_id, provider, currency, amount, external_product_id, enabled, metadata
)
SELECT package.id, 'fapshi', 'XAF', seed.amount, NULL, true,
  jsonb_build_object('source', 'seed', 'channel', 'cameroon_mobile_money')
FROM public.credit_packages package
JOIN (
  VALUES
    ('Starter', 15000::numeric),
    ('Basic', 30000::numeric),
    ('Pro', 60000::numeric),
    ('Enterprise', 150000::numeric)
) AS seed(name, amount) ON package.name = seed.name
ON CONFLICT (package_id, provider, currency) DO UPDATE
SET amount = EXCLUDED.amount,
    enabled = true,
    updated_at = now();

INSERT INTO public.payment_provider_products (
  package_id, provider, currency, amount, external_product_id, enabled, metadata
)
SELECT package.id, 'chariow', 'USD', seed.amount, NULL, false,
  jsonb_build_object(
    'source', 'seed',
    'channel', 'international',
    'product_type_hint', 'license',
    'note', 'Disabled until real Chariow product IDs are configured'
  )
FROM public.credit_packages package
JOIN (
  VALUES
    ('Starter', 30::numeric),
    ('Basic', 60::numeric),
    ('Pro', 120::numeric),
    ('Enterprise', 300::numeric)
) AS seed(name, amount) ON package.name = seed.name
ON CONFLICT (package_id, provider, currency) DO UPDATE
SET amount = EXCLUDED.amount,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- User payment profiles (Chariow checkout identity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_payment_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  first_name text NOT NULL CHECK (char_length(trim(first_name)) BETWEEN 1 AND 50),
  last_name text NOT NULL CHECK (char_length(trim(last_name)) BETWEEN 1 AND 50),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_payment_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_payment_profiles FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.user_payment_profiles TO authenticated;

DROP POLICY IF EXISTS user_payment_profiles_select_own ON public.user_payment_profiles;
CREATE POLICY user_payment_profiles_select_own
  ON public.user_payment_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_payment_profiles_upsert_own ON public.user_payment_profiles;
DROP POLICY IF EXISTS user_payment_profiles_insert_own ON public.user_payment_profiles;
CREATE POLICY user_payment_profiles_insert_own
  ON public.user_payment_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_payment_profiles_update_own ON public.user_payment_profiles;
CREATE POLICY user_payment_profiles_update_own
  ON public.user_payment_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Payment orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  package_id uuid REFERENCES public.credit_packages(id) ON DELETE SET NULL,
  provider_product_id uuid REFERENCES public.payment_provider_products(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('fapshi', 'chariow', 'website', 'legacy')),
  provider_reference text,
  provider_status text NOT NULL DEFAULT 'CREATED',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'refunded', 'disputed')),
  fulfilment_status text NOT NULL DEFAULT 'pending'
    CHECK (fulfilment_status IN ('pending', 'fulfilled', 'failed', 'reversed')),
  gross_amount numeric(14, 2) NOT NULL CHECK (gross_amount >= 0),
  fee_amount numeric(14, 2) CHECK (fee_amount IS NULL OR fee_amount >= 0),
  net_amount numeric(14, 2) CHECK (net_amount IS NULL OR net_amount >= 0),
  currency text NOT NULL CHECK (char_length(currency) = 3 AND currency = upper(currency)),
  credits_purchased integer NOT NULL CHECK (credits_purchased > 0),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS provider_product_id uuid REFERENCES public.payment_provider_products(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_reference_idx
  ON public.payment_orders (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_orders_status_created_idx
  ON public.payment_orders (status, fulfilment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_user_created_idx
  ON public.payment_orders (user_id, created_at DESC);

-- Carry historical records forward without pretending an old manual decision
-- was an automatic provider fulfilment.
INSERT INTO public.payment_orders (
  id, user_id, package_id, provider, provider_reference, provider_status,
  status, fulfilment_status, gross_amount, currency, credits_purchased,
  paid_at, fulfilled_at, metadata, created_at, updated_at
)
SELECT payment.id, payment.user_id, payment.package_id,
  CASE WHEN upper(COALESCE(payment.crypto_currency, '')) = 'FAPSHI' THEN 'fapshi' ELSE 'legacy' END,
  payment.reference, COALESCE(payment.provider_status, 'LEGACY'),
  CASE payment.status WHEN 'completed' THEN 'paid' WHEN 'failed' THEN 'failed' ELSE 'pending' END,
  CASE payment.status WHEN 'completed' THEN 'fulfilled' ELSE 'pending' END,
  payment.amount, upper(COALESCE(payment.currency, 'USD')), payment.credits,
  CASE WHEN payment.status = 'completed' THEN payment.confirmed_at END,
  CASE WHEN payment.status = 'completed' THEN payment.confirmed_at END,
  jsonb_build_object('legacy_table', 'crypto_payments', 'confirmed_by', payment.confirmed_by),
  payment.created_at, COALESCE(payment.confirmed_at, payment.created_at)
FROM public.crypto_payments payment
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_orders (
  user_id, provider, provider_reference, provider_status, status,
  fulfilment_status, gross_amount, currency, credits_purchased,
  paid_at, fulfilled_at, metadata, created_at, updated_at
)
SELECT tx.user_id, 'website', tx.reference, upper(tx.status),
  CASE tx.status WHEN 'success' THEN 'paid' WHEN 'failed' THEN 'failed' WHEN 'refunded' THEN 'refunded' ELSE 'pending' END,
  CASE tx.status WHEN 'success' THEN 'fulfilled' ELSE 'pending' END,
  tx.amount, upper(COALESCE(tx.metadata->>'currency', 'XAF')),
  COALESCE(NULLIF(tx.credits, 0), NULLIF(tx.metadata->>'credits', '')::integer),
  CASE WHEN tx.status = 'success' THEN tx.created_at END,
  CASE WHEN tx.status = 'success' THEN tx.created_at END,
  COALESCE(tx.metadata, '{}'::jsonb) || jsonb_build_object('legacy_table', 'transactions', 'legacy_id', tx.id),
  tx.created_at, tx.created_at
FROM public.transactions tx
WHERE (tx.status = 'pending' OR tx.description = 'Website credit purchase')
  AND COALESCE(NULLIF(tx.credits, 0), NULLIF(tx.metadata->>'credits', '')::integer) > 0
ON CONFLICT (provider, provider_reference) WHERE provider_reference IS NOT NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- Wallet ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN (
    'purchase', 'admin_adjustment', 'session_usage', 'refund', 'chargeback',
    'legacy_opening_balance', 'opening_balance'
  )),
  credits_delta integer NOT NULL CHECK (credits_delta <> 0),
  balance_before integer NOT NULL CHECK (balance_before >= 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.sessions(id) ON DELETE RESTRICT,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (balance_after = balance_before + credits_delta)
);

-- CREATE TABLE IF NOT EXISTS does not update constraints from an older
-- partial schema. Remove every inherited CHECK that still governs entry_type,
-- regardless of the name generated by the older migration.
DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT constraint_record.conname
    FROM pg_catalog.pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'public.wallet_ledger'::regclass
      AND constraint_record.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(constraint_record.oid) ILIKE '%entry_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.wallet_ledger DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT wallet_ledger_entry_type_check CHECK (entry_type IN (
    'purchase', 'admin_adjustment', 'session_usage', 'refund', 'chargeback',
    'legacy_opening_balance', 'opening_balance'
  ));

-- Existing opening_balance rows are immutable evidence and must keep their
-- original label when this migration is replayed. New rows use the explicit
-- legacy_opening_balance label below; reports intentionally accept both.

CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_purchase_once_idx
  ON public.wallet_ledger (payment_order_id)
  WHERE entry_type = 'purchase';
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_session_once_idx
  ON public.wallet_ledger (session_id)
  WHERE entry_type = 'session_usage';
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_legacy_opening_once_idx
  ON public.wallet_ledger (wallet_id)
  WHERE entry_type IN ('legacy_opening_balance', 'opening_balance');
CREATE INDEX IF NOT EXISTS wallet_ledger_type_created_idx
  ON public.wallet_ledger (entry_type, created_at DESC);

INSERT INTO public.wallet_ledger (
  user_id, wallet_id, entry_type, credits_delta, balance_before, balance_after,
  reason, metadata
)
SELECT wallet.user_id, wallet.id, 'legacy_opening_balance', wallet.credits, 0, wallet.credits,
  'Opening balance at finance-ledger migration',
  jsonb_build_object('snapshot_at', now(), 'excluded_from_revenue', true)
FROM public.wallets wallet
WHERE wallet.credits > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.wallet_ledger ledger
    WHERE ledger.wallet_id = wallet.id
      AND ledger.entry_type IN ('legacy_opening_balance', 'opening_balance')
  );

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS provider_cost_rate_usd_per_second numeric(12, 6),
  ADD COLUMN IF NOT EXISTS provider_cost_usd numeric(14, 6);

CREATE OR REPLACE FUNCTION public.capture_session_provider_cost()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'ended' AND (OLD.status IS DISTINCT FROM 'ended' OR NEW.provider_cost_usd IS NULL) THEN
    NEW.provider_cost_rate_usd_per_second := COALESCE(
      NEW.provider_cost_rate_usd_per_second,
      CASE NEW.provider WHEN 'fal' THEN 0.040000 WHEN 'reactor' THEN 0.001700 ELSE 0 END
    );
    NEW.provider_cost_usd := COALESCE(NEW.seconds_used, 0) * NEW.provider_cost_rate_usd_per_second;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_session_provider_cost ON public.sessions;
CREATE TRIGGER capture_session_provider_cost BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.capture_session_provider_cost();

-- ---------------------------------------------------------------------------
-- Webhook evidence + notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  delivery_id text NOT NULL,
  provider_reference text,
  signature_verified boolean NOT NULL,
  payload_sha256 text NOT NULL,
  payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, delivery_id)
);

CREATE TABLE IF NOT EXISTS public.admin_notification_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
  destination text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  minimum_severity text NOT NULL DEFAULT 'info'
    CHECK (minimum_severity IN ('info', 'warning', 'critical')),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, destination)
);

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
  destination text NOT NULL,
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_outbox_delivery_idx
  ON public.notification_outbox (status, next_attempt_at, created_at);

CREATE OR REPLACE FUNCTION public.reject_finance_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Finance evidence and ledger records are immutable';
END;
$$;

DROP TRIGGER IF EXISTS wallet_ledger_immutable ON public.wallet_ledger;
CREATE TRIGGER wallet_ledger_immutable BEFORE UPDATE OR DELETE ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_finance_ledger_mutation();
DROP TRIGGER IF EXISTS payment_webhook_events_immutable ON public.payment_webhook_events;
CREATE TRIGGER payment_webhook_events_immutable BEFORE UPDATE OR DELETE ON public.payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_finance_ledger_mutation();

CREATE OR REPLACE FUNCTION public.capture_wallet_transaction_ledger()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_balance_after integer; v_delta integer; v_entry_type text;
BEGIN
  IF NEW.status <> 'success' THEN RETURN NEW; END IF;
  IF NEW.provider = 'admin' THEN
    v_entry_type := 'admin_adjustment';
    v_delta := COALESCE(NULLIF(NEW.metadata->>'change', '')::integer,
      CASE NEW.type WHEN 'credit' THEN NEW.credits ELSE -NEW.credits END);
  ELSIF NEW.type = 'debit' AND NEW.session_id IS NOT NULL THEN
    v_entry_type := 'session_usage';
    v_delta := -NEW.credits;
  ELSE
    RETURN NEW;
  END IF;
  SELECT credits INTO v_balance_after FROM public.wallets WHERE id = NEW.wallet_id;
  INSERT INTO public.wallet_ledger (
    user_id, wallet_id, entry_type, credits_delta, balance_before, balance_after,
    session_id, transaction_id, actor_user_id, reason, metadata
  ) VALUES (
    NEW.user_id, NEW.wallet_id, v_entry_type, v_delta, v_balance_after - v_delta,
    v_balance_after, NEW.session_id, NEW.id,
    CASE WHEN NEW.provider = 'admin' THEN NULLIF(NEW.metadata->>'admin_id', '')::uuid ELSE NULL END,
    COALESCE(NEW.metadata->>'reason', NEW.description), NEW.metadata
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_wallet_transaction_ledger ON public.transactions;
CREATE TRIGGER capture_wallet_transaction_ledger AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.capture_wallet_transaction_ledger();

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notification_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_orders, public.wallet_ledger,
  public.payment_webhook_events, public.admin_notification_recipients,
  public.notification_outbox FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_admin_notifications(
  p_event_type text,
  p_severity text,
  p_template_key text,
  p_dedupe_key text,
  p_payload jsonb
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.notification_outbox (
    event_type, severity, channel, destination, template_key, payload, dedupe_key
  )
  SELECT p_event_type, p_severity, recipient.channel, recipient.destination,
    p_template_key, COALESCE(p_payload, '{}'::jsonb),
    p_dedupe_key || ':' || recipient.id::text
  FROM public.admin_notification_recipients recipient
  WHERE recipient.enabled
    AND CASE recipient.minimum_severity
      WHEN 'critical' THEN p_severity = 'critical'
      WHEN 'warning' THEN p_severity IN ('warning', 'critical')
      ELSE true
    END
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fulfill_payment_order(p_payment_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_before integer;
  v_after integer;
  v_transaction_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_order FROM public.payment_orders
  WHERE id = p_payment_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment order not found' USING ERRCODE = 'P0002'; END IF;

  IF v_order.status IN ('refunded', 'disputed', 'failed', 'expired') THEN
    RAISE EXCEPTION 'Payment order cannot be fulfilled in status %', v_order.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_order.fulfilment_status = 'fulfilled' THEN
    RETURN jsonb_build_object('id', v_order.id, 'status', 'fulfilled', 'alreadyFulfilled', true);
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'Payment is not paid' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing FROM public.wallet_ledger
  WHERE payment_order_id = v_order.id AND entry_type = 'purchase' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    UPDATE public.payment_orders SET fulfilment_status = 'fulfilled',
      fulfilled_at = COALESCE(fulfilled_at, now()), updated_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('id', v_order.id, 'status', 'fulfilled', 'alreadyFulfilled', true);
  END IF;

  INSERT INTO public.wallets (user_id, credits) VALUES (v_order.user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_order.user_id FOR UPDATE;
  v_before := v_wallet.credits;
  v_after := v_before + v_order.credits_purchased;
  UPDATE public.wallets SET credits = v_after, updated_at = now() WHERE id = v_wallet.id;

  INSERT INTO public.transactions (
    user_id, wallet_id, amount, credits, type, status, reference, provider, description, metadata
  ) VALUES (
    v_order.user_id, v_wallet.id, v_order.gross_amount, v_order.credits_purchased,
    'credit', 'success', v_order.provider_reference, v_order.provider,
    'Credit purchase automatically fulfilled',
    jsonb_build_object(
      'payment_order_id', v_order.id,
      'currency', v_order.currency,
      'fee_amount', v_order.fee_amount,
      'net_amount', v_order.net_amount,
      'purpose', 'wallet_credits'
    )
  ) RETURNING id INTO v_transaction_id;

  INSERT INTO public.wallet_ledger (
    user_id, wallet_id, entry_type, credits_delta, balance_before, balance_after,
    payment_order_id, transaction_id, reason, metadata
  ) VALUES (
    v_order.user_id, v_wallet.id, 'purchase', v_order.credits_purchased,
    v_before, v_after, v_order.id, v_transaction_id, 'Verified provider payment',
    jsonb_build_object('currency', v_order.currency, 'provider', v_order.provider)
  );

  UPDATE public.payment_orders SET fulfilment_status = 'fulfilled', fulfilled_at = now(),
    failure_reason = NULL, updated_at = now() WHERE id = v_order.id;

  PERFORM public.enqueue_admin_notifications(
    'payment.fulfilled', 'info', 'payment_fulfilled', 'payment.fulfilled:' || v_order.id,
    jsonb_build_object('paymentOrderId', v_order.id, 'provider', v_order.provider,
      'amount', v_order.gross_amount, 'currency', v_order.currency,
      'credits', v_order.credits_purchased, 'userId', v_order.user_id)
  );
  RETURN jsonb_build_object('id', v_order.id, 'status', 'fulfilled',
    'alreadyFulfilled', false, 'credits', v_order.credits_purchased, 'balance', v_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_failure(
  p_payment_order_id uuid, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_order public.payment_orders%ROWTYPE;
BEGIN
  UPDATE public.payment_orders SET fulfilment_status = 'failed', failure_reason = left(p_reason, 1000),
    updated_at = now() WHERE id = p_payment_order_id RETURNING * INTO v_order;
  IF FOUND THEN
    PERFORM public.enqueue_admin_notifications(
      'payment.fulfilment_failed', 'critical', 'payment_fulfilment_failed',
      'payment.fulfilment_failed:' || v_order.id,
      jsonb_build_object('paymentOrderId', v_order.id, 'provider', v_order.provider,
        'amount', v_order.gross_amount, 'currency', v_order.currency,
        'credits', v_order.credits_purchased, 'reason', left(p_reason, 1000))
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_payment_provider_product(
  p_admin_id uuid,
  p_package_id uuid,
  p_provider text,
  p_currency text,
  p_amount numeric,
  p_external_product_id text,
  p_enabled boolean,
  p_reason text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.payment_provider_products
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_before public.payment_provider_products%ROWTYPE;
  v_after public.payment_provider_products%ROWTYPE;
  v_currency text := upper(trim(p_currency));
BEGIN
  IF NOT public.is_admin_user_id(p_admin_id) THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'An audit reason is required' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('fapshi', 'chariow') THEN
    RAISE EXCEPTION 'Unsupported payment provider' USING ERRCODE = '22023';
  END IF;
  IF v_currency IS NULL OR char_length(v_currency) <> 3 THEN
    RAISE EXCEPTION 'Currency must be ISO 4217' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_provider = 'chariow' AND p_enabled IS TRUE
     AND (p_external_product_id IS NULL OR length(trim(p_external_product_id)) = 0) THEN
    RAISE EXCEPTION 'Chariow products require an external product id before enablement'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.payment_provider_products
  WHERE package_id = p_package_id AND provider = p_provider AND currency = v_currency;

  INSERT INTO public.payment_provider_products (
    package_id, provider, currency, amount, external_product_id, enabled, metadata, updated_at
  ) VALUES (
    p_package_id, p_provider, v_currency, p_amount,
    NULLIF(trim(p_external_product_id), ''), COALESCE(p_enabled, false),
    COALESCE(p_metadata, '{}'::jsonb), now()
  )
  ON CONFLICT (package_id, provider, currency) DO UPDATE
  SET amount = EXCLUDED.amount,
      external_product_id = EXCLUDED.external_product_id,
      enabled = EXCLUDED.enabled,
      metadata = EXCLUDED.metadata,
      updated_at = now()
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id, reason, before_state, after_state
  ) VALUES (
    p_admin_id, NULL,
    CASE WHEN v_before.id IS NULL THEN 'payment_provider_product.create' ELSE 'payment_provider_product.update' END,
    'payment_provider_product', v_after.id, trim(p_reason),
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_after)
  );
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_own_payment_profile(
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_country_code text
)
RETURNS public.user_payment_profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_row public.user_payment_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_payment_profiles (
    user_id, first_name, last_name, phone_e164, country_code, updated_at
  ) VALUES (
    auth.uid(), trim(p_first_name), trim(p_last_name), trim(p_phone_e164),
    upper(trim(p_country_code)), now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      phone_e164 = EXCLUDED.phone_e164,
      country_code = EXCLUDED.country_code,
      updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_admin_notifications(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fulfill_payment_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_payment_failure(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_payment_provider_product(uuid, uuid, text, text, numeric, text, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_admin_notifications(text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_failure(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_payment_provider_product(uuid, uuid, text, text, numeric, text, boolean, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_own_payment_profile(text, text, text, text) TO authenticated, service_role;

COMMIT;
