// @ts-nocheck
// POST /api/payment/fapshi-init
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { requireAuthorizedUser, sendApiError } from '../api/auth.js';
import { fapshiConfigError, fapshiRequest } from './fapshi-client.js';
import { attachProviderReference, createPaymentOrder } from './payment-orders.js';
import { loadProviderProduct } from './payment-catalog.js';

function appPublicUrl() {
  const raw = process.env.PAYMENT_RETURN_URL || process.env.APP_PUBLIC_URL || 'http://localhost:5173';
  return String(raw).replace(/\/+$/, '');
}

function paymentReturnUrl(paymentId, returnToApp) {
  if (returnToApp) {
    const bridge = new URL(
      process.env.FAPSHI_APP_RETURN_URL ||
        'https://henshin.numzer0.store/api/payment/fapshi-return',
    );
    if (bridge.protocol !== 'https:') {
      throw new Error('FAPSHI_APP_RETURN_URL must use HTTPS.');
    }
    bridge.searchParams.set('ref', paymentId);
    return bridge.toString();
  }

  const base = appPublicUrl();
  const separator = base.includes('#') ? (base.includes('?') ? '&' : '?') : '/#/payment-success?';
  return `${base}${separator}ref=${encodeURIComponent(paymentId)}&provider=fapshi`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminError = supabaseAdminConfigError || fapshiConfigError();
  if (!supabaseAdmin || adminError) {
    return res.status(503).json({ error: adminError || 'Payments are not configured' });
  }

  const packageId = String(req.body?.packageId || '').trim();
  const requestedUserId = String(req.body?.userId || '').trim();
  const returnToApp = req.body?.returnToApp === true;
  if (!packageId) return res.status(400).json({ error: 'A credit package is required.' });

  try {
    const { authUser, userId: billingUserId } = await requireAuthorizedUser(req, requestedUserId);
    const mapping = await loadProviderProduct(packageId, 'fapshi', 'XAF');
    if (!mapping || mapping.enabled !== true || mapping.credit_packages?.is_active !== true) {
      return res.status(400).json({ error: 'This package is unavailable for Mobile Money payment.' });
    }

    const amountXaf = Math.round(Number(mapping.amount));
    const credits = Number(mapping.credit_packages.credits);
    if (!Number.isFinite(amountXaf) || amountXaf < 100 || !Number.isFinite(credits) || credits <= 0) {
      return res.status(500).json({ error: 'The selected package has invalid pricing.' });
    }

    const payment = await createPaymentOrder({
      userId: billingUserId,
      packageId: mapping.package_id,
      providerProductId: mapping.id,
      provider: 'fapshi',
      grossAmount: amountXaf,
      currency: 'XAF',
      credits,
      metadata: {
        returnToApp,
        package_name: mapping.credit_packages.name,
        purpose: 'wallet_credits',
      },
    });

    let initiated;
    try {
      initiated = await fapshiRequest('/initiate-pay', {
        method: 'POST',
        body: {
          amount: amountXaf,
          email: authUser.email || undefined,
          userId: billingUserId,
          externalId: payment.id,
          message: `Henshin ${credits.toLocaleString('en-US')} credits`,
          redirectUrl: paymentReturnUrl(payment.id, returnToApp),
        },
      });
    } catch (initError) {
      await supabaseAdmin.from('payment_orders').update({
        status: 'failed',
        failure_reason: 'Fapshi initiation failed',
        updated_at: new Date().toISOString(),
      }).eq('id', payment.id);
      console.error('[fapshi-init] Initiate failed:', initError);
      return res.status(502).json({
        error: initError?.message || 'Could not create the checkout. Please try again.',
      });
    }

    const transId = String(initiated?.transId || '').trim();
    if (!transId || !initiated?.link) {
      await supabaseAdmin.from('payment_orders').update({
        status: 'failed',
        failure_reason: 'Invalid Fapshi response',
        updated_at: new Date().toISOString(),
      }).eq('id', payment.id);
      return res.status(502).json({ error: 'The payment gateway returned an invalid response.' });
    }

    try {
      await attachProviderReference(payment.id, transId);
    } catch (referenceError) {
      console.error('[fapshi-init] Could not store transaction reference:', referenceError);
      await supabaseAdmin.from('payment_orders').update({
        fulfilment_status: 'failed',
        failure_reason: 'Could not persist Fapshi reference',
        updated_at: new Date().toISOString(),
      }).eq('id', payment.id);
      return res.status(500).json({
        error: 'Could not save the payment reference. Please start a new payment.',
      });
    }

    return res.status(201).json({
      paymentId: payment.id,
      transId,
      link: initiated.link,
      amount: amountXaf,
      currency: 'XAF',
      credits,
    });
  } catch (error) {
    return sendApiError(res, error, 'Could not start the payment.');
  }
}
