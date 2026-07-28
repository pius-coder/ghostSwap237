// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';

const PAYMENT_QR_BUCKET = 'payment-qr-codes';

function storagePrefix(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function attachUnlinkedQrImages(methods) {
  const needsFallback = methods.some((method) => !method.qr_code_url);
  if (!needsFallback) return methods;

  const { data: files, error } = await supabaseAdmin.storage
    .from(PAYMENT_QR_BUCKET)
    .list('', {
      limit: 200,
      offset: 0,
      sortBy: { column: 'updated_at', order: 'desc' },
    });

  if (error) {
    console.warn('[payment-methods] Could not list QR images:', error.message);
    return methods;
  }

  return methods.map((method) => {
    if (method.qr_code_url) return method;

    const prefix = `${storagePrefix(method.crypto_currency)}-${storagePrefix(method.network)}-`;
    const matchingFile = (files || []).find((file) =>
      file.name.toLowerCase().startsWith(prefix),
    );

    if (!matchingFile) return method;

    const { data } = supabaseAdmin.storage
      .from(PAYMENT_QR_BUCKET)
      .getPublicUrl(matchingFile.name);

    return {
      ...method,
      qr_code_url: data.publicUrl,
      updated_at: matchingFile.updated_at || method.updated_at,
    };
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({
      error: supabaseAdminConfigError || 'Payment details are not configured.',
    });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('payment_methods')
      .select(
        'id, name, crypto_currency, network, wallet_address, qr_code_url, instructions, is_active, sort_order, created_at, updated_at',
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[payment-methods] Query failed:', error);
      return res.status(500).json({ error: 'Could not load payment details.' });
    }

    const paymentMethods = await attachUnlinkedQrImages(data || []);
    return res.status(200).json({ paymentMethods });
  } catch (error) {
    console.error('[payment-methods] Unexpected error:', error);
    return res.status(500).json({ error: 'Could not load payment details.' });
  }
}
