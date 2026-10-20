// api/stats.js — reads a team's season stats from the shared Firebase database
// (written nightly by the stats job) and returns plain JSON for the Stats tab.
//
//   /api/stats?teamId=58652            (Highlightly team id; season defaults to the current one)
//
// The stats records are filed under football-data.org team ids, so this maps Highlightly → football-data.
// Environment variables (optional): FIREBASE_PROJECT_ID, FIREBASE_API_KEY (the public web API key).

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'football-tracker-c9dae';
const API_KEY = process.env.FIREBASE_API_KEY || '';

// Highlightly id → football-data id (the 44 clubs the nightly stats job records).
const HL_TO_FD = {
  58652: 60, // Bolton,
  46738: 332, // Birmingham,
  57801: 59, // Blackburn,
  48440: 387, // Bristol City,
  38228: 328, // Burnley,
  37377: 715, // Cardiff,
  1136869: 348, // Charlton,
  59503: 342, // Derby,
  1174313: 1126, // Lincoln,
  60354: 343, // Middlesbrough,
  50142: 384, // Millwall,
  61205: 68, // Norwich,
  1153889: 325, // Portsmouth,
  50993: 1081, // Preston,
  62056: 69, // QPR,
  53546: 356, // Sheffield United,
  35675: 340, // Southampton,
  64609: 70, // Stoke,
  65460: 72, // Swansea,
  33122: 346, // Watford,
  51844: 74, // West Brom,
  41632: 563, // West Ham,
  33973: 76, // Wolves,
  1564071: 404, // Wrexham,
  36526: 57, // Arsenal,
  56950: 58, // Aston Villa,
  30569: 1044, // Bournemouth,
  47589: 402, // Brentford,
  44185: 397, // Brighton,
  42483: 61, // Chelsea,
  1146230: 1076, // Coventry,
  45036: 354, // Crystal Palace,
  39079: 62, // Everton,
  31420: 63, // Fulham,
  55248: 322, // Hull City,
  49291: 349, // Ipswich,
  54397: 341, // Leeds United,
  34824: 64, // Liverpool,
  43334: 65, // Man City,
  28867: 66, // Man United,
  29718: 67, // Newcastle,
  56099: 351, // Nottm Forest,
  635630: 71, // Sunderland,
  40781: 73, // Tottenham
};

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
