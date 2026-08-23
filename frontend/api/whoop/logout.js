import {
  WHOOP_API,
  clearSession,
  ensureAccessToken,
  whoopConfigured,
} from '../../lib/whoop-server.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    if (whoopConfigured()) {
      const accessToken = await ensureAccessToken(req, res);
      if (accessToken) {
        await fetch(`${WHOOP_API}/user/access`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => null);
      }
    }
  } finally {
    clearSession(res);
  }
  return res.status(200).json({ connected: false });
}
