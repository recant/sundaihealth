import crypto from 'node:crypto';

export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
export const SESSION_COOKIE = 'pulselab_whoop_session';
export const STATE_COOKIE = 'pulselab_whoop_state';
export const WHOOP_SCOPES = 'read:recovery read:sleep offline';

export function whoopConfigured() {
  return Boolean(
    process.env.WHOOP_CLIENT_ID &&
    process.env.WHOOP_CLIENT_SECRET &&
    process.env.WHOOP_REDIRECT_URI &&
    process.env.SESSION_SECRET
  );
}

export function requireWhoopConfig() {
  if (!whoopConfigured()) throw new Error('WHOOP integration is not configured on this deployment.');
  return {
    clientId: process.env.WHOOP_CLIENT_ID,
    clientSecret: process.env.WHOOP_CLIENT_SECRET,
    redirectUri: process.env.WHOOP_REDIRECT_URI,
    sessionSecret: process.env.SESSION_SECRET,
  };
}

export function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function cookieString(name, value, { maxAge = 60 * 60 * 24 * 30 } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function appendCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const next = prev ? (Array.isArray(prev) ? [...prev, value] : [prev, value]) : value;
  res.setHeader('Set-Cookie', next);
}
export function setStateCookie(res, state) { appendCookie(res, cookieString(STATE_COOKIE, state, { maxAge: 600 })); }
export function clearStateCookie(res) { appendCookie(res, cookieString(STATE_COOKIE, '', { maxAge: 0 })); }

function keyFromSecret(secret) { return crypto.createHash('sha256').update(String(secret)).digest(); }
export function sealSession(session) {
  const { sessionSecret } = requireWhoopConfig();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecret(sessionSecret), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(session))), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(x => x.toString('base64url')).join('.');
}
export function unsealSession(value) {
  try {
    const { sessionSecret } = requireWhoopConfig();
    const [iv64, tag64, data64] = String(value || '').split('.');
    if (!iv64 || !tag64 || !data64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSecret(sessionSecret), Buffer.from(iv64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(data64, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (_) { return null; }
}
export function getSession(req) { return unsealSession(parseCookies(req)[SESSION_COOKIE]); }
export function setSession(res, session) { appendCookie(res, cookieString(SESSION_COOKIE, sealSession(session))); }
export function clearSession(res) { appendCookie(res, cookieString(SESSION_COOKIE, '', { maxAge: 0 })); }

export async function exchangeToken(params) {
  const { clientId, clientSecret } = requireWhoopConfig();
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params });
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error_description || json?.error || `WHOOP token request failed (${response.status})`);
  return json;
}

export function tokenToSession(token, previous = {}) {
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || previous.refresh_token || null,
    expires_at: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    scope: token.scope || previous.scope || WHOOP_SCOPES,
  };
}

export async function ensureAccessToken(req, res) {
  let session = getSession(req);
  if (!session?.access_token) return null;
  if (Number(session.expires_at || 0) > Date.now() + 60_000) return session.access_token;
  if (!session.refresh_token) return null;
  const token = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: session.refresh_token,
    scope: 'offline',
  });
  session = tokenToSession(token, session);
  setSession(res, session);
  return session.access_token;
}

export async function whoopGet(path, accessToken) {
  const response = await fetch(`${WHOOP_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(json?.message || json?.error || `WHOOP API failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return json;
}

export async function fetchWhoopCollection(path, accessToken, startIso, maxPages = 4) {
  const records = [];
  let nextToken = null;
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ limit: '25', start: startIso });
    if (nextToken) query.set('nextToken', nextToken);
    const json = await whoopGet(`${path}?${query.toString()}`, accessToken);
    records.push(...(Array.isArray(json.records) ? json.records : []));
    nextToken = json.next_token || null;
    if (!nextToken) break;
  }
  return records;
}
