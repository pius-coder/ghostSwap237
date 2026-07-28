// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { getWalletByUserId } from '../api/credit-utils.js';

const MORPHLY_SESSION_URL = 'https://api.morphly.fun/v1/realtime/sessions';
const MORPHLY_REALTIME_MODEL = 'lucy-2.5';
const MAX_MORPHLY_SESSION_SECONDS = 300;

function getRequestedUserId(req) {
  const queryUserId = Array.isArray(req.query?.userId)
    ? req.query.userId[0]
    : req.query?.userId;
  const bodyUserId = req.body?.userId;
  return String(queryUserId || bodyUserId || '').trim();
}

function getRequestedDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAX_MORPHLY_SESSION_SECONDS;
  }

  return Math.min(Math.round(parsed), MAX_MORPHLY_SESSION_SECONDS);
}

export default async function handler(req, res, options = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({
      error: supabaseAdminConfigError,
      code: 'SERVER_CONFIGURATION_ERROR',
    });
  }

  const morphlyApiKey = options.morphlyApiKey || process.env.MORPHLY_API_KEY;
  if (!morphlyApiKey) {
    return res.status(500).json({
      error: 'Morphly is not configured on the server.',
      code: 'MORPHLY_API_KEY_MISSING',
    });
  }

  const userId = getRequestedUserId(req);
  if (!userId) {
    return res.status(400).json({
      error: 'User ID is required',
      code: 'USER_ID_REQUIRED',
    });
  }

  try {
    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (!wallet || wallet.credits <= 0) {
      return res.status(402).json({
        error: 'Insufficient credits',
        code: 'INSUFFICIENT_CREDITS',
      });
    }

    const { data: activeSession, error: activeSessionError } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSessionError) {
      console.error('Morphly active-session lookup failed:', activeSessionError);
      return res.status(500).json({
        error: 'Could not verify the active session',
        code: 'ACTIVE_SESSION_LOOKUP_FAILED',
      });
    }

    if (!activeSession) {
      return res.status(409).json({
        error: 'Start an app session before requesting a Morphly credential.',
        code: 'APP_SESSION_REQUIRED',
      });
    }

    const requestedOrigin = typeof req.body?.origin === 'string'
      ? req.body.origin.trim()
      : '';
    const upstreamBody = {
      model: MORPHLY_REALTIME_MODEL,
      max_session_seconds: getRequestedDuration(req.body?.maxSessionSeconds),
      ...(requestedOrigin ? { origin: requestedOrigin } : {}),
    };

    const upstream = await fetch(MORPHLY_SESSION_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${morphlyApiKey}`,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(upstreamBody),
    });

    const result = await upstream.json().catch(() => ({
      error: `Morphly returned HTTP ${upstream.status}`,
      code: `HTTP_${upstream.status}`,
    }));

    if (!upstream.ok) {
      console.error('Morphly session creation failed:', {
        status: upstream.status,
        code: result?.code || null,
      });
    }

    return res.status(upstream.status).json(result);
  } catch (error) {
    console.error('Morphly token route failed:', error);
    return res.status(502).json({
      error: 'Could not reach Morphly.',
      code: 'MORPHLY_UNAVAILABLE',
    });
  }
}
