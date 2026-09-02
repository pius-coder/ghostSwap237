// @ts-nocheck
import { requireAdminUser, sendApiError } from '../api/auth.js';
import { supabaseAdmin } from '../api/supabase.js';
import {
  DEFAULT_PRO_CREDITS_PER_SECOND,
  generateLicenseCode,
  hashLicenseCode,
} from './pro-utils.js';
import { dispatchNotificationOutbox } from './notification-dispatch.js';

const PERIODS = new Set(['today', '7d', '30d', 'all']);

function periodStart(period) {
  if (period === 'all') return null;
  const now = new Date();
  if (period === 'today') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const days = period === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 86400000).toISOString();
}

function requireReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 3) {
    const error = new Error('An audit reason of at least 3 characters is required');
    error.status = 400;
    throw error;
  }
  return reason.slice(0, 500);
}

async function usersById(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, is_admin, created_at')
    .in('id', unique);
  if (error) throw error;
  return new Map((data || []).map((user) => [user.id, user]));
}

async function loadClients() {
  const [{ data: users, error: userError }, { data: wallets, error: walletError }, { data: licenses, error: licenseError }] = await Promise.all([
    supabaseAdmin.from('users').select('id, email, is_admin, created_at').order('created_at', { ascending: false }).limit(1000),
    supabaseAdmin.from('wallets').select('user_id, credits'),
    supabaseAdmin.from('pro_licenses').select('id, user_id, status, credits_per_second, code_last4, redeemed_at, revoked_at, created_at, updated_at'),
  ]);
  if (userError) throw userError;
  if (walletError) throw walletError;
  if (licenseError) throw licenseError;
  const walletByUser = new Map((wallets || []).map((wallet) => [wallet.user_id, Number(wallet.credits || 0)]));
  const licenseByUser = new Map((licenses || []).map((license) => [license.user_id, license]));
  return (users || []).map((user) => ({
    ...user,
    credits: walletByUser.get(user.id) || 0,
    proLicense: licenseByUser.get(user.id) || null,
  }));
}

async function loadPayments() {
  const { data, error } = await supabaseAdmin.from('payment_orders').select('*')
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  const rows = data || [];
  const userMap = await usersById(rows.map((row) => row.user_id));
  const cashByCurrency = {};
  for (const row of rows) {
    if (!['paid', 'refunded', 'disputed'].includes(row.status)) continue;
    const currency = String(row.currency || 'UNKNOWN').toUpperCase();
    const bucket = cashByCurrency[currency] || { gross: 0, fees: 0, net: 0, refunded: 0 };
    if (row.status === 'paid') {
      bucket.gross += Number(row.gross_amount || 0);
      bucket.fees += Number(row.fee_amount || 0);
      bucket.net += Number(row.net_amount ?? row.gross_amount ?? 0);
    } else bucket.refunded += Number(row.gross_amount || 0);
    cashByCurrency[currency] = bucket;
  }
  return {
    rows: rows.map((row) => ({ ...row, user: userMap.get(row.user_id) || null })),
    cashByCurrency,
    pending: rows.filter((row) => row.status === 'pending').length,
    paidNotFulfilled: rows.filter((row) => row.status === 'paid' && row.fulfilment_status !== 'fulfilled').length,
  };
}

async function loadFinanceLedger() {
  const { data, error } = await supabaseAdmin.from('wallet_ledger').select('*')
    .order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const rows = data || [];
  const userMap = await usersById(rows.map((row) => row.user_id));
  const totals = rows.reduce((result, row) => {
    result[row.entry_type] = (result[row.entry_type] || 0) + Number(row.credits_delta || 0);
    return result;
  }, {});
  return { rows: rows.map((row) => ({ ...row, user: userMap.get(row.user_id) || null })), totals };
}

