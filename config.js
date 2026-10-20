// config.js — competitions, team presets and starting links.
// League and team IDs are Highlightly's (from the working football apps). Always use IDs, never names.

window.FOOTBALL_CONFIG = {
  // Competitions shown. Matches in anything else (friendlies etc.) are left out.
  //   table: true if the Tables tab shows it.
  //   nameMatch: used until the Highlightly ID is confirmed from real data
  //              (the app learns the ID from the first matching match it sees).
  competitions: [
    { key: 'PL', id: 33973, name: 'Premier League', short: 'Premier League', table: true },
    { key: 'ELC', id: 34824, name: 'Championship', short: 'Championship', table: true },
    { key: 'CL', id: null, nameMatch: /^UEFA Champions League$/i, name: 'Champions League', short: 'Champions League', table: true },
    { key: 'FAC', id: 146305, name: 'FA Cup', short: 'FA Cup', table: false },
    { key: 'EFL', id: 41632, name: 'League Cup', short: 'League Cup', table: false },
  ],

  // Leagues whose clubs appear in the team picker.
  pickerLeagues: ['PL', 'ELC'],

  // Starting links. The part after the address picks the edition:
  //   /        → "main": first visit asks people to pick their teams
  //   /family  → starts with the family's four teams, no choosing needed
  //   /bwfc    → Bolton, locked (cannot be removed); others can be added
  editions: {
    main: { title: 'Football', preset: [], locked: [] },
    family: { title: 'Football', preset: [36526, 42483, 58652, 54397], locked: [] }, // Arsenal, Chelsea, Bolton, Leeds
    bwfc: { title: 'Bolton', preset: [58652], locked: [58652] },
  },

  // Names and crests used before the live data arrives (and in case a logo is missing).
  knownTeams: {
    36526: { name: 'Arsenal' },
    42483: { name: 'Chelsea' },
    58652: { name: 'Bolton Wanderers' },
    54397: { name: 'Leeds United' },
  },
};
