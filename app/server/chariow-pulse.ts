// @ts-nocheck
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import {
  applyProviderStatus,
  findPaymentOrder,
  enqueuePaymentNotification,
  recordWebhookEvidence,
} from './payment-orders.js';
import { validateChariowSuccessfulSale } from './payment-validators.js';
import { dispatchNotificationOutbox } from './notification-dispatch.js';

export function verifyChariowSignature(rawBody, received, secret = process.env.CHARIOW_WEBHOOK_SECRET) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = createHmac('sha256', secret || '').update(body).digest('hex');
  const receivedHex = String(received || '').replace(/^sha256=/i, '').trim();
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(receivedHex, 'utf8');
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.readable && typeof req[Symbol.asyncIterator] === 'function' && req.body === undefined) {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw Object.assign(new Error('Raw Pulse body is unavailable'), { status: 500, code: 'RAW_BODY_MISSING' });
}

async function alreadyProcessed(deliveryId) {
  const { data } = await supabaseAdmin
    .from('payment_webhook_events')
    .select('id')
    .eq('provider', 'chariow')
    .eq('delivery_id', deliveryId)
    .maybeSingle();
  return Boolean(data);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-chariow-signature, x-pulse-delivery-id, x-pulse-event');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabaseAdmin || supabaseAdminConfigError || !process.env.CHARIOW_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Chariow Pulse is not configured' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message, code: error.code });
  }

  const signature = req.headers?.['x-chariow-signature'];
  const deliveryId = String(req.headers?.['x-pulse-delivery-id'] || '').trim();
  const headerEvent = String(req.headers?.['x-pulse-event'] || '').trim();

  if (!signature) return res.status(401).json({ error: 'Missing Pulse signature' });
  if (!deliveryId) return res.status(400).json({ error: 'Missing x-pulse-delivery-id' });
  if (!headerEvent) return res.status(400).json({ error: 'Missing x-pulse-event' });
  if (!verifyChariowSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid Pulse signature' });
  }

  if (await alreadyProcessed(deliveryId)) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const event = String(body?.event || headerEvent || '');
  const sale = body?.sale || {};
  const saleId = String(sale.id || '').trim();
  const orderId = String(sale.custom_metadata?.henshin_order_id || '').trim();

  try {
    if (event !== 'successful.sale' && event !== 'failed.sale' && event !== 'abandoned.sale') {
      await recordWebhookEvidence({
        provider: 'chariow',
        deliveryId,
        providerReference: saleId,
        signatureVerified: true,
        payload: body,
        processingStatus: 'ignored',
        processingError: `Unhandled event ${event}`,
      });
      return res.status(200).json({ ok: true, ignored: true });
    }

    const order = await findPaymentOrder({
      id: orderId || null,
      provider: 'chariow',
      providerReference: saleId || null,
    });

    if (!order) {
      await recordWebhookEvidence({
        provider: 'chariow',
        deliveryId,
        providerReference: saleId,
        signatureVerified: true,
        payload: body,
        processingStatus: 'ignored',
        processingError: 'Unknown Henshin order',
      });
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (event === 'failed.sale' || event === 'abandoned.sale') {
      await applyProviderStatus(order, event === 'failed.sale' ? 'FAILED' : 'CANCELLED', { event });
      await recordWebhookEvidence({
        provider: 'chariow',
        deliveryId,
        providerReference: saleId,
        signatureVerified: true,
        payload: body,
        processingStatus: 'processed',
      });
      await dispatchNotificationOutbox(10).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    let productMapping = null;
    if (order.provider_product_id) {
      const { data } = await supabaseAdmin
        .from('payment_provider_products')
        .select('id, external_product_id, currency, amount')
        .eq('id', order.provider_product_id)
        .maybeSingle();
      productMapping = data;
    }

    const validation = validateChariowSuccessfulSale(order, productMapping, body);
    if (!validation.ok) {
      await enqueuePaymentNotification('payment.validation_failed', 'critical', order, {
        reason: validation.reason,
        suffix: deliveryId,
      });
      await recordWebhookEvidence({
        provider: 'chariow',
        deliveryId,
        providerReference: saleId,
        signatureVerified: true,
        payload: body,
        processingStatus: 'failed',
        processingError: validation.reason,
      });
      await dispatchNotificationOutbox(10).catch(() => {});
      return res.status(validation.httpStatus || 400).json({ error: validation.reason });
    }

    // License keys from Chariow are ignored — never mutate Henshin PRO licences.
    const feeAmount = sale.settlement?.fee?.value;
    const netAmount = sale.settlement?.amount?.value;
    await applyProviderStatus(order, 'COMPLETED', {
      event,
      paidAt: sale.completed_at,
      feeAmount,
      netAmount,
      settlementCurrency: sale.settlement?.amount?.currency,
    });
    const evidenceInserted = await recordWebhookEvidence({
      provider: 'chariow',
      deliveryId,
      providerReference: saleId,
      signatureVerified: true,
      payload: body,
      processingStatus: 'processed',
    });
    if (!evidenceInserted) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    await dispatchNotificationOutbox(10).catch((error) => {
      console.error('[chariow-pulse] Notification delivery failed:', error);
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[chariow-pulse] Processing failed:', error);
    return res.status(500).json({ error: 'Pulse processing failed' });
  }
}
