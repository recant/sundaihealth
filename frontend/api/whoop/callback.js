import {
  STATE_COOKIE,
  clearStateCookie,
  exchangeToken,
  parseCookies,
  requireWhoopConfig,
  setSession,
  tokenToSession,
} from '../../lib/whoop-server.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('GET only');
  }

  try {
    const config = requireWhoopConfig();
    const cookies = parseCookies(req);
    const expectedState = cookies[STATE_COOKIE];
    const state = String(req.query?.state || '');
    const code = String(req.query?.code || '');
    const oauthError = String(req.query?.error || '');

    clearStateCookie(res);

    if (oauthError) return res.redirect(302, `/?whoop=denied`);
    if (!code || !expectedState || state !== expectedState) {
      return res.redirect(302, '/?whoop=state_error');
    }

    const token = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    });
    setSession(res, tokenToSession(token));
    return res.redirect(302, '/?whoop=connected');
  } catch (error) {
    console.error('WHOOP OAuth callback failed', error);
    return res.redirect(302, '/?whoop=error');
  }
}
