// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { requireAuthorizedUser, sendApiError } from '../api/auth.js';
import { attachProviderReference, createPaymentOrder, applyProviderStatus } from './payment-orders.js';
import { chariowConfigError, chariowRequest, ChariowApiError } from './chariow-client.js';
import { loadProviderProduct } from './payment-catalog.js';
import { normalizeCountryCode, normalizePersonName, normalizePhoneE164 } from './payment-phone.js';

function returnUrl(orderId) {
  const base = String(process.env.PAYMENT_RETURN_URL || process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/#/payment-success?provider=chariow&ref=${encodeURIComponent(orderId)}`;
}

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || undefined;
}

async function upsertPaymentProfile(userId, profile) {
  const { error } = await supabaseAdmin.from('user_payment_profiles').upsert({
    user_id: userId,
    first_name: profile.firstName,
    last_name: profile.lastName,
    phone_e164: profile.phoneE164,
    country_code: profile.countryCode,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const configError = supabaseAdminConfigError || chariowConfigError();
  if (!supabaseAdmin || configError) {
    return res.status(503).json({ error: configError || 'Payments are not configured' });
  }

  try {
    const packageId = String(req.body?.packageId || '').trim();
    const requestedUserId = String(req.body?.userId || '').trim();
    if (!packageId) return res.status(400).json({ error: 'A credit package is required.' });

    const { authUser, userId } = await requireAuthorizedUser(req, requestedUserId);
    const email = String(authUser.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Your account email is required for international checkout.' });

    const firstName = normalizePersonName(req.body?.firstName, 'first name');
    const lastName = normalizePersonName(req.body?.lastName, 'last name');
    const countryCode = normalizeCountryCode(req.body?.countryCode);
    const phone = normalizePhoneE164(req.body?.phone, countryCode);

    const mapping = await loadProviderProduct(packageId, 'chariow', 'USD');
    if (!mapping || mapping.credit_packages?.is_active !== true) {
      return res.status(400).json({ error: 'This package is unavailable for international payment.' });
    }
    if (mapping.enabled !== true || !mapping.external_product_id) {
      return res.status(503).json({
        error: 'International card payment is not configured yet. Please use Mobile Money or contact support.',
        code: 'CHARIOW_NOT_CONFIGURED',
      });
    }

    const amountUsd = Number(mapping.amount);
    const credits = Number(mapping.credit_packages.credits);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(credits) || credits <= 0) {
      return res.status(500).json({ error: 'The selected package has invalid pricing.' });
    }

    await upsertPaymentProfile(userId, {
      firstName,
      lastName,
      phoneE164: phone.e164,
      countryCode: phone.countryCode,
    });

    const order = await createPaymentOrder({
      userId,
      packageId: mapping.package_id,
      providerProductId: mapping.id,
      provider: 'chariow',
      grossAmount: amountUsd,
      currency: 'USD',
      credits,
      metadata: {
        chariow_product_id: mapping.external_product_id,
        package_name: mapping.credit_packages.name,
        purpose: 'wallet_credits',
        phone_e164: phone.e164,
        country_code: phone.countryCode,
      },
    });

    try {
      const checkout = await chariowRequest('/checkout', {
        method: 'POST',
        body: {
          product_id: mapping.external_product_id,
          email,
          first_name: firstName,
          last_name: lastName,
          phone: {
            number: phone.nationalNumber,
            country_code: phone.countryCode,
          },
          currency: 'USD',
          redirect_url: returnUrl(order.id),
          customer_ip: clientIp(req),
          custom_metadata: {
            henshin_order_id: order.id,
            henshin_package_id: packageId,
            purpose: 'wallet_credits',
          },
        },
      });

      const step = String(checkout?.data?.step || '').toLowerCase();
      const saleId = String(checkout?.data?.purchase?.id || '').trim();
      const checkoutUrl = String(checkout?.data?.payment?.checkout_url || '').trim();

      if (step === 'already_purchased') {
        await supabaseAdmin.from('payment_orders').update({
          status: 'failed',
          failure_reason: 'Chariow already_purchased — use License product type for repeat credit packs',
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);
        return res.status(409).json({
          error: 'This Chariow product cannot be purchased again. Operator must use License-type products.',
          code: 'CHARIOW_ALREADY_PURCHASED',
        });
      }

      if (!saleId) {
        throw new ChariowApiError('Chariow returned an incomplete checkout.', { code: 'CHARIOW_INCOMPLETE' });
      }

      await attachProviderReference(order.id, saleId, String(checkout?.data?.purchase?.status || 'AWAITING_PAYMENT').toUpperCase());

      if (step === 'completed') {
        // Free / instantly completed checkout — still requires Pulse for fees, but
        // we can mark paid only after confirming amount matches our frozen order.
        const paidAmount = checkout?.data?.purchase?.amount?.value;
        const paidCurrency = checkout?.data?.purchase?.amount?.currency;
        if (Number(paidAmount) === Number(order.gross_amount) && String(paidCurrency || '').toUpperCase() === 'USD') {
          await applyProviderStatus({ ...order, provider_reference: saleId }, 'COMPLETED', {
            event: 'checkout.completed',
            paidAt: new Date().toISOString(),
          });
        }
        return res.status(201).json({
          paymentId: order.id,
          saleId,
          step: 'completed',
          amount: amountUsd,
          currency: 'USD',
          credits,
        });
      }

      if (step !== 'payment' || !checkoutUrl) {
        throw new ChariowApiError('Chariow returned an incomplete checkout.', { code: 'CHARIOW_INCOMPLETE' });
      }

      return res.status(201).json({
        paymentId: order.id,
        saleId,
        step: 'payment',
        link: checkoutUrl,
        amount: amountUsd,
        currency: 'USD',
        credits,
      });
    } catch (checkoutError) {
      await supabaseAdmin.from('payment_orders').update({
        status: 'failed',
        failure_reason: String(checkoutError?.message || checkoutError).slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      throw checkoutError;
    }
  } catch (error) {
    if (error?.status && error?.message) {
      return res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    }
    return sendApiError(res, error, 'Could not start international payment.');
  }
}
