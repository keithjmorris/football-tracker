// config.js — competitions, team presets and starting links.
// League and team IDs are Highlightly's (from the working football apps). Always use IDs, never names.

window.FOOTBALL_CONFIG = {
  // Competitions shown. Matches in anything else (friendlies etc.) are left out.
  //   table: true if the Tables tab shows it.
  //   nameMatch (optional): recognise a competition by name until its ID is known.
  competitions: [
    { key: 'PL', id: 33973, name: 'Premier League', short: 'Premier League', table: true },
    { key: 'ELC', id: 34824, name: 'Championship', short: 'Championship', table: true },
    { key: 'CL', id: 2486, name: 'Champions League', short: 'Champions League', table: true }, // confirmed from /leagues, 20 Oct 2026
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
