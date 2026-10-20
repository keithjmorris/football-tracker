// api/stats.js — reads a team's season stats from the shared Firebase database
// (written nightly by the stats job) and returns plain JSON for the Stats tab.
//
//   /api/stats?teamId=58652            (Highlightly team id; season defaults to the current one)
//
// The stats records are filed under football-data.org team ids, so this maps Highlightly → football-data.
// Environment variables (optional): FIREBASE_PROJECT_ID, FIREBASE_API_KEY (the public web API key).

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'football-tracker-c9dae';
const API_KEY = process.env.FIREBASE_API_KEY || '';

// Highlightly id → football-data id (the clubs the nightly stats job records; see _teams.js).
const HL_TO_FD = Object.fromEntries(require('./_teams.js').map(t => [t.hlId, t.fdId]));

// Firestore's REST format wraps every value in its type; turn it back into plain JSON.
function plain(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fields((v.mapValue && v.mapValue.fields) || {});
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(plain);
  return null;
}
function fields(f) {
  const out = {};
  for (const [k, v] of Object.entries(f || {})) out[k] = plain(v);
  return out;
}

const MATCH_FIELDS = ['id', 'date', 'opponent', 'homeAway', 'score', 'competition', 'started', 'minutesPlayed',
  'cameOnMinute', 'goals', 'assists', 'yellowCards', 'redCards'];
const TEAM_FIELDS = ['id', 'date', 'opponent', 'homeAway', 'competition', 'result', 'goalsFor', 'goalsAgainst',
  'cleanSheet', 'possession', 'shots', 'shotsOnGoal', 'corners', 'fouls', 'yellowCards', 'redCards'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));

module.exports = async function handler(req, res) {
  // /api/stats?job=1 → the nightly job's report of its last run
  if (req.query && req.query.job) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/player_stats/_lastRun` +
      (API_KEY ? `?key=${encodeURIComponent(API_KEY)}` : '');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (r.status === 404) return res.status(200).json({ lastRun: null, note: 'The nightly job has not saved a run report yet' });
      if (!r.ok) return res.status(r.status).json({ error: `Stats database returned ${r.status}` });
      return res.status(200).json({ lastRun: fields((await r.json()).fields) });
    } catch (e) { return res.status(502).json({ error: String(e && e.message || e) }); }
  }
  const teamId = parseInt(req.query && req.query.teamId, 10);
  const now = new Date();
  const season = parseInt(req.query && req.query.season, 10) || (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
  const fdId = HL_TO_FD[teamId];
  if (!fdId) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
    return res.status(200).json({ teamId, season, missing: true, reason: 'This club is not in the stats job', players: [], teamMatches: [] });
  }

  const doc = `raw_${fdId}_${season}`;
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/player_stats/${doc}` +
    (API_KEY ? `?key=${encodeURIComponent(API_KEY)}` : '');
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Could not reach the stats database', detail: String(e && e.message || e) });
  }
  if (r.status === 404) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800');
    return res.status(200).json({ teamId, season, missing: true, reason: 'No stats saved yet for this club and season', players: [], teamMatches: [] });
  }
  if (!r.ok) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15');
    const body = await r.text();
    return res.status(r.status).json({ error: `Stats database returned ${r.status}`, upstream: body.slice(0, 500) });
  }
  const raw = fields((await r.json()).fields);
  const players = Object.values(raw.playerStats || {}).map(p => ({
    id: p.id, name: p.name, position: p.position || '', shirtNumber: p.shirtNumber ?? null,
    matches: (p.matches || []).map(m => pick(m, MATCH_FIELDS)),
  }));
  const teamMatches = (raw.teamMatchStats || []).map(m => pick(m, TEAM_FIELDS));

  // The stats job runs nightly, so share one read for 30 minutes.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=1800');
  return res.status(200).json({ teamId, fdId, season, updatedAt: raw.updatedAt || null, players, teamMatches });
};

module.exports._test = { plain, fields, HL_TO_FD };
