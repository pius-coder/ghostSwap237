import express from 'express';

import resolveUser from '../api/auth/resolve-user.ts';
import admin from '../server/admin.ts';
import activateSession from '../api/activate-session.ts';
import endSession from '../api/end-session.ts';
import falRealtimeToken from '../server/fal-realtime-token.ts';
import proLicense from '../server/pro-license.ts';
import rate from '../api/rate.ts';
import sessionStatus from '../api/session-status.ts';
import startSession from '../api/start-session.ts';
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.ts';
import version from '../api/version.ts';
import wallet from '../api/wallet.ts';
import fapshiInit from '../server/fapshi-init.ts';
import fapshiReturn from '../server/fapshi-return.ts';
import fapshiStatus from '../server/fapshi-status.ts';
import fapshiWebhook from '../server/fapshi-webhook.ts';
import reactorToken from '../api/reactor-token.ts';
import chariowInit from '../server/chariow-init.ts';
import chariowPulse from '../server/chariow-pulse.ts';

const app = express();
const port = Number(process.env.HENSHIN_LOCAL_API_PORT || 3001);

function mount(path, handler) {
  app.all(path, (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  });
}

// Chariow Pulse MUST see the exact raw body before express.json().
app.post(
  '/api/payment/chariow-pulse',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res, next) => {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '{}'));
    } catch {
      req.body = {};
    }
    Promise.resolve(chariowPulse(req, res)).catch(next);
  },
);
// Also expose the dedicated Vercel-style path locally.
app.post(
  '/api/chariow-pulse',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res, next) => {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '{}'));
    } catch {
      req.body = {};
    }
    Promise.resolve(chariowPulse(req, res)).catch(next);
  },
);

app.use(express.json({ limit: '15mb' }));

mount('/api/auth/resolve-user', resolveUser);
mount('/api/admin', admin);
mount('/api/activate-session', activateSession);
mount('/api/end-session', endSession);
mount('/api/fal-realtime-token', falRealtimeToken);
mount('/api/pro-license', proLicense);
mount('/api/reactor-token', reactorToken);
mount('/api/payment/fapshi-init', fapshiInit);
mount('/api/payment/fapshi-return', fapshiReturn);
mount('/api/payment/fapshi-status', fapshiStatus);
mount('/api/payment/fapshi-webhook', fapshiWebhook);
mount('/api/payment/chariow-init', chariowInit);
mount('/api/rate', rate);
mount('/api/session-status', sessionStatus);
mount('/api/start-session', startSession);
mount('/api/version', version);
mount('/api/wallet', wallet);

app.get('/api/local-health', async (_req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({
      ok: false,
      error: supabaseAdminConfigError,
    });
  }

  const { error } = await supabaseAdmin
    .from('wallets')
    .select('user_id', { head: true, count: 'exact' });

  if (error) {
    return res.status(503).json({
      ok: false,
      error: error.message,
    });
  }

  return res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  console.error('Local API error:', error);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Local API ready at http://127.0.0.1:${port}`);
});
