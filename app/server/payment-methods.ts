// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';

const PAYMENT_METHOD_COLUMNS =
  'id, name, crypto_currency, network, wallet_address, qr_code_url, instructions, is_active, sort_order, created_at, updated_at';
const PAYMENT_METHOD_BACKUP_BUCKET = 'admin-config-backups';
const PAYMENT_METHOD_BACKUP_PATH = 'payment-methods/current.json';

function bearerToken(req) {
  const authorization = String(req.headers?.authorization || '');
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

async function requireAdmin(req, res) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return null;
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (accountError) {
    console.error('[payment-methods] Admin lookup failed:', accountError);
    res.status(500).json({ error: 'Could not verify administrator access.' });
    return null;
  }

  if (!account?.is_admin) {
    res.status(403).json({ error: 'Administrator access required.' });
    return null;
  }

  return user;
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optionalText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function paymentMethodValues(body) {
  return {
    name: requiredText(body?.name, 'Name'),
    crypto_currency: requiredText(body?.crypto_currency, 'Currency').toUpperCase(),
    network: requiredText(body?.network, 'Network'),
    wallet_address: requiredText(body?.wallet_address, 'Wallet address'),
    qr_code_url: optionalText(body?.qr_code_url),
    instructions: optionalText(body?.instructions),
    is_active: body?.is_active !== false,
  };
}

async function listPaymentMethods(includeInactive) {
  let query = supabaseAdmin
    .from('payment_methods')
    .select(PAYMENT_METHOD_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (!includeInactive) query = query.eq('is_active', true);
  return query;
}

async function nextSortOrder() {
  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Number.isFinite(data?.sort_order) ? data.sort_order + 1 : 0;
}

function paymentMethodBackupRow(method) {
  return {
    id: method.id,
    name: method.name,
    crypto_currency: method.crypto_currency,
    network: method.network,
    wallet_address: method.wallet_address,
    qr_code_url: method.qr_code_url || null,
    instructions: method.instructions || null,
    is_active: method.is_active !== false,
    sort_order: Number.isFinite(method.sort_order) ? method.sort_order : 0,
    created_at: method.created_at,
  };
}

async function ensureBackupBucket() {
  const { error: lookupError } = await supabaseAdmin.storage.getBucket(
    PAYMENT_METHOD_BACKUP_BUCKET,
  );
  if (!lookupError) return;

  const { error: createError } = await supabaseAdmin.storage.createBucket(
    PAYMENT_METHOD_BACKUP_BUCKET,
    {
      public: false,
      fileSizeLimit: 1_048_576,
      allowedMimeTypes: ['application/json'],
    },
  );

  if (
    createError &&
    !/already exists|duplicate/i.test(String(createError.message || ''))
  ) {
    throw createError;
  }
}

async function readPaymentMethodBackup() {
  const { data, error } = await supabaseAdmin.storage
    .from(PAYMENT_METHOD_BACKUP_BUCKET)
    .download(PAYMENT_METHOD_BACKUP_PATH);

  if (error) {
    if (/not found|does not exist/i.test(String(error.message || ''))) return [];
    throw error;
  }

  const backup = JSON.parse(await data.text());
  return Array.isArray(backup?.paymentMethods)
    ? backup.paymentMethods.map(paymentMethodBackupRow)
    : [];
}

async function writePaymentMethodBackup() {
  await ensureBackupBucket();

  const { data, error } = await listPaymentMethods(true);
  if (error) throw error;

  const payload = JSON.stringify({
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    paymentMethods: (data || []).map(paymentMethodBackupRow),
  });
  const { error: uploadError } = await supabaseAdmin.storage
    .from(PAYMENT_METHOD_BACKUP_BUCKET)
    .upload(PAYMENT_METHOD_BACKUP_PATH, new Blob([payload], { type: 'application/json' }), {
      contentType: 'application/json',
      upsert: true,
    });

  if (uploadError) throw uploadError;
}

function comparablePaymentMethod(method) {
  const row = paymentMethodBackupRow(method);
  delete row.created_at;
  return JSON.stringify(row);
}

export function planPaymentMethodReconciliation(backup, current, now = Date.now()) {
  const currentById = new Map((current || []).map((method) => [method.id, method]));
  const backupIds = new Set((backup || []).map((method) => method.id));
  const missingOrChanged = (backup || []).filter((method) => {
    const saved = currentById.get(method.id);
    if (!saved) return true;

    const lastChangedAt = new Date(saved.updated_at || saved.created_at).getTime();
    const isRecentChange = now - lastChangedAt < 60_000;
    return (
      !isRecentChange &&
      comparablePaymentMethod(saved) !== comparablePaymentMethod(method)
    );
  });
  const unexpectedActive = (current || []).filter(
    (method) =>
      !backupIds.has(method.id) &&
      method.is_active &&
      now - new Date(method.created_at).getTime() >= 60_000,
  );

  return { missingOrChanged, unexpectedActive };
}

async function recordPaymentMethodRecovery({ restoredMethods, deactivatedMethods }) {
  const path = `payment-methods/recoveries/${Date.now()}.json`;
  const payload = JSON.stringify({
    recoveredAt: new Date().toISOString(),
    restoredIds: restoredMethods.map((method) => method.id),
    restoredNames: restoredMethods.map((method) => method.name),
    deactivatedUnexpectedIds: deactivatedMethods.map((method) => method.id),
    deactivatedUnexpectedNames: deactivatedMethods.map((method) => method.name),
  });
  const { error } = await supabaseAdmin.storage
    .from(PAYMENT_METHOD_BACKUP_BUCKET)
    .upload(path, new Blob([payload], { type: 'application/json' }), {
      contentType: 'application/json',
      upsert: false,
    });

  if (error) {
    console.error('[payment-methods] Could not record recovery event:', error);
  }
}

async function restoreMissingPaymentMethods() {
  const backup = await readPaymentMethodBackup();
  if (backup.length === 0) return 0;

  const { data: current, error: currentError } = await listPaymentMethods(true);
  if (currentError) throw currentError;

  const { missingOrChanged, unexpectedActive } =
    planPaymentMethodReconciliation(backup, current || []);

  if (missingOrChanged.length > 0) {
    const { error: restoreError } = await supabaseAdmin
      .from('payment_methods')
      .upsert(missingOrChanged, { onConflict: 'id' });
    if (restoreError) throw restoreError;
  }

  if (unexpectedActive.length > 0) {
    const { error: deactivateError } = await supabaseAdmin
      .from('payment_methods')
      .update({ is_active: false })
      .in('id', unexpectedActive.map((method) => method.id));
    if (deactivateError) throw deactivateError;
  }

  if (missingOrChanged.length > 0 || unexpectedActive.length > 0) {
    console.warn(
      `[payment-methods] Reconciled supervisor backup: restored ${missingOrChanged.length}, deactivated ${unexpectedActive.length} unexpected payment method(s).`,
    );
    await recordPaymentMethodRecovery({
      restoredMethods: missingOrChanged,
      deactivatedMethods: unexpectedActive,
    });
  }

  return missingOrChanged.length + unexpectedActive.length;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabaseAdmin) {
    return res.status(503).json({
      error: supabaseAdminConfigError || 'Payment details are not configured.',
    });
  }

  try {
    if (req.method === 'GET') {
      const includeInactive = String(req.query?.includeInactive || '').toLowerCase() === 'true';
      if (includeInactive && !(await requireAdmin(req, res))) return;

      try {
        await restoreMissingPaymentMethods();
      } catch (recoveryError) {
        console.error('[payment-methods] Recovery check failed:', recoveryError);
      }

      const { data, error } = await listPaymentMethods(includeInactive);
      if (error) {
        console.error('[payment-methods] Query failed:', error);
        return res.status(500).json({ error: 'Could not load payment details.' });
      }

      return res.status(200).json({ paymentMethods: data || [] });
    }

    if (req.method !== 'POST' && req.method !== 'PATCH') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!(await requireAdmin(req, res))) return;

    const values = paymentMethodValues(req.body);
    let result;

    if (req.method === 'POST') {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('payment_methods')
        .select(PAYMENT_METHOD_COLUMNS)
        .eq('crypto_currency', values.crypto_currency)
        .eq('network', values.network)
        .eq('wallet_address', values.wallet_address)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        return res.status(409).json({
          error: 'This wallet is already stored. Edit the existing payment method instead.',
          paymentMethod: existing,
        });
      }

      const sortOrder = await nextSortOrder();
      result = await supabaseAdmin
        .from('payment_methods')
        .insert({ ...values, sort_order: sortOrder })
        .select(PAYMENT_METHOD_COLUMNS)
        .single();
    } else {
      const id = requiredText(req.body?.id, 'Payment method id');
      result = await supabaseAdmin
        .from('payment_methods')
        .update(values)
        .eq('id', id)
        .select(PAYMENT_METHOD_COLUMNS)
        .single();
    }

    if (result.error) {
      console.error('[payment-methods] Save failed:', result.error);
      return res.status(500).json({ error: 'Could not save the payment method.' });
    }

    try {
      await writePaymentMethodBackup();
    } catch (backupError) {
      console.error('[payment-methods] Could not update the private supervisor backup:', backupError);
    }

    return res.status(req.method === 'POST' ? 201 : 200).json({
      paymentMethod: result.data,
    });
  } catch (error) {
    console.error('[payment-methods] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Could not save the payment method.';
    const isValidationError = / required\.$/.test(message);
    return res.status(isValidationError ? 400 : 500).json({ error: message });
  }
}
