// api/cron/populate.js — nightly stats job (moved from bwfc-app, 20 Oct 2026).
//
// Runs once a night (see vercel.json). For each club in api/_teams.js it fetches any newly finished
// matches from Highlightly, works out team and player stats, and saves them to Firebase
// (player_stats/raw_<fdId>_<season>), which the Stats tab reads.
//
// It saves with a Firebase service account (FIREBASE_SERVICE_ACCOUNT, the whole JSON key file),
// so the database rules can stop anyone else writing. Vercel calls it with CRON_SECRET.
//
// Fixes carried over from bwfc-app: every saved match keeps its match id, already-saved matches are
// recognised by id or by date + opponent, duplicates are repaired, a substitute is recorded once.
// New here: Champions League matches are recorded too ('CL').

const TEAMS = require('../_teams.js');

const HIGHLIGHTLY_KEY = process.env.HIGHLIGHTLY_API_KEY;
const HIGHLIGHTLY_BASE = (process.env.HIGHLIGHTLY_FOOTBALL_BASE || 'https://sports.highlightly.net/football').replace(/\/+$/, '');
const now = new Date();
const SEASON = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; // 2026 = 2026/27
const SEASON_START = `${SEASON}-07-01`;
const COMPETITIVE_LEAGUE_IDS = [33973, 34824, 41632, 146305, 2486]; // PL, Championship, League Cup, FA Cup, Champions League

async function fetchHL(path) {
  const res = await fetch(`${HIGHLIGHTLY_BASE}${path}`, {
    headers: { 'x-rapidapi-key': HIGHLIGHTLY_KEY },
  });
  if (!res.ok) { console.warn(`Highlightly ${res.status} for ${path}`); return null; }
  return res.json();
}
function findPlayer(players, name) {
  if (!name) return null;
  const simplify = str => str
    .replace(/[ØøÒÓÔÕÖ]/g, 'o')
    .replace(/[ÀÁÂÃÄÅàáâãäå]/g, 'a')
    .replace(/[ÈÉÊËèéêë]/g, 'e')
    .replace(/[ÌÍÎÏìíîï]/g, 'i')
    .replace(/[ÙÚÛÜùúûü]/g, 'u')
    .replace(/[ÝýÿŸ]/g, 'y')
    .replace(/[Ññ]/g, 'n')
    .replace(/[Çç]/g, 'c')
    .replace(/-/g, ' ')  // treat hyphens as spaces
    .toLowerCase();

  return Object.values(players).find(p => {
    if (p.name === name) return true;
    if (simplify(p.name) === simplify(name)) return true;
    // Check abbreviated name e.g. "T. Gale" matches "Thierry Gale"
    const parts = name.split(' ');
    if (parts.length >= 2 && parts[0].endsWith('.')) {
      const initial = parts[0][0].toUpperCase();
      const lastName = simplify(parts.slice(1).join(' '));
      return p.name.startsWith(initial) && simplify(p.name).includes(lastName);
    }
    // Check if first word matches first name (e.g. "Samuel" matches "Samuel Iling-Junior")
    if (simplify(p.name).startsWith(simplify(name.split(' ')[0])) &&
        simplify(p.name).includes(simplify(name.split(' ').pop()))) return true;
        // Check if stored name is abbreviated e.g. stored "T. Gale" matches search "Thierry Gale"
const pParts = p.name.split(' ');
if (pParts.length >= 2 && pParts[0].endsWith('.')) {
  const initial = pParts[0][0].toUpperCase();
  const lastName = simplify(pParts.slice(1).join(' '));
  return name.toUpperCase().startsWith(initial) && simplify(name).includes(lastName);
}

    return false;
  });
}

