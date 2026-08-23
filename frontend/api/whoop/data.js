import {
  ensureAccessToken,
  fetchWhoopCollection,
  whoopConfigured,
} from '../../lib/whoop-server.js';

function sleepHours(sleep) {
  const stage = sleep?.score?.stage_summary;
  if (!stage) return null;
  const total = [
    stage.total_light_sleep_time_milli,
    stage.total_slow_wave_sleep_time_milli,
    stage.total_rem_sleep_time_milli,
  ].map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0);
  return total > 0 ? total / 3_600_000 : null;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  if (!whoopConfigured()) {
    return res.status(503).json({
      configured: false,
      connected: false,
      error: 'WHOOP integration is not configured on this deployment.',
    });
  }

  try {
    const accessToken = await ensureAccessToken(req, res);
    if (!accessToken) {
      return res.status(401).json({ configured: true, connected: false });
    }

    const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const [recoveries, sleeps] = await Promise.all([
      fetchWhoopCollection('/recovery', accessToken, start),
      fetchWhoopCollection('/activity/sleep', accessToken, start),
    ]);

    const sleepByCycle = new Map();
    for (const sleep of sleeps) {
      if (sleep?.nap || sleep?.score_state !== 'SCORED') continue;
      sleepByCycle.set(String(sleep.cycle_id), sleep);
    }

    const records = [];
    const seenCycles = new Set();
    for (const recovery of recoveries) {
      if (recovery?.score_state !== 'SCORED' || !recovery?.score) continue;
      const cycleId = String(recovery.cycle_id);
      const sleep = sleepByCycle.get(cycleId) || null;
      seenCycles.add(cycleId);
      const rec = {
        date: sleep?.end || recovery.updated_at || recovery.created_at,
        resting_hr: finite(recovery.score.resting_heart_rate),
        hrv: finite(recovery.score.hrv_rmssd_milli),
        spo2: finite(recovery.score.spo2_percentage),
        temperature_c: finite(recovery.score.skin_temp_celsius),
        respiratory_rate: finite(sleep?.score?.respiratory_rate),
        sleep_hours: sleepHours(sleep),
        recovery_score: finite(recovery.score.recovery_score),
      };
      records.push(Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== null && v !== undefined)));
    }

    for (const sleep of sleepByCycle.values()) {
      const cycleId = String(sleep.cycle_id);
      if (seenCycles.has(cycleId)) continue;
      const rec = {
        date: sleep.end || sleep.updated_at || sleep.created_at,
        respiratory_rate: finite(sleep?.score?.respiratory_rate),
        sleep_hours: sleepHours(sleep),
      };
      records.push(Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== null && v !== undefined)));
    }

    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    return res.status(200).json({
      configured: true,
      connected: true,
      source: 'whoop_api_v2',
      records,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('WHOOP sync failed', error);
    if (error?.status === 401) {
      return res.status(401).json({ configured: true, connected: false, error: 'WHOOP authorization expired.' });
    }
    return res.status(502).json({ configured: true, connected: true, error: error?.message || String(error) });
  }
}
