// app.js — Football Tracker. Plain JS, no build step.
// All data comes through our own /api/football proxy (the API key never reaches the browser).
(() => {
  'use strict';

  const CFG = window.FOOTBALL_CONFIG;
  const TZ = 'Europe/London';
  const RESULTS_DAYS = 60;

  // ── Edition (starting link) ─────────────────────────────────────────────
  const pathKey = location.pathname.replace(/\/+$/, '').split('/').pop().toLowerCase();
  const EDITION = CFG.editions[pathKey] ? pathKey : 'main';
  const ED = CFG.editions[EDITION];
  const LOCKED = new Set(ED.locked);

  // ── Status handling ─────────────────────────────────────────────────────
  // Every status value in the Highlightly football docs, classified explicitly.
  // Anything not listed (including "Unknown") is placed by its kick-off time.
  const STATUS_GROUPS = {
    live: ['First half', 'Half time', 'Second half', 'Extra time', 'Break time', 'Penalties', 'Suspended', 'Interrupted', 'In progress'],
    upcoming: ['Not started', 'To be announced'],
    postponed: ['Postponed'],
    finished: ['Finished', 'Finished after penalties', 'Finished after extra time', 'Awarded', 'Abandoned'],
    cancelled: ['Cancelled'],
  };
  const STATUS_OF = {};
  for (const [g, list] of Object.entries(STATUS_GROUPS)) for (const s of list) STATUS_OF[s] = g;

  const HOUR = 3600e3, DAY = 24 * HOUR;
  const kickoff = m => Date.parse(m.date) || 0;
  function phase(m) {
    const g = STATUS_OF[m.state && m.state.description];
    if (g) return g;
    return kickoff(m) > Date.now() ? 'upcoming' : 'finished';
  }
  function isOverdue(m) {
    if (phase(m) !== 'upcoming') return false;
    const since = Date.now() - kickoff(m);
    return since > 0 && since < 4 * HOUR;
  }
  function statusTag(m) {
    const d = m.state && m.state.description;
    if (!d || d === 'Not started' || d === 'Finished') return '';
    if (d === 'Finished after extra time') return 'After extra time';
    if (d === 'Finished after penalties') return 'After penalties';
    return d;
  }
  function parsePair(s) {
    if (!s) return null;
    const p = String(s).split('-').map(x => parseInt(x.trim(), 10));
    return p.length === 2 && p.every(Number.isFinite) ? p : null;
  }
  const scoreOf = m => parsePair(m.state && m.state.score && m.state.score.current);
  const pensOf = m => parsePair(m.state && m.state.score && m.state.score.penalties);
  function liveLabel(m) {
    const d = m.state.description;
    const clock = m.state.clock;
    if (d === 'Half time' || d === 'Break time') return d;
    return clock != null && clock !== '' ? `${clock}′` : d;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = o => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o });
  const fDayKey = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
  const fDayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fDayShort = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
  const dayKey = t => fDayKey.format(new Date(t));
  const whenShort = t => `${fDayShort.format(new Date(t))}, ${fTime.format(new Date(t))}`;
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // Football seasons start in August and are named by their starting year (2026 = 2026/27).
  const now = new Date();
  const SEASON = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  // ── State ───────────────────────────────────────────────────────────────
  const TEAMS_KEY = `ft.teams.${EDITION}`;
  function initialTeams() {
    const saved = store.get(TEAMS_KEY, null);
    const list = Array.isArray(saved) ? saved : ED.preset.slice();
    return [...new Set([...ED.locked, ...list])];
  }
  const state = {
    tab: 'home',
    filter: 'all',               // 'all' or a team id
    teams: initialTeams(),       // followed Highlightly team ids
    info: {},                    // team id → { id, name, logo }
    matchesByTeam: {},           // team id → [match]
    cacheSecs: {},               // team id → seconds
    errors: {},                  // label → message
    standings: {},               // comp key → response | {loading} | {error}
    tableComp: store.get('ft.tableComp', 'PL'),
    stats: {},                   // team id → response | {loading} | {error}
    statsTeam: null,
    statsComp: 'all',
    statsSort: 'apps',
    openPlayer: null,
    matchEvents: {},             // match id → events array | 'loading' | {error}
    showOlder: false,
    loadedAt: null,
    loading: true,
  };
  for (const [id, t] of Object.entries(CFG.knownTeams || {})) state.info[id] = { id: Number(id), name: t.name, logo: null };

  const compByKey = Object.fromEntries(CFG.competitions.map(c => [c.key, c]));
  function compOf(league) {
    if (!league) return null;
    for (const c of CFG.competitions) {
      if (c.id && league.id === c.id) return c;
      if (!c.id && c.nameMatch && c.nameMatch.test(league.name || '')) { c.id = league.id; return c; } // learn the ID
    }
    return null;
  }

  // ── API ─────────────────────────────────────────────────────────────────
  async function api(path, params = {}) {
    const res = await fetch('/api/football?' + new URLSearchParams({ path, ...params }));
    let json = null;
    try { json = await res.json(); } catch { /* handled below */ }
    if (!res.ok) {
      const up = json && json.upstream;
      const detail = (up && (up.message || up.error)) || (json && json.error) || res.statusText;
      throw new Error(res.status === 429 ? 'Daily request limit reached at Highlightly' : String(detail));
    }
    return { json, cacheSeconds: parseInt(res.headers.get('X-Football-Cache-Seconds'), 10) || null };
  }
  const listOf = j => Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : []);

  function remember(team) {
    if (!team || !team.id) return;
    const cur = state.info[team.id] || {};
    state.info[team.id] = { id: team.id, name: team.name || cur.name, logo: team.logo || cur.logo || null };
  }

  async function loadStandings(key) {
    const c = compByKey[key];
    if (!c || !c.id) return;
    state.standings[key] = state.standings[key] && !state.standings[key].error ? state.standings[key] : { loading: true };
    try {
      const { json } = await api('/standings', { leagueId: c.id, season: SEASON });
      state.standings[key] = json || {};
      for (const g of (json && json.groups) || []) for (const r of g.standings || []) remember(r.team);
    } catch (e) {
      state.standings[key] = { error: e.message };
    }
  }

  async function loadTeamMatches(id) {
    const [h, a] = await Promise.all([
      api('/matches', { homeTeamId: id, season: SEASON, limit: 100 }),
      api('/matches', { awayTeamId: id, season: SEASON, limit: 100 }),
    ]);
    const seen = new Set();
    const list = [];
    for (const m of [...listOf(h.json), ...listOf(a.json)]) {
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      const c = compOf(m.league);
      if (!c) continue; // friendlies and other competitions are left out
      m._comp = c;
      remember(m.homeTeam); remember(m.awayTeam);
      list.push(m);
    }
    state.matchesByTeam[id] = list;
    state.cacheSecs[id] = Math.min(...[h.cacheSeconds, a.cacheSeconds].filter(Boolean), 3600);
    delete state.errors['team:' + id];
  }

  async function loadAll() {
    state.loading = true;
    render();
    await Promise.all(CFG.pickerLeagues.map(loadStandings));
    await Promise.all(state.teams.map(id => loadTeamMatches(id).catch(e => { state.errors['team:' + id] = e.message; })));
    state.loading = false;
    state.loadedAt = Date.now();
    render();
    scheduleRefresh();
  }

  // ── Live refresh: only teams with something live or about to start ─────
  let refreshTimer = null, refreshDueAt = 0;
  function activeTeams() {
    return state.teams.filter(id => (state.matchesByTeam[id] || []).some(m => {
      if (phase(m) === 'live' || isOverdue(m)) return true;
      const until = kickoff(m) - Date.now();
      return phase(m) === 'upcoming' && until > 0 && until < 3 * HOUR;
    }));
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    const active = activeTeams();
    const secs = active.length
      ? Math.max(20, Math.min(...active.map(id => state.cacheSecs[id] || 60)))
      : 30 * 60;
    state.liveEvery = active.length ? secs : null;
    refreshDueAt = Date.now() + secs * 1000;
    refreshTimer = setTimeout(runRefresh, secs * 1000);
    updateStamp();
  }
  async function runRefresh() {
    if (document.hidden) return;
    const active = activeTeams();
    const targets = active.length ? active : state.teams;
    if (!active.length) await Promise.all(CFG.pickerLeagues.map(loadStandings));
    await Promise.all(targets.map(id => loadTeamMatches(id).catch(e => { state.errors['team:' + id] = e.message; })));
    state.loadedAt = Date.now();
    render();
    scheduleRefresh();
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && refreshDueAt && Date.now() >= refreshDueAt) runRefresh();
  });
  function updateStamp() {
    const el = $('updated');
    if (!state.loadedAt) { el.textContent = state.loading ? 'Loading…' : ''; return; }
    let s = 'Updated ' + fTime.format(new Date(state.loadedAt));
    if (state.liveEvery) s += ' · live scores update automatically';
    el.textContent = s;
  }

  // ── Data views ──────────────────────────────────────────────────────────
  function allMatches() {
    const seen = new Set(), out = [];
    for (const id of state.teams) for (const m of state.matchesByTeam[id] || []) {
      if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
    }
    return out;
  }
  const involves = (m, id) => (m.homeTeam && m.homeTeam.id === id) || (m.awayTeam && m.awayTeam.id === id);
  const isFollowed = team => !!team && state.teams.includes(team.id);
  const teamName = id => (state.info[id] && state.info[id].name) || 'Team';

  function leaguePosition(id) {
    for (const key of CFG.pickerLeagues) {
      const s = state.standings[key];
      for (const g of (s && s.groups) || []) {
        const r = (g.standings || []).find(x => x.team && x.team.id === id);
        if (r) return { comp: compByKey[key], row: r };
      }
    }
    return null;
  }

  // ── Rendering helpers ───────────────────────────────────────────────────
  function initials(name) {
    const w = String(name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  }
  function hue(name) { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
  function crest(team, size = '') {
    team = team || {};
    const t = state.info[team.id] || team;
    const name = t.name || team.name;
    const fb = `<span class="crest crest-fallback ${size}" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
    const logo = team.logo || t.logo;
    if (!logo) return fb;
    return `<img class="crest ${size}" src="${esc(logo)}" alt="" loading="lazy" data-fallback="${esc(initials(name))}" data-hue="${hue(name)}">`;
  }
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
    const span = document.createElement('span');
    span.className = img.className + ' crest-fallback';
    span.style.setProperty('--h', img.dataset.hue);
    span.textContent = img.dataset.fallback;
    img.replaceWith(span);
  }, true);

  function resultFor(m, id) {
    const s = scoreOf(m);
    if (!s) return null;
    const home = m.homeTeam.id === id;
    const f = home ? s[0] : s[1], a = home ? s[1] : s[0];
    if (f === a) {
      const p = pensOf(m);
      if (p) { const pf = home ? p[0] : p[1], pa = home ? p[1] : p[0]; return pf > pa ? 'W' : 'L'; }
      return 'D';
    }
    return f > a ? 'W' : 'L';
  }

  function scoreLine(m) {
    const s = scoreOf(m);
    const p = pensOf(m);
    const pens = p ? ` <small>(${p[0]}–${p[1]} pens)</small>` : '';
    return `${esc(m.homeTeam.name)} <b>${s ? s[0] : ''}–${s ? s[1] : ''}</b> ${esc(m.awayTeam.name)}${pens}`;
  }

  function matchCard(m) {
    const ph = phase(m);
    const s = scoreOf(m);
    const showScore = s && ph !== 'upcoming' && ph !== 'postponed';
    const tag = statusTag(m);
    let right;
    if (ph === 'live') right = `<span class="live-pill"><i></i>${esc(liveLabel(m))}</span>`;
    else if (isOverdue(m)) right = '<span class="tag">Awaiting update</span>';
    else if (tag) right = `<span class="tag tag-${ph}">${esc(tag)}</span>`;
    else right = `<span class="when">${ph === 'upcoming' ? fTime.format(new Date(kickoff(m))) : 'FT'}</span>`;
    const hw = showScore && (s[0] > s[1] || (s[0] === s[1] && pensOf(m) && pensOf(m)[0] > pensOf(m)[1]));
    const aw = showScore && (s[1] > s[0] || (s[0] === s[1] && pensOf(m) && pensOf(m)[1] > pensOf(m)[0]));
    const row = (t, pts, win) => `
      <div class="team-row${win ? ' win' : ''}${isFollowed(t) ? ' tracked' : ''}">
        ${crest(t)}<span class="team-name">${esc(t.name)}</span><span class="pts">${showScore ? pts : ''}</span>
      </div>`;
    return `<button type="button" class="match match-${ph}" data-match="${m.id}">
      <div class="match-meta"><span class="comp">${esc(m._comp.name)}</span>${right}</div>
      ${row(m.homeTeam, showScore ? s[0] : '', hw)}${row(m.awayTeam, showScore ? s[1] : '', aw)}
    </button>`;
  }

  function dayBlocks(list) {
    const groups = [];
    let cur = null;
    for (const m of list) {
      const k = dayKey(kickoff(m));
      if (!cur || cur.key !== k) { cur = { key: k, label: fDayLong.format(new Date(kickoff(m))), items: [] }; groups.push(cur); }
      cur.items.push(m);
    }
    return groups.map(g => `<section class="day"><h2 class="day-title">${esc(g.label)}</h2>
      <div class="cards">${g.items.map(matchCard).join('')}</div></section>`).join('');
  }
  const emptyMsg = t => `<p class="empty">${t}</p>`;
  function errorBanner() {
    const errs = Object.entries(state.errors);
    if (!errs.length) return '';
    return `<div class="banner">Some data couldn't be loaded.<br>${errs.map(([k, v]) =>
      `${esc(k.startsWith('team:') ? teamName(Number(k.slice(5))) : k)}: ${esc(v)}`).join('<br>')}</div>`;
  }

  // ── Home: one card per followed team ────────────────────────────────────
  function teamCard(id) {
    const info = state.info[id] || { id, name: 'Team' };
    const list = (state.matchesByTeam[id] || []).slice().sort((a, b) => kickoff(a) - kickoff(b));
    const live = list.find(m => phase(m) === 'live' || isOverdue(m));
    const last = list.filter(m => phase(m) === 'finished' && scoreOf(m)).pop();
    const next = list.find(m => phase(m) === 'upcoming' && !isOverdue(m) && kickoff(m) > Date.now());
    const pos = leaguePosition(id);
    const sub = pos ? `${ordinal(pos.row.position)} in the ${esc(pos.comp.name)} · ${pos.row.points} pts` : '';

    let rows = '';
    if (live) {
      rows += `<button type="button" class="tc-row tc-live" data-match="${live.id}">
        <span class="tc-label"><span class="live-pill"><i></i>${phase(live) === 'live' ? 'Live · ' + esc(liveLabel(live)) : 'Kicking off'}</span></span>
        <span class="tc-main">${scoreLine(live)}</span>
        <span class="tc-sub">${esc(live._comp.name)}</span></button>`;
    }
    if (last) {
      const r = resultFor(last, id);
      rows += `<button type="button" class="tc-row" data-match="${last.id}">
        <span class="tc-label">Last match <span class="form form-${r}">${r}</span></span>
        <span class="tc-main">${scoreLine(last)}</span>
        <span class="tc-sub">${esc(fDayShort.format(new Date(kickoff(last))))} · ${esc(last._comp.name)}</span></button>`;
    }
    if (next) {
      rows += `<button type="button" class="tc-row" data-match="${next.id}">
        <span class="tc-label">Next match</span>
        <span class="tc-main">${esc(next.homeTeam.name)} v ${esc(next.awayTeam.name)}</span>
        <span class="tc-sub">${esc(whenShort(kickoff(next)))} · ${esc(next._comp.name)}</span></button>`;
    }
    if (!rows) rows = `<p class="muted tc-none">${state.loading ? 'Loading…' : 'No matches listed yet.'}</p>`;
    return `<section class="team-card">
      <header class="tc-head">${crest(info, 'lg')}<div><h2>${esc(info.name)}</h2>
        ${sub ? `<p>${sub}</p>` : ''}</div></header>
      ${rows}
    </section>`;
  }

  function renderHome() {
    if (!state.teams.length) {
      return `<section class="welcome">
        <h2>Welcome</h2>
        <p>Choose the teams you follow. Your choice is saved on this device.</p>
        <button type="button" class="primary-btn" data-action="pick">Choose teams</button>
      </section>`;
    }
    return state.teams.map(teamCard).join('') +
      `<button type="button" class="link-btn" data-action="pick">Change teams</button>`;
  }

  function teamChips() {
    if (state.teams.length < 2) return '';
    const chips = [['all', 'All my teams']].concat(state.teams.map(id => [String(id), teamName(id)]));
    return `<div class="chips">${chips.map(([k, l]) =>
      `<button type="button" class="chip${String(state.filter) === k ? ' on' : ''}" data-filter="${k}">${k === 'all' ? '' : crest({ id: Number(k) }, 'xs')}${esc(l)}</button>`).join('')}</div>`;
  }
  const passes = m => state.filter === 'all' || involves(m, Number(state.filter));

  function renderFixtures() {
    const all = allMatches();
    const list = all.filter(m => ((phase(m) === 'upcoming' && !isOverdue(m)) || phase(m) === 'postponed' || phase(m) === 'live' || isOverdue(m)) && passes(m))
      .sort((a, b) => kickoff(a) - kickoff(b));
    const horizon = all.filter(m => phase(m) === 'upcoming').reduce((mx, m) => Math.max(mx, kickoff(m)), 0);
    const note = horizon ? `<p class="footnote">Fixtures are listed up to ${esc(fDayShort.format(new Date(horizon)))}. More are added as the season goes on.</p>` : '';
    return teamChips() + (list.length ? dayBlocks(list) : emptyMsg('No fixtures listed.')) + note;
  }

  function renderResults() {
    const list = allMatches().filter(m => (phase(m) === 'finished' || phase(m) === 'cancelled') && passes(m))
      .sort((a, b) => kickoff(b) - kickoff(a));
    if (!list.length) return teamChips() + emptyMsg('No results yet this season.');
    const cutoff = Date.now() - RESULTS_DAYS * DAY;
    const recent = state.showOlder ? list : list.filter(m => kickoff(m) >= cutoff);
    const hidden = list.length - recent.length;
    return teamChips() + (recent.length ? dayBlocks(recent) : emptyMsg(`No results in the last ${RESULTS_DAYS} days.`)) +
      (hidden > 0 ? `<button type="button" class="more-btn" data-action="older">Show ${hidden} earlier result${hidden === 1 ? '' : 's'}</button>` : '');
  }

  // ── Tables (layout from the original football app) ──────────────────────
  function renderTables() {
    const comps = CFG.competitions.filter(c => c.table && c.id);
    if (!comps.some(c => c.key === state.tableComp)) state.tableComp = comps[0].key;
    const comp = compByKey[state.tableComp];
    const chips = comps.map(c => `<button type="button" class="chip${c.key === comp.key ? ' on' : ''}" data-table="${c.key}">${esc(c.name)}</button>`).join('');
    const data = state.standings[comp.key];
    let body;
    if (!data || data.loading) {
      body = emptyMsg('Loading table…');
      if (!data) loadStandings(comp.key).then(() => { if (state.tab === 'tables') render(); });
    } else if (data.error) body = `<div class="banner">Couldn't load the table: ${esc(data.error)}</div>`;
    else {
      const groups = (data.groups || []).filter(g => (g.standings || []).length);
      body = groups.length ? groups.map(g => standingsTable(g, groups.length > 1)).join('') : emptyMsg('No table available yet.');
    }
    return `<div class="chips table-chips">${chips}</div>${body}`;
  }
  function standingsTable(group, showName) {
    const rows = (group.standings || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    const body = rows.map(r => {
      const t = r.total || {};
      const gd = (t.scoredGoals || 0) - (t.receivedGoals || 0);
      return `<tr class="${isFollowed(r.team) ? 'tracked' : ''}">
        <td class="pos">${r.position ?? ''}</td>
        <td class="team-col">${crest(r.team, 'sm')}<span class="tname" title="${esc(r.team.name)}">${esc(r.team.name)}</span></td>
        <td>${t.games ?? 0}</td><td>${t.wins ?? 0}</td><td>${t.draws ?? 0}</td><td>${t.loses ?? 0}</td>
        <td class="wide-only">${t.scoredGoals ?? 0}</td><td class="wide-only">${t.receivedGoals ?? 0}</td>
        <td>${gd > 0 ? '+' + gd : gd}</td><td class="pts-col">${r.points ?? 0}</td></tr>`;
    }).join('');
    return `<section class="table-section">
      ${showName && group.name ? `<h3 class="table-title">${esc(group.name)}</h3>` : ''}
      <div class="table-wrap"><table class="standings">
        <thead><tr><th>#</th><th class="team-col">Team</th><th>P</th><th>W</th><th>D</th><th>L</th>
          <th class="wide-only" title="Goals for">GF</th><th class="wide-only" title="Goals against">GA</th><th title="Goal difference">GD</th><th>Pts</th></tr></thead>
        <tbody>${body}</tbody></table></div></section>`;
  }

  // ── Stats (from the shared Firebase records written by the nightly job) ──
  const COMP_LABEL = { PL: 'Premier League', ELC: 'Championship', EFL: 'League Cup', FAC: 'FA Cup', CL: 'Champions League' };
  const statKey = m => `${String(m.date || '').slice(0, 10)}|${m.opponent || ''}`;
  function dedupe(list) { const seen = new Map(); for (const m of list || []) seen.set(statKey(m), m); return [...seen.values()]; }

  async function ensureStats(id) {
    if (state.stats[id] && !state.stats[id].error) return;
    state.stats[id] = { loading: true };
    try {
      const res = await fetch('/api/stats?' + new URLSearchParams({ teamId: id }));
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      state.stats[id] = json;
    } catch (e) { state.stats[id] = { error: e.message }; }
    if (state.tab === 'stats') render();
  }

  // Card minutes aren't in the saved stats, so they're looked up from each booked match's events.
  const normName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').trim();
  function samePlayer(a, b) {
    const x = normName(a).split(/\s+/), y = normName(b).split(/\s+/);
    if (!x[0] || !y[0]) return false;
    if (x.join(' ') === y.join(' ')) return true;
    return x[x.length - 1] === y[y.length - 1] && x[0][0] === y[0][0]; // same surname and first initial
  }
  function ensureEvents(matchId) {
    if (state.matchEvents[matchId]) return;
    state.matchEvents[matchId] = 'loading';
    api('/events/' + matchId, { _settled: '1' })
      .then(({ json }) => { state.matchEvents[matchId] = Array.isArray(json) ? json : listOf(json); })
      .catch(e => { state.matchEvents[matchId] = { error: e.message }; })
      .finally(() => { if (state.tab === 'stats') render(); });
  }
  function cardMinutes(m, playerName, teamId) {
    const ev = state.matchEvents[m.id];
    if (!Array.isArray(ev)) return null;
    return ev.filter(e => /card/i.test(e.type || '') && (!e.team || e.team.id === teamId) && samePlayer(e.player, playerName))
      .map(e => /yellow card\/red card/i.test(e.type) ? `second yellow ${e.time}′`
        : /red/i.test(e.type) ? `red card ${e.time}′` : `yellow card ${e.time}′`);
  }

  function renderStats() {
    if (!state.teams.length) return emptyMsg('Choose your teams first.');
    if (!state.teams.includes(state.statsTeam)) state.statsTeam = state.teams[0];
    const id = state.statsTeam;
    const chips = state.teams.length > 1 ? `<div class="chips">${state.teams.map(t =>
      `<button type="button" class="chip${t === id ? ' on' : ''}" data-stats-team="${t}">${crest({ id: t }, 'xs')}${esc(teamName(t))}</button>`).join('')}</div>` : '';
    const data = state.stats[id];
    if (!data || data.loading) { if (!data) ensureStats(id); return chips + emptyMsg('Loading stats…'); }
    if (data.error) return chips + `<div class="banner">Couldn't load stats: ${esc(data.error)}</div>`;
    if (data.missing) return chips + emptyMsg(`No stats are available for ${esc(teamName(id))} yet.`);

    const teamMatches = dedupe(data.teamMatches);
    const comps = [...new Set(teamMatches.map(m => m.competition))].filter(c => COMP_LABEL[c]);
    if (state.statsComp !== 'all' && !comps.includes(state.statsComp)) state.statsComp = 'all';
    const inComp = m => state.statsComp === 'all' ? COMP_LABEL[m.competition] : m.competition === state.statsComp;
    const compChips = comps.length > 1 ? `<div class="chips stat-chips">${[['all', 'All competitions'], ...comps.map(c => [c, COMP_LABEL[c]])]
      .map(([k, l]) => `<button type="button" class="chip${state.statsComp === k ? ' on' : ''}" data-stats-comp="${k}">${esc(l)}</button>`).join('')}</div>` : '';

    // Team summary: every figure recomputed from the individual matches.
    const tm = teamMatches.filter(inComp).sort((a, b) => new Date(a.date) - new Date(b.date));
    const n = tm.length;
    const sum = f => tm.reduce((t, m) => t + (Number(m[f]) || 0), 0);
    const count = r => tm.filter(m => m.result === r).length;
    const withPoss = tm.filter(m => Number(m.possession) > 0);
    const tile = (v, l) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`;
    const form = tm.slice(-5).map(m => `<span class="form form-${esc(m.result)}">${esc(m.result)}</span>`).join('');
    const summary = n ? `<section class="stat-summary">
      <div class="tiles">
        ${tile(n, 'Played')}${tile(`${count('W')}-${count('D')}-${count('L')}`, 'Won-Drawn-Lost')}
        ${tile(`${sum('goalsFor')}-${sum('goalsAgainst')}`, 'Goals for-against')}${tile(tm.filter(m => m.cleanSheet).length, 'Clean sheets')}
        ${withPoss.length ? tile(Math.round(withPoss.reduce((t, m) => t + Number(m.possession), 0) / withPoss.length) + '%', 'Average possession') : ''}
        ${tile((sum('shots') / n).toFixed(1), 'Shots per game')}
      </div>
      ${form ? `<p class="stat-form">Last ${Math.min(5, n)}: ${form}</p>` : ''}</section>` : emptyMsg('No matches recorded for this selection.');

    // Players: totals recomputed from each player's own match list, for the chosen competitions.
    const players = (data.players || []).map(p => {
      const ms = dedupe(p.matches).filter(inComp).sort((a, b) => new Date(b.date) - new Date(a.date));
      const s = f => ms.reduce((t, m) => t + (Number(m[f]) || 0), 0);
      const starts = ms.filter(m => m.started).length;
      return { ...p, ms, starts, subs: ms.length - starts, apps: ms.length, mins: s('minutesPlayed'), goals: s('goals'), assists: s('assists'), yc: s('yellowCards'), rc: s('redCards') };
    }).filter(p => p.apps > 0);
    const sorters = { apps: (a, b) => b.apps - a.apps || b.mins - a.mins, goals: (a, b) => b.goals - a.goals || b.assists - a.assists, assists: (a, b) => b.assists - a.assists || b.goals - a.goals, mins: (a, b) => b.mins - a.mins };
    players.sort((a, b) => (sorters[state.statsSort] || sorters.apps)(a, b) || a.name.localeCompare(b.name));
    const th = (key, label, cls = '') => `<th class="${cls}"><button type="button" class="sort${state.statsSort === key ? ' on' : ''}" data-sort="${key}">${label}</button></th>`;
    const rows = players.map(p => {
      const open = state.openPlayer === p.id;
      const detail = open ? `<tr class="pl-detail"><td colspan="7"><ul>${p.ms.map(m => {
        const bits = [m.started ? `started${m.minutesPlayed ? `, ${m.minutesPlayed} min` : ''}` : `sub${m.cameOnMinute ? ` (${m.cameOnMinute}′)` : ''}`];
        if (m.goals) bits.push(`⚽ ${m.goals > 1 ? '×' + m.goals : ''}`.trim());
        if (m.assists) bits.push(`assist${m.assists > 1 ? ' ×' + m.assists : ''}`);
        if (m.yellowCards || m.redCards) {
          if (m.id) ensureEvents(m.id);
          const mins = m.id ? cardMinutes(m, p.name, id) : null;
          if (mins && mins.length) bits.push(...mins);
          else {
            if (m.yellowCards) bits.push(state.matchEvents[m.id] === 'loading' ? 'yellow card …' : 'yellow card');
            if (m.redCards) bits.push(state.matchEvents[m.id] === 'loading' ? 'red card …' : 'red card');
          }
        }
        return `<li><span>${esc(fDayShort.format(new Date(m.date)))}</span> v ${esc(m.opponent)} (${esc(m.homeAway)}) ${esc(m.score || '')} · ${esc(bits.join(' · '))}</li>`;
      }).join('')}</ul></td></tr>` : '';
      return `<tr class="pl-row${open ? ' open' : ''}" data-player="${esc(p.id)}">
        <td class="team-col"><span class="tname">${esc(p.name)}</span></td>
        <td>${p.apps}${p.subs ? `<small> (${p.subs})</small>` : ''}</td><td class="wide-only">${p.mins}</td>
        <td>${p.goals}</td><td>${p.assists}</td><td>${p.yc}</td><td>${p.rc}</td></tr>${detail}`;
    }).join('');
    const table = players.length ? `<section class="table-section"><div class="table-wrap"><table class="standings players">
      <thead><tr><th class="team-col">Player</th>${th('apps', 'Apps')}${th('mins', 'Mins', 'wide-only')}${th('goals', 'G')}${th('assists', 'A')}<th title="Yellow cards">YC</th><th title="Red cards">RC</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="footnote">Apps (sub appearances in brackets). Tap a column to sort, or a player for their matches.${data.updatedAt ? ` Updated ${esc(fDayShort.format(new Date(data.updatedAt)))}.` : ''}</p></section>` : '';
    return chips + compChips + summary + table;
  }

  // ── Main render ─────────────────────────────────────────────────────────
  function render() {
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    updateStamp();
    const content = $('content');
    if (state.loading && !state.loadedAt && state.tab !== 'home') { content.innerHTML = emptyMsg('Loading…'); return; }
    const html = { home: renderHome, fixtures: renderFixtures, results: renderResults, tables: renderTables, stats: renderStats }[state.tab]();
    content.innerHTML = errorBanner() + html;
  }

  // ── Match detail ────────────────────────────────────────────────────────
  const findMatch = id => allMatches().find(m => String(m.id) === String(id));
  function eventsHtml(events, m) {
    const list = Array.isArray(events) ? events : listOf(events);
    const goals = list.filter(e => /^(goal|penalty|own goal)$/i.test(e.type || ''));
    const reds = list.filter(e => /red card/i.test(e.type || ''));
    if (!goals.length && !reds.length) return '<p class="muted">No goals recorded.</p>';
    const minute = e => parseInt(e.time, 10) || 0;
    const side = id => [...goals, ...reds].filter(e => e.team && e.team.id === id).sort((a, b) => minute(a) - minute(b))
      .map(e => {
        const kind = /red/i.test(e.type) ? '<span class="card-red" title="Red card"></span>'
          : /own/i.test(e.type) ? '⚽ <small>(og)</small>' : /penalty/i.test(e.type) ? '⚽ <small>(pen)</small>' : '⚽';
        const assist = e.assist && !/red/i.test(e.type) ? ` <small class="assist">(${esc(e.assist)})</small>` : '';
        return `<li><span class="ev-min">${esc(e.time)}′</span> ${kind} ${esc(e.player || '')}${assist}</li>`;
      }).join('');
    return `<div class="events"><ul>${side(m.homeTeam.id)}</ul><ul>${side(m.awayTeam.id)}</ul></div>`;
  }
  function renderSheet(m, events) {
    const ph = phase(m);
    const s = scoreOf(m), p = pensOf(m);
    const showScore = s && ph !== 'upcoming' && ph !== 'postponed';
    const status = ph === 'live' ? `<span class="live-pill"><i></i>${esc(liveLabel(m))}</span>`
      : statusTag(m) ? `<span class="tag tag-${ph}">${esc(statusTag(m))}</span>`
      : ph === 'finished' ? '<span class="tag">Full time</span>' : '';
    let detail = '';
    if (ph === 'finished' || ph === 'live') {
      detail = events === 'loading' ? '<p class="muted">Loading goals…</p>'
        : events && events.error ? `<p class="muted">Couldn't load goals: ${esc(events.error)}</p>`
        : events ? `<section class="detail-block"><h3>Goals</h3>${eventsHtml(events, m)}</section>` : '';
    }
    $('matchBody').innerHTML = `
      <p class="sheet-kicker" id="matchTitle">${esc(m._comp.name)}</p>
      <p class="sheet-when">${esc(whenShort(kickoff(m)))} ${status}</p>
      <div class="scoreboard" data-match="${m.id}">
        <div class="sb-team">${crest(m.homeTeam, 'lg')}<span>${esc(m.homeTeam.name)}</span></div>
        <div class="sb-score">${showScore ? `${s[0]}<i>–</i>${s[1]}` : '<small>v</small>'}${p ? `<em>${p[0]}–${p[1]} on penalties</em>` : ''}</div>
        <div class="sb-team">${crest(m.awayTeam, 'lg')}<span>${esc(m.awayTeam.name)}</span></div>
      </div>
      ${detail}`;
  }
  async function openMatch(id) {
    const m = findMatch(id);
    if (!m) return;
    openOverlay('matchOverlay');
    const ph = phase(m);
    if (ph !== 'finished' && ph !== 'live') { renderSheet(m, null); return; }
    renderSheet(m, 'loading');
    let ev;
    try { ev = (await api('/events/' + m.id)).json; } catch (e) { ev = { error: e.message }; }
    if (!$('matchOverlay').hidden && $('matchBody').querySelector(`[data-match="${m.id}"]`)) renderSheet(m, ev);
  }

  // ── Team picker ─────────────────────────────────────────────────────────
  function pickerGroups() {
    return CFG.pickerLeagues.map(key => {
      const s = state.standings[key];
      const teams = [];
      for (const g of (s && s.groups) || []) for (const r of g.standings || []) if (r.team) teams.push(r.team);
      teams.sort((a, b) => a.name.localeCompare(b.name));
      return { comp: compByKey[key], teams };
    });
  }
  function renderPicker() {
    const groups = pickerGroups();
    $('pickGrid').innerHTML = groups.map(g => `
      <h3 class="pick-group">${esc(g.comp.name)}</h3>
      <div class="pick-grid">${g.teams.length ? g.teams.map(t => {
        const on = state.teams.includes(t.id), locked = LOCKED.has(t.id);
        return `<button type="button" class="pick${on ? ' on' : ''}${locked ? ' locked' : ''}" data-pick="${t.id}" aria-pressed="${on}" ${locked ? 'aria-disabled="true"' : ''}>
          ${crest(t)}<span>${esc(t.name)}</span>${locked ? '<span class="lock">🔒</span>' : ''}</button>`;
      }).join('') : '<p class="muted">Loading clubs…</p>'}</div>`).join('');
  }
  function togglePick(id) {
    id = Number(id);
    if (LOCKED.has(id)) return;
    if (state.teams.includes(id)) {
      state.teams = state.teams.filter(x => x !== id);
      if (String(state.filter) === String(id)) state.filter = 'all';
    } else {
      state.teams = [...state.teams, id];
      loadTeamMatches(id).then(render, e => { state.errors['team:' + id] = e.message; render(); });
    }
    store.set(TEAMS_KEY, state.teams);
    renderPicker();
    render();
  }

  // ── Overlays and events ─────────────────────────────────────────────────
  function openOverlay(id) { $(id).hidden = false; document.body.classList.add('no-scroll'); }
  function closeOverlays() {
    document.querySelectorAll('.overlay').forEach(o => { o.hidden = true; });
    document.body.classList.remove('no-scroll');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlays(); });

  document.addEventListener('click', e => {
    const row = e.target.closest('tr.pl-row');
    if (row) { const pid = row.dataset.player; state.openPlayer = String(state.openPlayer) === pid ? null : (isNaN(pid) ? pid : Number(pid)); render(); return; }
    const t = e.target.closest('button, .overlay');
    if (!t) return;
    if (t.classList.contains('overlay')) { if (e.target === t) closeOverlays(); return; }
    if (t.dataset.close !== undefined) return closeOverlays();
    if (t.dataset.tab) {
      state.tab = t.dataset.tab;
      history.replaceState(null, '', location.pathname + (state.tab === 'home' ? '' : '#' + state.tab));
      render(); window.scrollTo({ top: 0 }); return;
    }
    if (t.dataset.filter) { state.filter = t.dataset.filter; render(); return; }
    if (t.dataset.table) { state.tableComp = t.dataset.table; store.set('ft.tableComp', state.tableComp); render(); return; }
    if (t.dataset.pick) return togglePick(t.dataset.pick);
    if (t.dataset.statsTeam) { state.statsTeam = Number(t.dataset.statsTeam); state.openPlayer = null; render(); return; }
    if (t.dataset.statsComp) { state.statsComp = t.dataset.statsComp; render(); return; }
    if (t.dataset.sort) { state.statsSort = t.dataset.sort; render(); return; }
    if (t.dataset.action === 'older') { state.showOlder = true; render(); return; }
    if (t.dataset.action === 'pick') { renderPicker(); openOverlay('pickOverlay'); return; }
    if (t.dataset.match && (t.classList.contains('match') || t.classList.contains('tc-row'))) return openMatch(t.dataset.match);
  });

  // ── Start ───────────────────────────────────────────────────────────────
  if (ED.title) { document.title = ED.title; $('brandTitle').textContent = ED.title; }
  const fromHash = location.hash.slice(1);
  state.tab = ['home', 'fixtures', 'results', 'tables', 'stats'].includes(fromHash) ? fromHash : 'home';
  if (EDITION !== 'main' && store.get(TEAMS_KEY, null) === null) store.set(TEAMS_KEY, state.teams);
  if (!state.teams.length && EDITION === 'main') loadAll().then(() => { renderPicker(); openOverlay('pickOverlay'); });
  else loadAll();

  window.__ft = { state, phase, STATUS_GROUPS, EDITION, SEASON };
})();
