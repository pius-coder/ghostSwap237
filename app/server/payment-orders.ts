// @ts-nocheck
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../api/supabase.js';

export function paymentPayloadHash(payload) {
  return createHash('sha256').update(typeof payload === 'string' ? payload : JSON.stringify(payload || {})).digest('hex');
}

export async function createPaymentOrder({
  userId,
  packageId,
  providerProductId,
  provider,
  grossAmount,
  currency,
  credits,
  metadata = {},
}) {
  const { data, error } = await supabaseAdmin.from('payment_orders').insert({
    user_id: userId,
    package_id: packageId,
    provider_product_id: providerProductId || null,
    provider,
    gross_amount: grossAmount,
    currency: String(currency).toUpperCase(),
    credits_purchased: credits,
    provider_status: 'CREATED',
    status: 'pending',
    fulfilment_status: 'pending',
    metadata,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function attachProviderReference(orderId, providerReference, providerStatus = 'PENDING') {
  const { data, error } = await supabaseAdmin.from('payment_orders').update({
    provider_reference: providerReference,
    provider_status: providerStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId).eq('status', 'pending').select('*').single();
  if (error) throw error;
  return data;
}

export async function findPaymentOrder({ id, provider, providerReference }) {
  let query = supabaseAdmin.from('payment_orders').select('*').eq('provider', provider).limit(1);
  query = id ? query.eq('id', id) : query.eq('provider_reference', providerReference);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function enqueuePaymentNotification(eventType, severity, order, extra = {}) {
  await supabaseAdmin.rpc('enqueue_admin_notifications', {
    p_event_type: eventType,
    p_severity: severity,
    p_template_key: eventType.replace(/\./g, '_'),
    p_dedupe_key: `${eventType}:${order.id}:${extra.suffix || 'default'}`,
    p_payload: {
      paymentOrderId: order.id,
      provider: order.provider,
      amount: order.gross_amount,
      currency: order.currency,
      credits: order.credits_purchased,
      userId: order.user_id,
      ...extra,
    },
  });
}

export async function applyProviderStatus(order, providerStatus, details = {}) {
  const normalized = String(providerStatus || '').toUpperCase();
  const paid = ['SUCCESSFUL', 'PAID', 'COMPLETED'].includes(normalized);
  const status = paid ? 'paid'
    : ['FAILED', 'CANCELLED'].includes(normalized) ? 'failed'
      : normalized === 'EXPIRED' ? 'expired'
        : normalized === 'REFUNDED' ? 'refunded'
          : ['DISPUTED', 'CHARGEBACK'].includes(normalized) ? 'disputed' : 'pending';

  const feeAmount = details.feeAmount;
  const netAmount = details.netAmount;
  const update = {
    provider_status: normalized || 'UNKNOWN',
    status,
    updated_at: new Date().toISOString(),
    metadata: { ...(order.metadata || {}), last_provider_event: details.event || details },
  };
  if (paid) update.paid_at = details.paidAt || new Date().toISOString();
  // Only persist fees when the provider actually reports them.
  if (feeAmount != null && Number.isFinite(Number(feeAmount))) update.fee_amount = Number(feeAmount);
  if (netAmount != null && Number.isFinite(Number(netAmount))) update.net_amount = Number(netAmount);

  const { data: updated, error } = await supabaseAdmin.from('payment_orders')
    .update(update).eq('id', order.id).select('*').single();
  if (error) throw error;

  if (status === 'refunded') {
    await enqueuePaymentNotification('payment.refunded', 'critical', updated);
  } else if (status === 'disputed') {
    await enqueuePaymentNotification('payment.disputed', 'critical', updated);
  }

  if (!paid) return { order: updated, fulfilment: null };

  await enqueuePaymentNotification('payment.succeeded', 'info', updated);

  const { data: fulfilment, error: fulfilmentError } = await supabaseAdmin
    .rpc('fulfill_payment_order', { p_payment_order_id: order.id });
  if (fulfilmentError) {
    await supabaseAdmin.rpc('record_payment_failure', {
      p_payment_order_id: order.id,
      p_reason: fulfilmentError.message || 'Unknown fulfilment error',
    });
    throw fulfilmentError;
  }
  return { order: { ...updated, fulfilment_status: 'fulfilled' }, fulfilment };
}

export async function recordWebhookEvidence({
  provider,
  deliveryId,
  providerReference,
  signatureVerified,
  payload,
  processingStatus,
  processingError = null,
}) {
  const { error } = await supabaseAdmin.from('payment_webhook_events').insert({
    provider,
    delivery_id: deliveryId,
    provider_reference: providerReference || null,
    signature_verified: signatureVerified,
    payload_sha256: paymentPayloadHash(payload),
    payload: typeof payload === 'string' ? { raw: payload } : (payload || {}),
    processing_status: processingStatus,
    processing_error: processingError ? String(processingError).slice(0, 1000) : null,
    processed_at: new Date().toISOString(),
  });
  if (error?.code === '23505') return false;
  if (error) throw error;
  return true;
}

export async function recordValidationFailure(order, reason, deliveryId, provider, payload) {
  if (order) {
    await enqueuePaymentNotification('payment.validation_failed', 'critical', order, {
      reason,
      suffix: deliveryId || reason,
    });
  } else {
    await supabaseAdmin.rpc('enqueue_admin_notifications', {
      p_event_type: 'payment.validation_failed',
      p_severity: 'critical',
      p_template_key: 'payment_validation_failed',
      p_dedupe_key: `payment.validation_failed:${provider}:${deliveryId || reason}`,
      p_payload: { provider, reason, deliveryId },
    }).catch(() => {});
  }
  await recordWebhookEvidence({
    provider,
    deliveryId: deliveryId || `validation:${Date.now()}`,
    providerReference: order?.provider_reference || null,
    signatureVerified: true,
    payload,
    processingStatus: 'failed',
    processingError: reason,
  });
}
