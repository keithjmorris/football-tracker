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
