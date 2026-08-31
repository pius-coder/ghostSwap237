// @ts-nocheck
// POST /api/payment/fapshi-webhook
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { timingSafeEqual } from 'node:crypto';
import { normalizeFapshiStatus } from './fapshi-client.js';
import {
  applyProviderStatus,
  findPaymentOrder,
  recordValidationFailure,
  recordWebhookEvidence,
} from './payment-orders.js';
import { validateFapshiSettlement } from './payment-validators.js';
import { dispatchNotificationOutbox } from './notification-dispatch.js';

function webhookSecretConfigured() {
  return Boolean(process.env.FAPSHI_WEBHOOK_SECRET);
}

function isExpectedSecret(expected, received) {
  const expectedBuffer = Buffer.from(String(expected || ''));
  const receivedBuffer = Buffer.from(String(received || ''));
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wh-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabaseAdmin || supabaseAdminConfigError) {
    return res.status(503).json({ error: 'Payments are not configured' });
  }
  if (!webhookSecretConfigured()) {
    console.error('[fapshi-webhook] FAPSHI_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'Webhook is not configured' });
  }

  const signature = String(req.headers?.['x-wh-secret'] || '');
  if (!isExpectedSecret(process.env.FAPSHI_WEBHOOK_SECRET, signature)) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const transId = String(req.body?.transId || '').trim();
  const externalId = String(req.body?.externalId || '').trim();
  const providerStatus = normalizeFapshiStatus(req.body?.status);
  const deliveryId = transId || externalId || `fapshi:${Date.now()}`;

  if (!transId && !externalId) {
    return res.status(400).json({ error: 'Missing transId or externalId' });
  }
  if (!['SUCCESSFUL', 'FAILED', 'EXPIRED'].includes(providerStatus)) {
    return res.status(400).json({ error: 'Unsupported payment status' });
  }

  try {
    const payment = await findPaymentOrder({
      id: externalId || null,
      provider: 'fapshi',
      providerReference: transId || null,
    });
    if (!payment) {
      await recordWebhookEvidence({
        provider: 'fapshi',
        deliveryId,
        providerReference: transId,
        signatureVerified: true,
        payload: req.body,
        processingStatus: 'ignored',
        processingError: 'Unknown payment',
      });
      return res.status(200).json({ ok: true, ignored: true });
    }

    const validation = validateFapshiSettlement(payment, req.body);
    if (!validation.ok) {
      await recordValidationFailure(payment, validation.reason, deliveryId, 'fapshi', req.body);
      await dispatchNotificationOutbox(10).catch(() => {});
      return res.status(validation.httpStatus).json({ error: validation.reason });
    }

    const inserted = await recordWebhookEvidence({
      provider: 'fapshi',
      deliveryId,
      providerReference: transId,
      signatureVerified: true,
      payload: req.body,
      processingStatus: 'processed',
    });
    if (!inserted) {
      // Duplicate delivery — already processed.
      return res.status(200).json({ ok: true, duplicate: true });
    }

    await applyProviderStatus(payment, providerStatus, { webhook: req.body });
    await dispatchNotificationOutbox(10).catch((deliveryError) => {
      console.error('[fapshi-webhook] Notification dispatch failed:', deliveryError);
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[fapshi-webhook] Unexpected error:', error);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
