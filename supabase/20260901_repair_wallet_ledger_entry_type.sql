-- Standalone repair for databases where an earlier partial finance migration
-- left wallet_ledger with an obsolete entry_type CHECK constraint.
BEGIN;

DO $$
DECLARE
  constraint_row record;
BEGIN
  IF to_regclass('public.wallet_ledger') IS NULL THEN
    RAISE EXCEPTION 'public.wallet_ledger does not exist';
  END IF;

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
  )) NOT VALID;

ALTER TABLE public.wallet_ledger
  VALIDATE CONSTRAINT wallet_ledger_entry_type_check;

COMMIT;

SELECT
  constraint_record.conname AS constraint_name,
  pg_catalog.pg_get_constraintdef(constraint_record.oid) AS definition
FROM pg_catalog.pg_constraint AS constraint_record
WHERE constraint_record.conrelid = 'public.wallet_ledger'::regclass
  AND constraint_record.conname = 'wallet_ledger_entry_type_check';
