// @ts-nocheck
import { supabaseAdmin } from '../api/supabase.js';
import { authorizedUserIds, requireAuthUser, sendApiError } from '../api/auth.js';
import { publicOrderView } from './payment-catalog.js';
import { applyProviderStatus } from './payment-orders.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authUser = await requireAuthUser(req);
    const paymentId = String(req.query?.ref || '').trim();
    const provider = String(req.query?.provider || 'chariow').trim().toLowerCase();
    if (!paymentId) return res.status(400).json({ error: 'A payment reference is required.' });
    if (!['fapshi', 'chariow'].includes(provider)) {
      return res.status(400).json({ error: 'Unsupported payment provider.' });
    }

    const { data: payment, error } = await supabaseAdmin
      .from('payment_orders')
      .select('*')
      .eq('id', paymentId)
      .eq('provider', provider)
      .maybeSingle();
    if (error) throw error;
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    if (!(await authorizedUserIds(authUser)).includes(payment.user_id)) {
      return res.status(403).json({ error: 'This payment belongs to another account.' });
    }

    // If paid but not fulfilled, retry fulfilment (missed webhook / outbox).
    if (payment.status === 'paid' && payment.fulfilment_status !== 'fulfilled') {
      const settlement = await applyProviderStatus(payment, payment.provider_status || 'COMPLETED', {
        reconciliation: true,
      });
      return res.json(publicOrderView(settlement.order));
    }

    return res.json(publicOrderView(payment));
  } catch (error) {
    return sendApiError(res, error, 'Could not load the payment.');
  }
}