function processMatch(match, events, lineups, statistics, boxScore, teamHlId) {
  const isHome = match.homeTeam?.id === teamHlId;
  const opponent = isHome ? match.awayTeam : match.homeTeam;
  const teamLineup = isHome ? lineups?.homeTeam : lineups?.awayTeam;

  const compCode = match.league?.id === 33973 ? 'PL' :
    match.league?.id === 34824 ? 'ELC' :
    match.league?.id === 41632 ? 'EFL' :
    match.league?.id === 146305 ? 'FAC' :
    match.league?.id === 2486 ? 'CL' : 'OTHER';

  const scoreStr = match.state?.score?.current;
  const scoreParts = scoreStr ? scoreStr.split(' - ') : [null, null];
  const homeScore = scoreParts[0] !== null ? parseInt(scoreParts[0]) : null;
  const awayScore = scoreParts[1] !== null ? parseInt(scoreParts[1]) : null;
  const teamScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;

  const baseMatchInfo = {
    id: match.id,
    date: match.date,
    opponent: opponent?.name,
    homeAway: isHome ? 'H' : 'A',
    score: `${homeScore}-${awayScore}`,
    competition: compCode,
    goals: 0, assists: 0, yellowCards: 0, redCards: 0,
    xg: 0, passes: 0, passAccuracy: 0, tackles: 0,
  };

  const players = {};

  

  // Process starting lineup
  const startingXI = (teamLineup?.initialLineup || []).flat();
  for (const p of startingXI) {
    players[p.id] = {
      id: p.id, name: p.name, position: p.position, shirtNumber: p.number,
      starts: 1, subApps: 0, minutesPlayed: 90,
      goals: 0, assists: 0, yellowCards: 0, redCards: 0,
      xg: 0, passes: 0, tackles: 0,
      matches: [{ ...baseMatchInfo, started: true, minutesPlayed: 90 }],
    };
  }
  const starterNames = new Set(startingXI.map(p => p.name));

  // Process bench
  for (const p of teamLineup?.substitutes || []) {
    if (!players[p.id]) {
      players[p.id] = {
        id: p.id, name: p.name, position: p.position, shirtNumber: p.number,
        starts: 0, subApps: 0, minutesPlayed: 0,
        goals: 0, assists: 0, yellowCards: 0, redCards: 0,
        xg: 0, passes: 0, tackles: 0,
        matches: [],
      };
    }
  }



(events || []).filter(e => e.team?.id === teamHlId).forEach(e => 
  console.log(`  ${e.time} ${e.type} ${e.player}`)
);

  // Add box score players missing from lineup
for (const teamData of Array.isArray(boxScore) ? boxScore : []) {
  if (teamData.team?.id !== teamHlId) continue;
  for (const bsPlayer of teamData.players || []) {
    const existing = findPlayer(players, bsPlayer.name);
    if (!existing) {
      // Player not found at all - add them
      players[bsPlayer.id] = {
        id: bsPlayer.id,
        name: bsPlayer.name,
        position: bsPlayer.position || '',
        shirtNumber: bsPlayer.shirtNumber || null,
        starts: bsPlayer.isSubstitute ? 0 : 1,
        subApps: bsPlayer.isSubstitute ? 1 : 0,
        minutesPlayed: bsPlayer.minutesPlayed || 0,
        goals: 0, assists: 0, yellowCards: 0, redCards: 0,
        xg: 0, passes: 0, tackles: 0,
        matches: [{
          ...baseMatchInfo,
          started: !bsPlayer.isSubstitute,
          minutesPlayed: bsPlayer.minutesPlayed || 0,
        }],
      };
    } else if (!existing.matches.find(m => m.id === match.id)) {
      // Player exists but has no entry for THIS match - add it
      if (bsPlayer.isSubstitute) {
        existing.subApps += 1;
      } else {
        existing.starts += 1;
      }
      existing.minutesPlayed += bsPlayer.minutesPlayed || 0;
      existing.matches.push({
        ...baseMatchInfo,
        started: !bsPlayer.isSubstitute,
        minutesPlayed: bsPlayer.minutesPlayed || 0,
      });
    }
  }
}

  // Process events
  for (const e of events || []) {
  if (!e.team || e.team.id !== teamHlId) continue;
  
  // just check once
    const minute = parseInt(e.time) || 0;

    if (e.type === 'Substitution') {
  const playerA = findPlayer(players, e.player);
  const playerB = findPlayer(players, e.substituted);
  const playerAIsStarter = playerA && starterNames.has(playerA.name);
  const playerBIsStarter = playerB && starterNames.has(playerB.name);
  const outPlayer = playerAIsStarter ? playerA : playerBIsStarter ? playerB : null;
  const inPlayer = outPlayer === playerA ? playerB : playerA;
  if (outPlayer) {
    outPlayer.minutesPlayed = parseInt(e.time) || 90;
    const last = outPlayer.matches.at(-1);
    if (last) last.minutesPlayed = parseInt(e.time) || 90;
  }
  const alreadyHasMatch = inPlayer && inPlayer.matches.some(m => String(m.id) === String(match.id));
  if (inPlayer && inPlayer !== outPlayer && alreadyHasMatch) {
    const entry = inPlayer.matches.find(m => String(m.id) === String(match.id));
    entry.cameOnMinute = parseInt(e.time) || 90;
  } else if (inPlayer && inPlayer !== outPlayer) {
    inPlayer.subApps += 1;
    inPlayer.minutesPlayed += 90 - (parseInt(e.time) || 90);
    inPlayer.matches.push({
      ...baseMatchInfo,
      started: false,
      minutesPlayed: 90 - (parseInt(e.time) || 90),
      cameOnMinute: parseInt(e.time) || 90,
    });
  }
} else if (e.type === 'Goal' || e.type === 'Penalty') {
  const scorer = findPlayer(players, e.player);
     
  
      if (scorer) {
        scorer.goals += 1;
        const last = scorer.matches.at(-1);
        if (last) last.goals = (last.goals || 0) + 1;
      }
      if (e.assist) {
        const assister = findPlayer(players, e.assist);
        if (assister) {
          assister.assists += 1;
          const last = assister.matches.at(-1);
          if (last) last.assists = (last.assists || 0) + 1;
        }
      }
    } else if (e.type === 'Yellow Card') {
      const player = findPlayer(players, e.player);
      if (player) {
        player.yellowCards += 1;
        const last = player.matches.at(-1);
        if (last) last.yellowCards = (last.yellowCards || 0) + 1;
      }
    } else if (e.type === 'Red Card' || e.type === 'Yellow Card/Red Card') {
      const player = findPlayer(players, e.player);
      if (player) {
        player.redCards += 1;
        const last = player.matches.at(-1);
        if (last) last.redCards = (last.redCards || 0) + 1;
      }
    }
  }

  // Add player box score stats
  for (const teamData of Array.isArray(boxScore) ? boxScore : []) {
    if (teamData.team?.id !== teamHlId) continue;
    for (const bsPlayer of teamData.players || []) {
      const ps = bsPlayer.statistics || {};
      const player = findPlayer(players, bsPlayer.name);
      if (player && player.matches.length > 0) {
        const lastMatch = player.matches.at(-1);
        lastMatch.xg = ps.expectedGoals || 0;
        lastMatch.passes = ps.passesTotal || 0;
        lastMatch.passAccuracy = ps.passesAccuracy ? parseFloat(ps.passesAccuracy) : 0;
        lastMatch.tackles = ps.tacklesTotal || 0;
        player.xg = (player.xg || 0) + (ps.expectedGoals || 0);
        player.passes = (player.passes || 0) + (ps.passesTotal || 0);
        player.tackles = (player.tackles || 0) + (ps.tacklesTotal || 0);
      }
    }
  }

  // Extract team statistics
  const statsArr = Array.isArray(statistics) ? statistics : [];
  const teamStatData = statsArr.find(t => t.team?.id === teamHlId);
  const s = {};
  for (const stat of teamStatData?.statistics || []) {
    s[stat.displayName] = stat.value;
  }

  // Extract box score aggregates for team
  const teamBoxScore = Array.isArray(boxScore)
    ? boxScore.find(t => t.team?.id === teamHlId)
    : null;

  let totalPasses = 0, successfulPasses = 0, totalTackles = 0, totalXg = 0;
  for (const player of teamBoxScore?.players || []) {
    const ps = player.statistics || {};
    totalPasses += ps.passesTotal || 0;
    successfulPasses += ps.passesSuccessful || 0;
    totalTackles += ps.tacklesTotal || 0;
    totalXg += ps.expectedGoals || 0;
  }

  const passAccuracy = totalPasses > 0
    ? Math.round((successfulPasses / totalPasses) * 100)
    : 0;

  const teamStats = {
    competition: compCode,
    date: match.date,
    opponent: opponent?.name,
    homeAway: isHome ? 'H' : 'A',
    result: teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'D',
    goalsFor: teamScore || 0,
    goalsAgainst: oppScore || 0,
    cleanSheet: oppScore === 0,
    possession: (() => { const p = s['Possession'] || 0; return p < 1 ? Math.round(p * 100) : p; })(),
    shotsOnGoal: s['Shots on target'] || 0,
    shotsOffGoal: s['Shots off target'] || 0,
    shots: (s['Shots on target'] || 0) + (s['Shots off target'] || 0) + (s['Blocked shots'] || 0),
    saves: s['Goalkeeper saves'] || 0,
    corners: s['Corners'] || 0,
    fouls: s['Fouls'] || 0,
    yellowCards: s['Yellow cards'] || 0,
    redCards: s['Red cards'] || 0,
    xg: totalXg,
    totalPasses,
    passAccuracy,
    tackles: totalTackles,
  };

  return {
    players: Object.values(players).filter(p => p.starts > 0 || p.subApps > 0),
    teamStats,
  };
}

