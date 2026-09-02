import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import qrcode from 'qrcode-terminal';
import P from 'pino';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

// Managed container platforms such as Temps inject PORT at runtime.
const port = Number(process.env.PORT || process.env.BAILEYS_PORT || 3010);
const secret = String(process.env.WHATSAPP_BAILEYS_SECRET || '');
const authDir = path.resolve(process.env.BAILEYS_AUTH_DIR || path.join(process.cwd(), '.baileys-auth'));
const logger = P({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

if (secret.length < 32) {
  throw new Error('WHATSAPP_BAILEYS_SECRET must contain at least 32 characters');
}

let socket = null;
let connectionState = 'starting';
let reconnectTimer = null;
let dispatchTimer = null;

function safeEqual(received, expected) {
  const left = Buffer.from(String(received || '').replace(/^sha256=/i, '').trim(), 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifySignature(rawBody, received) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(received, expected);
}

function whatsappJid(destination) {
  const digits = String(destination || '').replace(/\D/g, '');
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) throw new Error('Invalid WhatsApp E.164 destination');
  return `${digits}@s.whatsapp.net`;
}

function notificationText(notification) {
  const payload = notification?.payload || {};
  if (notification.template === 'support_client_message') {
    return [
      'Nouveau message — Support Henshin',
      payload.clientEmail ? `Client : ${payload.clientEmail}` : null,
      payload.message ? `\n${payload.message}` : null,
      payload.threadId ? `\nConversation : ${payload.threadId}` : null,
      '\nRépondez depuis l’espace Support de l’administration Henshin.',
    ].filter(Boolean).join('\n');
  }
  if (notification.template === 'support_admin_reply') {
    return [
      'Réponse — Support Henshin',
      payload.message ? `\n${payload.message}` : null,
      '\nLa conversation complète reste disponible dans Henshin.',
    ].filter(Boolean).join('\n');
  }
  return [
    `Notification Henshin : ${notification.eventType || 'information'}`,
    payload.message || payload.reason || null,
  ].filter(Boolean).join('\n\n');
}

async function connect() {
  connectionState = 'connecting';
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const nextSocket = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.ubuntu('Henshin Support'),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  socket = nextSocket;
  nextSocket.ev.on('creds.update', saveCreds);
  nextSocket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      connectionState = 'pairing';
      console.log('\nScannez ce QR dans WhatsApp > Appareils connectés :');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      connectionState = 'ready';
      console.log('Baileys connecté. Les notifications support WhatsApp sont actives.');
    }
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      connectionState = loggedOut ? 'logged_out' : 'disconnected';
      socket = null;
      if (loggedOut) {
        console.error(`Session WhatsApp déconnectée. Supprimez le contenu privé de ${authDir} puis relancez le jumelage.`);
        return;
      }
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connect().catch((error) => console.error('Reconnexion Baileys impossible:', error));
        }, 3000);
      }
    }
  });
}

async function requestOutboxDispatch() {
  const url = String(process.env.HENSHIN_NOTIFICATION_DISPATCH_URL || '');
  const token = String(process.env.NOTIFICATION_DISPATCH_TOKEN || '');
  if (!url || token.length < 32 || connectionState !== 'ready') return;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 20 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.error(`Retry outbox refusé (HTTP ${response.status}).`);
  } catch (error) {
    console.error('Retry outbox indisponible:', error?.message || error);
  }
}

const app = express();
app.use(express.json({
  limit: '256kb',
  verify(req, _res, buffer) {
    req.rawBody = Buffer.from(buffer);
  },
}));

// Temps probes GET / and expects a 2xx/3xx response before routing traffic.
// Keep this as a liveness check: WhatsApp readiness remains available below.
app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'henshin-whatsapp-baileys',
    state: connectionState,
  });
});

app.get('/health', (_req, res) => {
  res.status(connectionState === 'ready' ? 200 : 503).json({
    ok: connectionState === 'ready',
    state: connectionState,
  });
});

app.post('/notifications', async (req, res) => {
  const signature = req.headers['x-henshin-signature'];
  if (!req.rawBody || !verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid Henshin signature' });
  }
  if (req.body?.channel !== 'whatsapp') {
    return res.status(400).json({ error: 'Baileys accepts WhatsApp notifications only' });
  }
  if (!socket || connectionState !== 'ready') {
    return res.status(503).json({ error: `WhatsApp is ${connectionState}` });
  }
  try {
    const result = await socket.sendMessage(
      whatsappJid(req.body.destination),
      { text: notificationText(req.body) },
    );
    return res.json({ ok: true, messageId: result?.key?.id || null });
  } catch (error) {
    console.error('Échec notification WhatsApp:', error);
    return res.status(502).json({ error: 'WhatsApp delivery failed' });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Passerelle Baileys Henshin : http://0.0.0.0:${port}`);
  console.log(`État privé conservé dans : ${authDir}`);
});

dispatchTimer = setInterval(() => void requestOutboxDispatch(), 30_000);

void connect().catch((error) => {
  connectionState = 'failed';
  console.error('Démarrage Baileys impossible:', error);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (dispatchTimer) clearInterval(dispatchTimer);
    socket?.end?.(new Error('Henshin support service stopped'));
    server.close(() => process.exit(0));
  });
}
