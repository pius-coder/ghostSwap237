// @ts-nocheck
import { requireAuthUser, requireAuthorizedUser, sendApiError } from './auth.js';
import { getWalletByUserId } from '../server/credit-utils.js';
import { supabaseAdmin } from './supabase.js';
import fapshiInitHandler from '../server/fapshi-init.js';
import fapshiReturnHandler from '../server/fapshi-return.js';
import fapshiStatusHandler from '../server/fapshi-status.js';
import fapshiWebhookHandler from '../server/fapshi-webhook.js';
import chariowInitHandler from '../server/chariow-init.js';
import chariowPulseHandler, { readRawBody } from '../server/chariow-pulse.js';
import paymentStatusHandler from '../server/payment-status.js';
import { loadCheckoutCatalog } from '../server/payment-catalog.js';

// Pulse HMAC needs the exact raw body. All POSTs on this function parse manually.
export const config = {
  api: {
    bodyParser: false,
  },
};

async function ensureJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  if (req.rawBody || (req.body && !Buffer.isBuffer(req.body) && typeof req.body !== 'string')) {
    return;
  }
  const raw = await readRawBody(req);
  req.rawBody = raw;
  if (!raw.length) {
    req.body = {};
    return;
  }
  try {
    req.body = JSON.parse(raw.toString('utf8'));
  } catch {
    req.body = {};
  }
}

export default async function handler(req, res) {
  const action = String(req.query?.action || '');

  // Dedicated Pulse path: keep raw bytes, do not reshape for signature.
  if (action === 'chariow-pulse') {
    if (!req.rawBody && (Buffer.isBuffer(req.body) || typeof req.body === 'string' || req.body === undefined)) {
      try {
        req.rawBody = await readRawBody(req);
      } catch (error) {
        return res.status(error.status || 500).json({ error: error.message, code: error.code });
      }
    }
    return chariowPulseHandler(req, res);
  }

  await ensureJsonBody(req);

  if (action === 'fapshi-init') return fapshiInitHandler(req, res);
  if (action === 'fapshi-return') return fapshiReturnHandler(req, res);
  if (action === 'fapshi-status') return fapshiStatusHandler(req, res);
  if (action === 'fapshi-webhook') return fapshiWebhookHandler(req, res);
  if (action === 'chariow-init') return chariowInitHandler(req, res);
  if (action === 'payment-status') return paymentStatusHandler(req, res);
  if (action === 'catalog') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
      await requireAuthUser(req);
      const packages = await loadCheckoutCatalog();
      return res.json({ packages });
    } catch (error) {
      return sendApiError(res, error, 'Could not load credit packages.');
    }
  }
  if (action === 'payment-profile') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const { userId } = await requireAuthorizedUser(req, String(req.query?.userId || '').trim());
      const { data, error } = await supabaseAdmin
        .from('user_payment_profiles')
        .select('first_name, last_name, phone_e164, country_code, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return res.json({
        profile: data
          ? {
              firstName: data.first_name,
              lastName: data.last_name,
              phoneE164: data.phone_e164,
              countryCode: data.country_code,
              updatedAt: data.updated_at,
            }
          : null,
      });
    } catch (error) {
      return sendApiError(res, error, 'Could not load payment profile.');
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = String(req.query?.userId || '').trim();
  try {
    await requireAuthorizedUser(req, userId);

    const [wallet, transactionsResult, sessionsResult] = await Promise.all([
      getWalletByUserId(userId, { createIfMissing: true }),
      supabaseAdmin
        .from('transactions')
        .select('id, type, amount, credits, description, status, provider, reference, session_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('sessions')
        .select('id, provider, provider_session_id, start_time, end_time, seconds_used, credits_per_second, credits_used, status, end_reason, model')
        .eq('user_id', userId)
        .order('start_time', { ascending: false })
        .limit(50),
    ]);

    if (transactionsResult.error) throw transactionsResult.error;
    if (sessionsResult.error) throw sessionsResult.error;

    return res.json({
      credits: wallet.credits,
      remainingSeconds: Math.floor(wallet.credits / 2),
      fastRemainingSeconds: Math.floor(wallet.credits / 2),
      transactions: (transactionsResult.data || []).map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: Number(transaction.amount || 0),
        credits: Number(transaction.credits || 0),
        description: transaction.description,
        status: transaction.status,
        provider: transaction.provider,
        reference: transaction.reference,
        sessionId: transaction.session_id,
        timestamp: transaction.created_at,
      })),
      sessions: (sessionsResult.data || []).map((session) => ({
        id: session.id,
        provider: session.provider,
        providerSessionId: session.provider_session_id,
        date: session.start_time,
        duration: Number(session.seconds_used || 0),
        rate: Number(session.credits_per_second || 0),
        credits: Number(session.credits_used || 0),
        status: session.status,
        reason: session.end_reason,
        model: session.model,
      })),
    });
  } catch (error) {
    return sendApiError(res, error, 'Failed to fetch wallet');
  }
}
