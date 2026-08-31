// @ts-nocheck
import { createHmac } from 'node:crypto';
import { supabaseAdmin } from '../api/supabase.js';

function deliveryConfigError() {
  if (!process.env.NOTIFICATION_DELIVERY_WEBHOOK_URL) return 'NOTIFICATION_DELIVERY_WEBHOOK_URL is not configured';
  if (!process.env.NOTIFICATION_DELIVERY_WEBHOOK_SECRET) return 'NOTIFICATION_DELIVERY_WEBHOOK_SECRET is not configured';
  return null;
}

async function deliver(row) {
  const body = JSON.stringify({
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    channel: row.channel,
    destination: row.destination,
    template: row.template_key,
    payload: row.payload,
  });
  const signature = createHmac('sha256', process.env.NOTIFICATION_DELIVERY_WEBHOOK_SECRET).update(body).digest('hex');
  const response = await fetch(process.env.NOTIFICATION_DELIVERY_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Henshin-Signature': signature },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || `Delivery gateway returned HTTP ${response.status}`);
  return String(result?.messageId || result?.id || '').slice(0, 500) || null;
}

export async function dispatchNotificationOutbox(limit = 20) {
  const configError = deliveryConfigError();
  if (configError) return { processed: 0, sent: 0, failed: 0, configured: false, error: configError };

  const { data: rows, error } = await supabaseAdmin.from('notification_outbox').select('*')
    .in('status', ['pending', 'failed']).lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true }).limit(Math.max(1, Math.min(50, Number(limit) || 20)));
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const row of rows || []) {
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
      failed += 1;
    }
  }
  return { processed: sent + failed, sent, failed, configured: true };
}