// One match = one date + one opponent, whichever way its id was stored.
const matchKey = m => `${String(m.date || '').slice(0, 10)}|${m.opponent || ''}`;

// Removes duplicate matches and recomputes every player total from their own
// per-match entries, so earlier double-counting is repaired rather than carried forward.
function normalise(playerStats, teamMatchStats) {
  const teamByKey = new Map();
  for (const m of teamMatchStats) teamByKey.set(matchKey(m), m); // last copy wins
  const cleanTeam = [...teamByKey.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  const validKeys = new Set(cleanTeam.map(matchKey));

  let changedPlayers = 0;
  const cleanPlayers = {};
  for (const [id, p] of Object.entries(playerStats)) {
    const byKey = new Map();
    for (const m of p.matches || []) {
      const k = matchKey(m);
      if (!validKeys.has(k)) continue;
      const prev = byKey.get(k);
      if (!prev) { byKey.set(k, { ...m }); continue; }
      // Same match recorded twice: merge into one entry. Take the larger figure, never the sum:
      // a repeated run copies the goal into both entries, while a substitute's second entry
      // holds it in only one.
      byKey.set(k, {
        ...prev, ...m,
        started: !!(prev.started || m.started),
        minutesPlayed: Math.max(prev.minutesPlayed || 0, m.minutesPlayed || 0),
        goals: Math.max(prev.goals || 0, m.goals || 0),
        assists: Math.max(prev.assists || 0, m.assists || 0),
        yellowCards: Math.max(prev.yellowCards || 0, m.yellowCards || 0),
        redCards: Math.max(prev.redCards || 0, m.redCards || 0),
        xg: Math.max(prev.xg || 0, m.xg || 0),
        passes: Math.max(prev.passes || 0, m.passes || 0),
        tackles: Math.max(prev.tackles || 0, m.tackles || 0),
      });
    }
    const matches = [...byKey.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (!matches.length) continue;
    const sum = f => matches.reduce((t, m) => t + (Number(m[f]) || 0), 0);
    const rebuilt = {
      ...p,
      matches,
      starts: matches.filter(m => m.started).length,
      subApps: matches.filter(m => !m.started).length,
      minutesPlayed: sum('minutesPlayed'),
      goals: sum('goals'), assists: sum('assists'),
      yellowCards: sum('yellowCards'), redCards: sum('redCards'),
      xg: sum('xg'), passes: sum('passes'), tackles: sum('tackles'),
    };
    if (rebuilt.starts !== p.starts || rebuilt.subApps !== p.subApps || rebuilt.goals !== p.goals ||
        matches.length !== (p.matches || []).length) changedPlayers++;
    cleanPlayers[id] = rebuilt;
  }
  return { teamMatchStats: cleanTeam, changedPlayers, doc: { playerStats: cleanPlayers, teamMatchStats: cleanTeam } };
}

async function populateTeam(db, team) {  // db: { get(docKey), set(docKey, data) }
  const docKey = `raw_${team.fdId}_${SEASON}`;

  let playerStats = {};
  let teamMatchStats = [];
  const processedMatchIds = new Set();

  const data = await db.get(docKey);
  if (data) {
    playerStats = data.playerStats || {};
    teamMatchStats = data.teamMatchStats || [];
    teamMatchStats.forEach(m => { if (m.id != null) processedMatchIds.add(String(m.id)); });
  }

  const [homeData, awayData] = await Promise.all([
    fetchHL(`/matches?homeTeamId=${team.hlId}&season=${SEASON}&limit=100`),
    fetchHL(`/matches?awayTeamId=${team.hlId}&season=${SEASON}&limit=100`),
  ]);

  const seen = new Set();
  const allMatches = [
    ...(homeData?.data || []),
    ...(awayData?.data || []),
  ].filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return (
      (m.state?.description === 'Finished' ||
       m.state?.description === 'Finished after penalties' ||
       m.state?.description === 'Finished after extra time') &&
      COMPETITIVE_LEAGUE_IDS.includes(m.league?.id) &&
      new Date(m.date) >= new Date(SEASON_START)
    );
  });

  // A match is already saved if its id is known, or if a match on the same date against
  // the same opponent is saved (older entries were stored without an id).
  const savedKeys = new Set(teamMatchStats.map(matchKey));
  const keyOf = m => matchKey({
    date: m.date,
    opponent: m.homeTeam?.id === team.hlId ? m.awayTeam?.name : m.homeTeam?.name,
  });
  const newMatches = allMatches.filter(m => !processedMatchIds.has(String(m.id)) && !savedKeys.has(keyOf(m)));

  if (newMatches.length === 0) {
    // Nothing new, but repair any duplicates left by earlier runs.
    const fixed = normalise(playerStats, teamMatchStats);
    if (fixed.teamMatchStats.length !== teamMatchStats.length || fixed.changedPlayers) {
      await db.set(docKey, { ...fixed.doc, updatedAt: new Date().toISOString() });
      return { team: team.name, new: 0, repaired: `${teamMatchStats.length} → ${fixed.teamMatchStats.length}` };
    }
    return { team: team.name, new: 0 };
  }

  for (const match of newMatches) {
    await new Promise(r => setTimeout(r, 300));
    const [events, lineups, statistics, boxScore] = await Promise.all([
      fetchHL(`/events/${match.id}`),
      fetchHL(`/lineups/${match.id}`),
      fetchHL(`/statistics/${match.id}`),
      fetchHL(`/box-score/${match.id}`),
    ]);

    const { players, teamStats } = processMatch(
      match, events, lineups, statistics, boxScore, team.hlId
    );

    for (const p of players) {
      if (!playerStats[p.id]) {
        playerStats[p.id] = { ...p, matches: [...p.matches] };
      } else {
        playerStats[p.id].starts += p.starts;
        playerStats[p.id].subApps += p.subApps;
        playerStats[p.id].minutesPlayed += p.minutesPlayed;
        playerStats[p.id].goals += p.goals;
        playerStats[p.id].assists += p.assists;
        playerStats[p.id].yellowCards += p.yellowCards;
        playerStats[p.id].redCards += p.redCards;
        playerStats[p.id].xg = (playerStats[p.id].xg || 0) + (p.xg || 0);
        playerStats[p.id].passes = (playerStats[p.id].passes || 0) + (p.passes || 0);
        playerStats[p.id].tackles = (playerStats[p.id].tackles || 0) + (p.tackles || 0);
        playerStats[p.id].matches.push(...p.matches);
      }
    }
    teamStats.id = String(match.id); // without this, every night re-added every match
    teamMatchStats.push(teamStats);
  }

  const fixed = normalise(playerStats, teamMatchStats);
  await db.set(docKey, { ...fixed.doc, updatedAt: new Date().toISOString() });

  return { team: team.name, new: newMatches.length, total: fixed.teamMatchStats.length };
}


