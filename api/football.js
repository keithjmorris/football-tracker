// api/football.js — Vercel serverless proxy for Highlightly football (All Sports).
//
// The browser only ever calls our own endpoint, e.g.
//   /api/football?path=/matches&homeTeamId=36526&season=2026
// Everything except `path` is forwarded to Highlightly as a query parameter.
//
// The API key lives ONLY in the HIGHLIGHTLY_API_KEY environment variable
// (Vercel → Settings → Environment Variables, and a gitignored .env locally).
//
// HIGHLIGHTLY_FOOTBALL_BASE is optional; unset means the All Sports football address.
// LIVE_CACHE_SECONDS is optional; unset means 20 seconds for live matches.

const BASE = (process.env.HIGHLIGHTLY_FOOTBALL_BASE || 'https://sports.highlightly.net/football').replace(/\/+$/, '');

// Endpoint roots the front end may use. Odds and bookmakers are deliberately excluded.
const ALLOWED_ROOTS = new Set([
  'matches', 'standings', 'events', 'lineups', 'statistics',
  'highlights', 'leagues', 'teams', 'head-2-head', 'last-five-games',
]);

// Every match status in the Highlightly football docs, classified.
// (Kept in step with STATUS_GROUPS in app.js.)
const LIVE = new Set([
  'First half', 'Half time', 'Second half', 'Extra time', 'Break time',
  'Penalties', 'Suspended', 'Interrupted', 'In progress',
]);
const NOT_YET_PLAYED = new Set(['Not started', 'To be announced', 'Unknown']);
// Finished, Finished after penalties, Finished after extra time, Awarded, Abandoned,
// Postponed, Cancelled are all "settled" for caching purposes.

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function liveSeconds() {
  const n = parseInt(process.env.LIVE_CACHE_SECONDS, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 15), 900) : 20;
}

// How long one real API call may be shared by every user.
function matchesCacheSeconds(matches) {
  if (!matches.length) return 30 * MIN;
  const now = Date.now();
  const live = liveSeconds();
  let seconds = 7 * DAY;
  for (const m of matches) {
    const desc = m && m.state && m.state.description;
    const kickoff = Date.parse(m && m.date);
    const hoursSinceKickoff = Number.isFinite(kickoff) ? (now - kickoff) / HOUR / 1000 : NaN;
    if (LIVE.has(desc)) return live;
    if (!desc || NOT_YET_PLAYED.has(desc)) {
      if (!Number.isFinite(hoursSinceKickoff)) seconds = Math.min(seconds, 30 * MIN);
      // Kicks off within 3 hours, or should have started and hasn't updated yet.
      else if (hoursSinceKickoff > -3 && hoursSinceKickoff < 6) return live;
      else if (hoursSinceKickoff > -24) seconds = Math.min(seconds, 30 * MIN);
      else seconds = Math.min(seconds, 3 * HOUR);
    } else if (!Number.isFinite(hoursSinceKickoff) || hoursSinceKickoff < 36) {
      seconds = Math.min(seconds, 30 * MIN); // recently finished: corrections still possible
    }
  }
  return seconds;
}

function cacheSecondsFor(root, segments, body) {
  switch (root) {
    case 'matches': {
      const list = Array.isArray(body) ? body
        : Array.isArray(body && body.data) ? body.data
        : body && body.id ? [body] : [];
      return matchesCacheSeconds(list);
    }
    case 'events':
    case 'lineups':
    case 'statistics': return 60; // only fetched when someone opens a match
    case 'standings': return 30 * MIN;
    case 'highlights': return 15 * MIN;
    case 'last-five-games':
    case 'head-2-head': return HOUR;
    case 'teams':
    case 'leagues': return DAY;
    default: return 5 * MIN;
  }
}

function setCache(res, seconds) {
  const swr = seconds <= 900 ? 10 : seconds;
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${swr}`);
  res.setHeader('X-Football-Cache-Seconds', String(seconds));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Only GET is supported' });
  }
  const apiKey = process.env.HIGHLIGHTLY_API_KEY;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'HIGHLIGHTLY_API_KEY is not set in this Vercel project' });
  }

  const rawPath = String((req.query && req.query.path) || '').trim();
  const path = '/' + rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/i.test(path)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Missing or invalid path, e.g. ?path=/matches' });
  }
  const segments = path.slice(1).split('/');
  const root = segments[0].toLowerCase();
  if (!ALLOWED_ROOTS.has(root)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: `Endpoint "${root}" is not allowed`, allowed: [...ALLOWED_ROOTS] });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === 'path' || !/^[A-Za-z]{1,40}$/.test(key)) continue;
    for (const v of [].concat(value)) {
      const s = String(v);
      if (s.length <= 200) params.append(key, s);
    }
  }
  const qs = params.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { 'x-rapidapi-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Could not reach Highlightly', detail: String((err && err.message) || err) });
  }

  upstream.headers.forEach((value, name) => {
    if (/ratelimit|quota|remaining/i.test(name)) res.setHeader(name, value);
  });

  const text = await upstream.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }

  if (!upstream.ok) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15');
    return res.status(upstream.status).json({
      error: `Highlightly returned ${upstream.status}`,
      upstream: body !== null ? body : text.slice(0, 2000),
    });
  }
  if (body === null) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Highlightly returned something that was not JSON', upstream: text.slice(0, 2000) });
  }

  setCache(res, cacheSecondsFor(root, segments, body));
  return res.status(200).json(body);
};

module.exports._test = { matchesCacheSeconds, cacheSecondsFor, LIVE, NOT_YET_PLAYED };
