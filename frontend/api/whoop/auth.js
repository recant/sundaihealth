import crypto from 'node:crypto';
import {
  WHOOP_AUTH_URL,
  WHOOP_SCOPES,
  requireWhoopConfig,
  setStateCookie,
} from '../../lib/whoop-server.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  let config;
  try {
    config = requireWhoopConfig();
  } catch (error) {
    return res.status(503).json({
      error: error.message,
      setup: 'Set WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI, and SESSION_SECRET on Vercel.',
    });
  }

  const state = crypto.randomBytes(8).toString('hex').slice(0, 8);
  setStateCookie(res, state);
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: WHOOP_SCOPES,
    state,
  });
  return res.redirect(302, `${WHOOP_AUTH_URL}?${query.toString()}`);
}
