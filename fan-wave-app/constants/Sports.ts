export const SPORTS = [
  { id: 'nfl', name: 'NFL', icon: '🏈', color: '#0096ff' },
  { id: 'nba', name: 'NBA', icon: '🏀', color: '#ff8c00' },
  { id: 'mlb', name: 'MLB', icon: '⚾', color: '#cc0000' },
  { id: 'soccer', name: 'Soccer', icon: '⚽', color: '#00c853' },
  { id: 'nhl', name: 'NHL', icon: '🏒', color: '#000080' },
  { id: 'cfb', name: 'College FB', icon: '🏈', color: '#8b4513' },
  { id: 'cbb', name: 'College BB', icon: '🏀', color: '#800080' },
  { id: 'mls', name: 'MLS', icon: '⚽', color: '#006400' },
  { id: 'ufc', name: 'UFC/Boxing', icon: '🥊', color: '#b22222' },
] as const;

export const SPORT_BY_ID = Object.fromEntries(SPORTS.map(s => [s.id, s]));

export type SportId = typeof SPORTS[number]['id'];
