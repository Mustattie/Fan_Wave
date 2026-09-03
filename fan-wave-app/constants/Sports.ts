// v9.4.2 UAT: dropped generic 'soccer' pill since MLS is our only soccer
// league today and having both created a "why are these different?" UX
// question on Discover. If we add international soccer later, either
// re-introduce as a filter for a specific league (e.g. 'epl') or gate
// the umbrella 'soccer' pill behind a multi-league state.
export const SPORTS = [
  { id: 'nfl', name: 'NFL', icon: '🏈', color: '#0096ff' },
  { id: 'nba', name: 'NBA', icon: '🏀', color: '#ff8c00' },
  { id: 'wnba', name: 'WNBA', icon: '🏀', color: '#ff6b35' },
  { id: 'mlb', name: 'MLB', icon: '⚾', color: '#cc0000' },
  { id: 'nhl', name: 'NHL', icon: '🏒', color: '#000080' },
  { id: 'cfb', name: 'College FB', icon: '🏈', color: '#8b4513' },
  { id: 'cbb', name: 'College BB', icon: '🏀', color: '#800080' },
  { id: 'mls', name: 'MLS', icon: '⚽', color: '#006400' },
  // v9.5.3: UFC/Boxing removed. It was offered as a filter but the sync's
  // SPORT_LEAGUE_MAP has no UFC entry, so no game could ever be written with
  // sport_id='ufc' -- the pill was structurally guaranteed to render an empty
  // state. Nothing referenced it in prod (0 groups, 0 parties, 0 games, 0
  // teams), so this removes an advertised sport we do not carry rather than
  // taking anything away. Re-add alongside a SPORT_LEAGUE_MAP entry, not
  // before.
] as const;

export const SPORT_BY_ID = Object.fromEntries(SPORTS.map(s => [s.id, s]));

export type SportId = typeof SPORTS[number]['id'];
