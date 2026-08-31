// @ts-nocheck
// GET /api/payment/fapshi-status
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import {
  fapshiConfigError,
  fapshiRequest,
  normalizeFapshiStatus,
} from './fapshi-client.js';
import { authorizedUserIds, requireAuthUser, sendApiError } from '../api/auth.js';
import { applyProviderStatus, enqueuePaymentNotification } from './payment-orders.js';
import { validateFapshiSettlement } from './payment-validators.js';
import { publicOrderView } from './payment-catalog.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const adminError = supabaseAdminConfigError || fapshiConfigError();
  if (!supabaseAdmin || adminError) {
    return res.status(503).json({ error: adminError || 'Payments are not configured' });
  }

  const paymentId = String(req.query?.ref || '').trim();
  const transId = String(req.query?.transId || '').trim();
  if (!paymentId && !transId) {
    return res.status(400).json({ error: 'A payment reference is required.' });
  }

  try {
    const authUser = await requireAuthUser(req);
    let query = supabaseAdmin.from('payment_orders').select('*').eq('provider', 'fapshi').limit(1);
    query = paymentId ? query.eq('id', paymentId) : query.eq('provider_reference', transId);
    const { data: payment, error: lookupError } = await query.maybeSingle();
    if (lookupError) return res.status(500).json({ error: 'Could not load the payment.' });
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });

    const allowedUserIds = await authorizedUserIds(authUser);
    if (!allowedUserIds.includes(payment.user_id)) {
      return res.status(403).json({ error: 'This payment belongs to another account.' });
    }

    const storedStatus = normalizeFapshiStatus(payment.provider_status);
    if (storedStatus === 'SUCCESSFUL' && payment.fulfilment_status !== 'fulfilled') {
      const settlement = await applyProviderStatus(payment, storedStatus, { reconciliation: true });
      return res.json({
        ...publicOrderView(settlement.order),
        transId: payment.provider_reference,
      });
    }

    const isSettled =
      storedStatus === 'SUCCESSFUL' ||
      storedStatus === 'FAILED' ||
      storedStatus === 'EXPIRED' ||
      payment.status !== 'pending' ||
      payment.fulfilment_status === 'fulfilled';

    if (isSettled || !payment.provider_reference) {
      return res.json({ ...publicOrderView(payment), transId: payment.provider_reference });
    }

    let remote;
    try {
      remote = await fapshiRequest(`/payment-status/${encodeURIComponent(payment.provider_reference)}`);
    } catch (statusError) {
      console.error('[fapshi-status] Remote status failed:', statusError);
      return res.json({ ...publicOrderView(payment), transId: payment.provider_reference });
    }

    const providerStatus = normalizeFapshiStatus(remote?.status);
    const validationPayload = {
      transId: payment.provider_reference,
      externalId: payment.id,
      amount: remote?.amount ?? payment.gross_amount,
      currency: remote?.currency || 'XAF',
      status: providerStatus,
    };
    const validation = validateFapshiSettlement(payment, validationPayload);
    if (!validation.ok && ['SUCCESSFUL', 'FAILED', 'EXPIRED'].includes(providerStatus)) {
      await enqueuePaymentNotification('payment.validation_failed', 'critical', payment, {
        reason: validation.reason,
        suffix: `reconcile:${providerStatus}`,
      });
      return res.status(409).json({ error: validation.reason, ...publicOrderView(payment) });
    }

    const settlement = await applyProviderStatus(payment, providerStatus, {
      polling: true,
      operatorReference: remote?.operator_reference,
    });

    return res.json({
      ...publicOrderView(settlement.order),
      transId: payment.provider_reference,
      operatorReference: remote?.operator_reference || undefined,
    });
  } catch (error) {
    return sendApiError(res, error, 'Could not load the payment.');
  }
}