// ── Firebase (Admin SDK: bypasses the database rules, so only this job can write) ──
let firestore = null;
function firebaseStore() {
  if (!firestore) {
    let sa = {};
    try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}'); } catch { /* reported below */ }
    if (!sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing or not the whole key file');
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    firestore = admin.firestore();
  }
  const col = firestore.collection('player_stats');
  return {
    async get(key) { const s = await col.doc(key).get(); return s.exists ? s.data() : null; },
    async set(key, data) { await col.doc(key).set(data); },
  };
}

module.exports = async function handler(req, res) {
  if ((req.headers && req.headers.authorization) !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!HIGHLIGHTLY_KEY) return res.status(500).json({ error: 'HIGHLIGHTLY_API_KEY is not set' });
  let db;
  try { db = firebaseStore(); } catch (e) { return res.status(500).json({ error: e.message }); }

  // A short report of the run, readable at /api/stats?job=1. It is saved at the start and after
  // every team, so an interrupted run still shows how far it got.
  const startedAt = new Date().toISOString();
  const results = [];
  const saveReport = async status => {
    try { await db.set('_lastRun', { status, startedAt, updatedAt: new Date().toISOString(), season: SEASON, teamsDone: results.length, teamsTotal: TEAMS.length, results }); }
    catch (e) { console.error('Could not save run report:', e.message); }
  };
  console.log(`Stats job started: ${TEAMS.length} teams, season ${SEASON}`);
  await saveReport('running');
  for (const team of TEAMS) {
    let r;
    try { r = await populateTeam(db, team); }
    catch (err) { r = { team: team.name, error: err.message }; }
    results.push(r);
    console.log(JSON.stringify(r));
    await saveReport('running');
  }
  await saveReport('finished');
  return res.status(200).json({ success: true, startedAt, season: SEASON, results });
};

module.exports._test = { populateTeam, normalise, processMatch, TEAMS, SEASON };
