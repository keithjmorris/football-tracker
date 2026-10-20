# Data notes

## Sources of truth (20 Oct 2026)
- League IDs, team IDs, `/standings` row shape and match score format come from the working
  football-app code (production, real data): PL 33973, Championship 34824, FA Cup 146305, League Cup 41632.
- Team IDs: Arsenal 36526, Chelsea 42483, Bolton 58652, Leeds 54397.
- Status values and fields from the Highlightly football OpenAPI spec:
  state.description (19 values), state.clock (minute), state.score.current "H - A", state.score.penalties.
- Standings rows: team, position, points, total/home/away {games, wins, draws, loses, scoredGoals, receivedGoals}.
- Seasons are named by their starting year: 2026 = 2026/27.

## Confirmed with real data (20 Oct 2026)
- Champions League = league 2486 ("UEFA Champions League"), seasons up to 2026.
- `/events/{id}` returns an array of {team{id,name,logo}, time ("62"), type, player, playerId, assist,
  assistingPlayerId, substituted}. Types seen: "Goal", "Yellow Card", "Substitution".
  Managers can appear with a yellow card (playerId null). Penalty / Own Goal / Red Card type names are
  from the spec and the old stats script, not yet seen in a real response.

## Stats (Stats tab)
- Read from Firebase `player_stats/raw_{footballDataId}_{season}`, written nightly by the stats job
  (currently in bwfc-app). `api/stats.js` maps Highlightly ids to football-data ids for the 44 clubs.
- Competitions recorded: PL, ELC, EFL (League Cup), FAC. Champions League is not recorded yet.
- The app recomputes every total from the individual match entries and ignores duplicate
  entries (same date + opponent), so a misbehaving job cannot inflate the figures shown.
- Card minutes are not in the saved stats. When a player is opened, the app fetches `/events/{matchId}`
  for each match where they were booked (cached a week via `_settled=1`) and matches the card by name
  (exact, or same surname and first initial, e.g. "A. Collins" = "Aaron Collins").

## Nightly stats job (moved here from bwfc-app, 20 Oct 2026)
- `api/cron/populate.js`, 23:00 UTC daily. Records PL, Championship, League Cup, FA Cup and now Champions League ('CL').
- Saves with a service account (Admin SDK), so `firestore.rules` can block all public writes.
- Before this, the Firestore rules were `allow read, write: if true` for everything.

## Match popup (20 Oct 2026)
- Fetches `/events/{id}`, `/lineups/{id}` and `/statistics/{id}` (cached a week for finished matches).
- Substitution events: `player` goes OFF, `substituted` comes ON (confirmed: Ben White assisted at 62′,
  then "player: Ben White, substituted: Jurriën Timber" at 63′). The old app showed these reversed.
- Line-ups shape (from the old app's working code): {homeTeam, awayTeam} each {formation,
  initialLineup: [[row of players]], substitutes: [players]}, player {id, name, number, position}.
- Statistics: array of {team{id}, statistics:[{displayName, value}]}; Possession may be a fraction (0.59).
- Managers can receive cards (e.g. Daniel Farke) and appear in the cards list.

## Job run report
- Each nightly run saves `player_stats/_lastRun` {startedAt, finishedAt, season, results[]}.
  Read it at `/api/stats?job=1`.