async function loadNotifications() {
  const [{ data: rows, error }, { data: recipients, error: recipientError }] = await Promise.all([
    supabaseAdmin.from('notification_outbox').select('*').order('created_at', { ascending: false }).limit(500),
    supabaseAdmin.from('admin_notification_recipients').select('*').order('created_at', { ascending: false }),
  ]);
  if (error) throw error;
  if (recipientError) throw recipientError;
  return { rows: rows || [], recipients: recipients || [], failed: (rows || []).filter((row) => ['failed', 'dead_letter'].includes(row.status)).length };
}

async function loadSupport(threadId = '') {
  const { data: threads, error } = await supabaseAdmin
    .from('support_threads')
    .select('*')
    .order('last_message_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = threads || [];
  const userMap = await usersById(rows.map((thread) => thread.user_id));
  const selected = threadId ? rows.find((thread) => thread.id === threadId) : rows[0];
  let messages = [];
  if (selected) {
    const { data, error: messageError } = await supabaseAdmin
      .from('support_messages')
      .select('id, thread_id, sender_id, sender_role, body, channel, whatsapp_delivery_status, whatsapp_message_id, created_at')
      .eq('thread_id', selected.id)
      .order('created_at', { ascending: true })
      .limit(1000);
    if (messageError) throw messageError;
    messages = data || [];
    await supabaseAdmin.from('support_threads')
      .update({ admin_read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', selected.id);
  }
  return {
    threads: rows.map((thread) => ({
      ...thread,
      user: userMap.get(thread.user_id) || null,
      unread: Boolean(thread.last_client_message_at
        && (!thread.admin_read_at || new Date(thread.last_client_message_at) > new Date(thread.admin_read_at))),
    })),
    thread: selected ? { ...selected, user: userMap.get(selected.user_id) || null } : null,
    messages,
  };
}

async function loadUsage(period) {
  const start = periodStart(period);
  let query = supabaseAdmin
    .from('sessions')
    .select('id, user_id, provider, model, start_time, end_time, seconds_used, credits_used, credits_per_second, provider_cost_usd, provider_cost_rate_usd_per_second, status, end_reason')
    .order('start_time', { ascending: false })
    .limit(2000);
  if (start) query = query.gte('start_time', start);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const userMap = await usersById(rows.map((row) => row.user_id));
  const totals = rows.reduce((result, row) => {
    const provider = row.provider || 'unknown';
    const current = result[provider] || { sessions: 0, seconds: 0, credits: 0, providerCostUsd: 0 };
    const seconds = Number(row.seconds_used || 0);
    current.sessions += 1;
    current.seconds += seconds;
    current.credits += Number(row.credits_used || 0);
    const storedCost = Number(row.provider_cost_usd);
    current.providerCostUsd += Number.isFinite(storedCost)
      ? storedCost
      : seconds * (provider === 'fal' ? 0.04 : provider === 'reactor' ? 0.0017 : 0);
    result[provider] = current;
    return result;
  }, {});
  return {
    period,
    totals,
    rows: rows.map((row) => ({
      ...row,
      user: userMap.get(row.user_id) || null,
      providerCostUsd: Number.isFinite(Number(row.provider_cost_usd))
        ? Number(row.provider_cost_usd)
        : Number(row.seconds_used || 0) * (row.provider === 'fal' ? 0.04 : row.provider === 'reactor' ? 0.0017 : 0),
    })),
  };
}

async function loadLicenses() {
  const { data, error } = await supabaseAdmin
    .from('pro_licenses')
    .select('id, user_id, status, credits_per_second, code_last4, redeemed_at, revoked_at, admin_reason, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const userMap = await usersById((data || []).map((license) => license.user_id));
  return (data || []).map((license) => ({ ...license, user: userMap.get(license.user_id) || null }));
}

async function loadPackages() {
  const { data, error } = await supabaseAdmin
    .from('credit_packages')
    .select('id, name, credits, price_usd, price_xaf, is_active, sort_order, chariow_product_id, chariow_enabled')
    .order('sort_order', { ascending: true })
    .order('credits', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function handleGet(req, res) {
  const action = String(req.query?.action || 'overview');
  if (action === 'clients') return res.json({ clients: await loadClients() });
  if (action === 'licenses') return res.json({ licenses: await loadLicenses() });
  if (action === 'packages') return res.json({ packages: await loadPackages() });
  if (action === 'payments') return res.json(await loadPayments());
  if (action === 'ledger') return res.json(await loadFinanceLedger());
  if (action === 'notifications') return res.json(await loadNotifications());
  if (action === 'support') return res.json(await loadSupport(String(req.query?.threadId || '').trim()));
  if (action === 'usage') {
    const requested = String(req.query?.period || '30d');
    const period = PERIODS.has(requested) ? requested : '30d';
    return res.json(await loadUsage(period));
  }
  if (action === 'audit') {
    const { data, error } = await supabaseAdmin
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return res.json({ audit: data || [] });
  }
  if (action === 'overview') {
    const [clients, licenses, payments, usage, ledger, notifications] = await Promise.all([
      loadClients(), loadLicenses(), loadPayments(), loadUsage('30d'), loadFinanceLedger(), loadNotifications(),
    ]);
    return res.json({
      totalUsers: clients.length,
      totalCredits: clients.reduce((sum, client) => sum + client.credits, 0),
      activeProLicenses: licenses.filter((license) => license.status === 'active').length,
      pendingProLicenses: licenses.filter((license) => license.status === 'pending').length,
      pendingPayments: payments.pending,
      paidNotFulfilled: payments.paidNotFulfilled,
      cashByCurrency: payments.cashByCurrency,
      creditMovements: ledger.totals,
      failedNotifications: notifications.failed,
      usageByProvider: usage.totals,
    });
  }
  return res.status(400).json({ error: 'Unknown admin action' });
}

async function handlePost(req, res, adminUserId) {
  const action = String(req.body?.action || '').trim();

  if (action === 'support-reply') {
    const body = String(req.body?.message || '').trim();
    if (body.length < 1 || body.length > 4000) {
      return res.status(400).json({ error: 'Reply must contain between 1 and 4000 characters' });
    }
    const { data, error } = await supabaseAdmin.rpc('admin_reply_support_thread', {
      p_admin_id: adminUserId,
      p_thread_id: String(req.body?.threadId || '').trim(),
      p_body: body,
      p_notify_whatsapp: req.body?.notifyWhatsApp !== false,
    });
    if (error) throw error;
    const delivery = await dispatchNotificationOutbox(10).catch((deliveryError) => ({
      processed: 0, sent: 0, failed: 1, configured: false,
      error: String(deliveryError?.message || deliveryError),
    }));
    return res.json({ ...data, delivery });
  }

  const reason = requireReason(req.body?.reason);

  if (action === 'support-update') {
    const { data, error } = await supabaseAdmin.rpc('admin_update_support_thread', {
      p_admin_id: adminUserId,
      p_thread_id: String(req.body?.threadId || '').trim(),
      p_status: String(req.body?.status || '').trim(),
      p_priority: String(req.body?.priority || '').trim(),
      p_reason: reason,
    });
    if (error) throw error;
    return res.json({ thread: data });
  }

  if (action === 'create-license') {
    const userId = String(req.body?.userId || '').trim();
    const rate = Number(req.body?.creditsPerSecond ?? DEFAULT_PRO_CREDITS_PER_SECOND);
    if (!Number.isInteger(rate) || rate <= 0) return res.status(400).json({ error: 'Invalid PRO credit rate' });
    const code = generateLicenseCode();
    const { data, error } = await supabaseAdmin.rpc('admin_create_pro_license', {
      p_admin_id: adminUserId,
      p_user_id: userId,
      p_code_hash: hashLicenseCode(code),
      p_code_last4: code.slice(-4),
      p_credits_per_second: rate,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json({ license: data, code });
  }

  if (action === 'manage-license') {
    const licenseAction = String(req.body?.licenseAction || '').trim();
    const rate = req.body?.creditsPerSecond == null ? null : Number(req.body.creditsPerSecond);
    const { data, error } = await supabaseAdmin.rpc('admin_manage_pro_license', {
      p_admin_id: adminUserId,
      p_license_id: String(req.body?.licenseId || '').trim(),
      p_action: licenseAction,
      p_credits_per_second: rate,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json({ license: data });
  }

  if (action === 'adjust-credits') {
    const change = Number(req.body?.change);
    if (!Number.isInteger(change) || change === 0) return res.status(400).json({ error: 'Credit change must be a non-zero integer' });
    const { data, error } = await supabaseAdmin.rpc('admin_adjust_wallet_credits', {
      p_admin_id: adminUserId,
      p_user_id: String(req.body?.userId || '').trim(),
      p_change: change,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json(data);
  }

  if (action === 'decide-payment') {
    const status = String(req.body?.status || '').trim();
    const source = String(req.body?.source || '').trim();
    const { data, error } = await supabaseAdmin.rpc('admin_decide_payment', {
      p_admin_id: adminUserId,
      p_source: source,
      p_payment_id: String(req.body?.paymentId || '').trim(),
      p_status: status,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json(data);
  }

  if (action === 'upsert-package') {
    const id = String(req.body?.packageId || '').trim();
    const values = {
      name: String(req.body?.name || '').trim(),
      credits: Number(req.body?.credits),
      price_usd: Number(req.body?.priceUsd || 0),
      price_xaf: Number(req.body?.priceXaf || 0),
      is_active: req.body?.isActive !== false,
      chariow_product_id: String(req.body?.chariowProductId || '').trim() || null,
      chariow_enabled: req.body?.chariowEnabled === true,
    };
    if (!values.name || !Number.isInteger(values.credits) || values.credits <= 0
      || !Number.isFinite(values.price_usd) || values.price_usd < 0
      || !Number.isFinite(values.price_xaf) || values.price_xaf < 0) {
      return res.status(400).json({ error: 'Invalid credit package' });
    }
    const query = id
      ? supabaseAdmin.from('credit_packages').update(values).eq('id', id)
      : supabaseAdmin.from('credit_packages').insert(values);
    const { data, error } = await query.select('id, name, credits, price_usd, price_xaf, is_active, sort_order, chariow_product_id, chariow_enabled').single();
    if (error) throw error;
    const { error: auditError } = await supabaseAdmin.from('admin_audit_log').insert({
      actor_user_id: adminUserId,
      action: id ? 'credit_package.update' : 'credit_package.create',
      entity_type: 'credit_package',
      entity_id: data.id,
      reason,
      after_state: data,
    });
    if (auditError) throw auditError;
    return res.json({ package: data });
  }

  if (action === 'upsert-notification-recipient') {
    const channel = String(req.body?.channel || '').trim().toLowerCase();
    const destination = String(req.body?.destination || '').trim();
    if (!['email', 'whatsapp', 'sms'].includes(channel) || destination.length < 3 || destination.length > 320) {
      return res.status(400).json({ error: 'Invalid notification recipient' });
    }
    const { data, error } = await supabaseAdmin.from('admin_notification_recipients').upsert({
      channel, destination, enabled: req.body?.enabled !== false,
      minimum_severity: String(req.body?.minimumSeverity || 'info'), created_by: adminUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'channel,destination' }).select('*').single();
    if (error) throw error;
    const { error: auditError } = await supabaseAdmin.from('admin_audit_log').insert({
      actor_user_id: adminUserId, action: 'notification_recipient.upsert', entity_type: 'notification_recipient',
      entity_id: data.id, reason, after_state: { ...data, destination: '[REDACTED]' },
    });
    if (auditError) throw auditError;
    return res.json({ recipient: data });
  }

  return res.status(400).json({ error: 'Unknown admin mutation' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { adminUserId } = await requireAdminUser(req);
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res, adminUserId);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (Number.isInteger(error?.status)) return res.status(error.status).json({ error: error.message });
    return sendApiError(res, error, 'Admin request failed');
  }
}
