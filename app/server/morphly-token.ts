// @ts-nocheck
import {
  authorizedUserIds,
  requireAuthUser,
  requireAuthorizedUser,
  sendApiError,
} from '../api/auth.js';
import { getWalletByUserId } from '../api/credit-utils.js';
import { supabaseAdmin } from '../api/supabase.js';

const MORPHLY_SESSION_URL = 'https://api.morphly.fun/v1/realtime/sessions';
const MORPHLY_REALTIME_MODEL = 'lucy-2.5';
const MAX_MORPHLY_SESSION_SECONDS = 300;

function requestedDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0
    ? Math.min(Math.round(duration), MAX_MORPHLY_SESSION_SECONDS)
    : MAX_MORPHLY_SESSION_SECONDS;
}

export function normalizeRequestedOrigin(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim() === 'null') return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : '';
  } catch {
    return '';
  }
}

async function findActiveSession(req, authUser) {
  const requestedUserId = String(req.body?.userId || req.query?.userId || '').trim();
  const requestedSessionId = String(req.body?.sessionId || req.query?.sessionId || '').trim();
  const userIds = requestedUserId
    ? [(await requireAuthorizedUser(req, requestedUserId)).userId]
    : await authorizedUserIds(authUser);

  let query = supabaseAdmin
    .from('sessions')
    .select('id, user_id')
    .in('user_id', userIds)
    .eq('provider', 'morphly')
    .eq('status', 'active')
    .order('start_time', { ascending: false })
    .limit(1);
  if (requestedSessionId) query = query.eq('id', requestedSessionId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(req, res, options = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authUser = await requireAuthUser(req);
    const session = await findActiveSession(req, authUser);
    if (!session) {
      return res.status(409).json({
        error: 'An active Morphly app session is required',
        code: 'APP_SESSION_REQUIRED',
      });
    }

    const wallet = await getWalletByUserId(session.user_id, { createIfMissing: false });
    if (!wallet || wallet.credits <= 0) {
      return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
    }

    const apiKey = options.morphlyApiKey || process.env.MORPHLY_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Morphly is not configured on the server', code: 'MORPHLY_API_KEY_MISSING' });
    }

    const origin = normalizeRequestedOrigin(req.body?.origin);
    const upstream = await fetch(MORPHLY_SESSION_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': String(req.body?.clientSessionId || session.id),
      },
      body: JSON.stringify({
        model: MORPHLY_REALTIME_MODEL,
        max_session_seconds: requestedDuration(req.body?.maxSessionSeconds),
        ...(origin ? { origin } : {}),
      }),
    });
    const body = await upstream.json().catch(() => ({
      error: `Morphly returned HTTP ${upstream.status}`,
      code: `HTTP_${upstream.status}`,
    }));
    if (!upstream.ok) console.error('Morphly session creation failed:', upstream.status, body?.code);
    return res.status(upstream.status).json(body);
  } catch (error) {
    return sendApiError(res, error, 'Could not reach Morphly');
  }
}
