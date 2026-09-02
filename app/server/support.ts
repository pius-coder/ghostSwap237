// @ts-nocheck
import { requireAuthUser, sendApiError } from '../api/auth.js';
import { supabaseAdmin } from '../api/supabase.js';
import { dispatchNotificationOutbox } from './notification-dispatch.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
}

async function loadOwnSupport(userId, requestedThreadId = '') {
  const { data: threads, error: threadError } = await supabaseAdmin
    .from('support_threads')
    .select('*')
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .limit(20);
  if (threadError) throw threadError;

  const selected = requestedThreadId
    ? (threads || []).find((thread) => thread.id === requestedThreadId)
    : (threads || [])[0];
  let messages = [];
  if (selected) {
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('id, thread_id, sender_role, body, channel, whatsapp_delivery_status, created_at')
      .eq('thread_id', selected.id)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    messages = data || [];
    await supabaseAdmin.from('support_threads')
      .update({ client_read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', selected.id)
      .eq('user_id', userId);
  }

  return { threads: threads || [], thread: selected || null, messages };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const authUser = await requireAuthUser(req);

    if (req.method === 'GET') {
      return res.json(await loadOwnSupport(authUser.id, String(req.query?.threadId || '').trim()));
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || 'send-message').trim();
      if (action !== 'send-message') return res.status(400).json({ error: 'Unknown support action' });

      const body = String(req.body?.message || '').trim();
      if (body.length < 1 || body.length > 4000) {
        return res.status(400).json({ error: 'Message must contain between 1 and 4000 characters.' });
      }

      const { data: profile, error: profileError } = await supabaseAdmin
        .from('user_payment_profiles')
        .select('phone_e164')
        .eq('user_id', authUser.id)
        .maybeSingle();
      if (profileError) throw profileError;

      const { data, error } = await supabaseAdmin.rpc('support_send_client_message', {
        p_user_id: authUser.id,
        p_body: body,
        p_thread_id: String(req.body?.threadId || '').trim() || null,
        p_whatsapp_number: profile?.phone_e164 || null,
      });
      if (error) throw error;

      const delivery = await dispatchNotificationOutbox(10).catch((deliveryError) => ({
        processed: 0,
        sent: 0,
        failed: 1,
        configured: false,
        error: String(deliveryError?.message || deliveryError),
      }));
      return res.status(201).json({ ...data, delivery });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (Number.isInteger(error?.status)) return res.status(error.status).json({ error: error.message });
    return sendApiError(res, error, 'Support request failed');
  }
}
