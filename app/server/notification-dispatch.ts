// @ts-nocheck
import { createHmac } from 'node:crypto';
import { supabaseAdmin } from '../api/supabase.js';

function deliveryConfig(row) {
  if (row?.channel === 'whatsapp' && process.env.WHATSAPP_BAILEYS_URL) {
    if (!process.env.WHATSAPP_BAILEYS_SECRET) return { error: 'WHATSAPP_BAILEYS_SECRET is not configured' };
    return {
      url: process.env.WHATSAPP_BAILEYS_URL,
      secret: process.env.WHATSAPP_BAILEYS_SECRET,
    };
  }
  if (!process.env.NOTIFICATION_DELIVERY_WEBHOOK_URL) return { error: 'NOTIFICATION_DELIVERY_WEBHOOK_URL is not configured' };
  if (!process.env.NOTIFICATION_DELIVERY_WEBHOOK_SECRET) return { error: 'NOTIFICATION_DELIVERY_WEBHOOK_SECRET is not configured' };
  return {
    url: process.env.NOTIFICATION_DELIVERY_WEBHOOK_URL,
    secret: process.env.NOTIFICATION_DELIVERY_WEBHOOK_SECRET,
  };
}

async function deliver(row) {
  const config = deliveryConfig(row);
  if (config.error) throw new Error(config.error);
  const body = JSON.stringify({
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    channel: row.channel,
    destination: row.destination,
    template: row.template_key,
    payload: row.payload,
  });
  const signature = createHmac('sha256', config.secret).update(body).digest('hex');
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Henshin-Signature': signature },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || `Delivery gateway returned HTTP ${response.status}`);
  return String(result?.messageId || result?.id || '').slice(0, 500) || null;
}

async function syncSupportDelivery(row, status, providerMessageId = null) {
  if (row?.event_type !== 'support.admin_reply' || !row?.payload?.messageId) return;
  await supabaseAdmin.from('support_messages').update({
    whatsapp_delivery_status: status,
    whatsapp_message_id: providerMessageId,
  }).eq('id', row.payload.messageId).eq('sender_role', 'admin');
}

export async function dispatchNotificationOutbox(limit = 20) {
  const { data: rows, error } = await supabaseAdmin.from('notification_outbox').select('*')
    .in('status', ['pending', 'failed']).lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true }).limit(Math.max(1, Math.min(50, Number(limit) || 20)));
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const config = deliveryConfig(row);
    if (config.error) {
      skipped += 1;
      continue;
    }
    const attempt = Number(row.attempts || 0) + 1;
    const { data: claimed } = await supabaseAdmin.from('notification_outbox')
      .update({ status: 'sending', attempts: attempt, updated_at: new Date().toISOString() })
      .eq('id', row.id).in('status', ['pending', 'failed']).select('id').maybeSingle();
    if (!claimed) continue;
    try {
      const providerMessageId = await deliver(row);
      await supabaseAdmin.from('notification_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        last_error: null, provider_message_id: providerMessageId,
      }).eq('id', row.id);
      await syncSupportDelivery(row, 'sent', providerMessageId);
      sent += 1;
    } catch (deliveryError) {
      const dead = attempt >= 8;
      const backoffMinutes = Math.min(360, 2 ** Math.min(attempt, 8));
      await supabaseAdmin.from('notification_outbox').update({
        status: dead ? 'dead_letter' : 'failed',
        last_error: String(deliveryError?.message || deliveryError).slice(0, 1000),
        next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      await syncSupportDelivery(row, 'failed');
      failed += 1;
    }
  }
  return { processed: sent + failed, sent, failed, skipped, configured: skipped === 0 };
}
