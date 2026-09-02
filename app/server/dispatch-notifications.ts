// @ts-nocheck
import { timingSafeEqual } from 'node:crypto';
import { dispatchNotificationOutbox } from './notification-dispatch.js';

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || ''));
  return match?.[1]?.trim() || '';
}

function matchesSecret(received, expected) {
  const left = Buffer.from(String(received || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.NOTIFICATION_DISPATCH_TOKEN;
  if (!expected || expected.length < 32) {
    return res.status(503).json({ error: 'Notification dispatcher is not configured' });
  }
  if (!matchesSecret(bearer(req), expected)) {
    return res.status(401).json({ error: 'Invalid notification dispatcher token' });
  }

  try {
    return res.json(await dispatchNotificationOutbox(Math.min(50, Math.max(1, Number(req.body?.limit) || 20))));
  } catch (error) {
    console.error('Notification dispatch failed:', error);
    return res.status(500).json({ error: 'Notification dispatch failed' });
  }
}
