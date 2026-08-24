// @ts-nocheck
import { requireAuthorizedUser, sendApiError } from './auth.js';
import { getWalletByUserId } from './credit-utils.js';
import { supabaseAdmin } from './supabase.js';
import morphlyTokenHandler from '../server/morphly-token.js';

const PROVIDERS = new Set(['reactor', 'morphly']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function finishSession(userId, sessionId, reason) {
  const { error } = await supabaseAdmin.rpc('finish_billed_session', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_reason: reason,
  });
  if (error) throw new Error(`Could not reconcile session ${sessionId}: ${error.message}`);
}

export default async function handler(req, res) {
  if (req.query?.action === 'morphly-token') return morphlyTokenHandler(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = String(req.body?.userId || '').trim();
  const provider = String(req.body?.provider || '').trim();
  const clientSessionId = String(req.body?.clientSessionId || '').trim();
  if (!PROVIDERS.has(provider)) {
    return res.status(400).json({ allowed: false, error: 'Provider must be reactor or morphly' });
  }
  if (!UUID_PATTERN.test(clientSessionId)) {
    return res.status(400).json({ allowed: false, error: 'clientSessionId must be a UUID' });
  }

  try {
    await requireAuthorizedUser(req, userId);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('sessions')
      .select('id, status, provider')
      .eq('user_id', userId)
      .eq('client_session_id', clientSessionId)
      .maybeSingle();
    if (existingError) throw existingError;

    const initialWallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (existing) {
      if (existing.provider !== provider) {
        return res.status(409).json({
          allowed: false,
          sessionId: existing.id,
          credits: initialWallet.credits,
          error: 'clientSessionId is already associated with another provider',
        });
      }
      return res.json({
        allowed: existing.status === 'active' && initialWallet.credits > 0,
        sessionId: existing.id,
        credits: initialWallet.credits,
      });
    }

    const { data: activeSessions, error: activeError } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (activeError) throw activeError;
    for (const activeSession of activeSessions || []) {
      await finishSession(userId, activeSession.id, 'reconciled_on_start');
    }

    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (wallet.credits <= 0) {
      return res.json({ allowed: false, sessionId: null, credits: wallet.credits });
    }

    const model = provider === 'reactor' ? 'xmax/x2' : 'lucy-2.5';
    const { data: session, error: insertError } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id: userId,
        wallet_id: wallet.id,
        provider,
        client_session_id: clientSessionId,
        model,
        status: 'active',
        start_time: new Date().toISOString(),
        credits_per_second: 2,
        seconds_used: 0,
        credits_used: 0,
        cost: 0,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: raced, error: racedError } = await supabaseAdmin
          .from('sessions')
          .select('id, status, provider')
          .eq('user_id', userId)
          .eq('client_session_id', clientSessionId)
          .maybeSingle();
        if (racedError) throw racedError;
        if (raced) {
          const sameProvider = raced.provider === provider;
          return res.status(sameProvider ? 200 : 409).json({
            allowed: sameProvider && raced.status === 'active',
            sessionId: raced.id,
            credits: wallet.credits,
            ...(sameProvider ? {} : { error: 'clientSessionId is already associated with another provider' }),
          });
        }
        return res.status(409).json({
          allowed: false,
          error: 'Another session is already active',
          credits: wallet.credits,
        });
      }
      throw insertError;
    }

    return res.json({ allowed: true, sessionId: session.id, credits: wallet.credits });
  } catch (error) {
    return sendApiError(res, error, 'Failed to start session');
  }
}
