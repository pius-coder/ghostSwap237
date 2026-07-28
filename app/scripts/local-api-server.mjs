import express from 'express';

import resolveUser from '../api/auth/resolve-user.ts';
import cryptoSubmit from '../api/payment/crypto-submit.ts';
import endSession from '../api/end-session.ts';
import morphlyToken from '../api/morphly-token.ts';
import paystackInit from '../api/payment/paystack-init.ts';
import paystackVerify from '../api/payment/paystack-verify.ts';
import paystackWebhook from '../api/payment/paystack-webhook.ts';
import rate from '../api/rate.ts';
import sessionStatus from '../api/session-status.ts';
import startSession from '../api/start-session.ts';
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.ts';
import version from '../api/version.ts';
import wallet from '../api/wallet.ts';

const app = express();
const port = Number(process.env.FORMAT_BOY_LOCAL_API_PORT || 3001);

app.use(express.json({ limit: '15mb' }));

function mount(path, handler) {
  app.all(path, (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  });
}

mount('/api/auth/resolve-user', resolveUser);
mount('/api/payment/crypto-submit', cryptoSubmit);
mount('/api/end-session', endSession);
mount('/api/morphly-token', morphlyToken);
mount('/api/payment/paystack-init', paystackInit);
mount('/api/payment/paystack-verify', paystackVerify);
mount('/api/payment/paystack-webhook', paystackWebhook);
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
