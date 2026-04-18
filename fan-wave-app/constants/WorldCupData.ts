// World Cup 2026 Static Data
// 48 teams, 16 venues, 104 matches

export interface WCTeam {
  code: string;
  name: string;
  group: string; // A-L
  flag: string; // emoji
  confederation: string;
}

export interface WCVenue {
  id: string;
  name: string;
  city: string;
  country: string;
  capacity: number;
  lat: number;
  lon: number;
  timezone: string;
}

export interface WCMatch {
  id: string;
  matchNumber: number;
  stage:
    | 'group'
    | 'round_of_32'
    | 'round_of_16'
    | 'quarter_final'
    | 'semi_final'
    | 'third_place'
    | 'final';
  group?: string;
  homeTeam: string; // team code or TBD placeholder
  awayTeam: string;
  venueId: string;
  date: string; // ISO date
  time: string; // local time
}

// ---------------------------------------------------------------------------
// 48 TEAMS -- 12 Groups (A-L), 4 teams each
// ---------------------------------------------------------------------------
export const WC_TEAMS: WCTeam[] = [
  // Group A
  { code: 'USA', name: 'United States', group: 'A', flag: '\u{1F1FA}\u{1F1F8}', confederation: 'CONCACAF' },
  { code: 'WAL', name: 'Wales', group: 'A', flag: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}', confederation: 'UEFA' },
  { code: 'SEN', name: 'Senegal', group: 'A', flag: '\u{1F1F8}\u{1F1F3}', confederation: 'CAF' },
  { code: 'CHI', name: 'Chile', group: 'A', flag: '\u{1F1E8}\u{1F1F1}', confederation: 'CONMEBOL' },

  // Group B
  { code: 'MEX', name: 'Mexico', group: 'B', flag: '\u{1F1F2}\u{1F1FD}', confederation: 'CONCACAF' },
  { code: 'ECU', name: 'Ecuador', group: 'B', flag: '\u{1F1EA}\u{1F1E8}', confederation: 'CONMEBOL' },
  { code: 'EGY', name: 'Egypt', group: 'B', flag: '\u{1F1EA}\u{1F1EC}', confederation: 'CAF' },
  { code: 'UZB', name: 'Uzbekistan', group: 'B', flag: '\u{1F1FA}\u{1F1FF}', confederation: 'AFC' },

  // Group C
  { code: 'CAN', name: 'Canada', group: 'C', flag: '\u{1F1E8}\u{1F1E6}', confederation: 'CONCACAF' },
  { code: 'NED', name: 'Netherlands', group: 'C', flag: '\u{1F1F3}\u{1F1F1}', confederation: 'UEFA' },
  { code: 'NGA', name: 'Nigeria', group: 'C', flag: '\u{1F1F3}\u{1F1EC}', confederation: 'CAF' },
  { code: 'NZL', name: 'New Zealand', group: 'C', flag: '\u{1F1F3}\u{1F1FF}', confederation: 'OFC' },

  // Group D
  { code: 'BRA', name: 'Brazil', group: 'D', flag: '\u{1F1E7}\u{1F1F7}', confederation: 'CONMEBOL' },
  { code: 'JPN', name: 'Japan', group: 'D', flag: '\u{1F1EF}\u{1F1F5}', confederation: 'AFC' },
  { code: 'SRB', name: 'Serbia', group: 'D', flag: '\u{1F1F7}\u{1F1F8}', confederation: 'UEFA' },
  { code: 'CRC', name: 'Costa Rica', group: 'D', flag: '\u{1F1E8}\u{1F1F7}', confederation: 'CONCACAF' },

  // Group E
  { code: 'ARG', name: 'Argentina', group: 'E', flag: '\u{1F1E6}\u{1F1F7}', confederation: 'CONMEBOL' },
  { code: 'DEN', name: 'Denmark', group: 'E', flag: '\u{1F1E9}\u{1F1F0}', confederation: 'UEFA' },
  { code: 'AUS', name: 'Australia', group: 'E', flag: '\u{1F1E6}\u{1F1FA}', confederation: 'AFC' },
  { code: 'PER', name: 'Peru', group: 'E', flag: '\u{1F1F5}\u{1F1EA}', confederation: 'CONMEBOL' },

  // Group F
  { code: 'FRA', name: 'France', group: 'F', flag: '\u{1F1EB}\u{1F1F7}', confederation: 'UEFA' },
  { code: 'COL', name: 'Colombia', group: 'F', flag: '\u{1F1E8}\u{1F1F4}', confederation: 'CONMEBOL' },
  { code: 'KOR', name: 'South Korea', group: 'F', flag: '\u{1F1F0}\u{1F1F7}', confederation: 'AFC' },
  { code: 'MAR', name: 'Morocco', group: 'F', flag: '\u{1F1F2}\u{1F1E6}', confederation: 'CAF' },

  // Group G
  { code: 'ENG', name: 'England', group: 'G', flag: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', confederation: 'UEFA' },
  { code: 'URU', name: 'Uruguay', group: 'G', flag: '\u{1F1FA}\u{1F1FE}', confederation: 'CONMEBOL' },
  { code: 'IRN', name: 'Iran', group: 'G', flag: '\u{1F1EE}\u{1F1F7}', confederation: 'AFC' },
  { code: 'JAM', name: 'Jamaica', group: 'G', flag: '\u{1F1EF}\u{1F1F2}', confederation: 'CONCACAF' },

  // Group H
  { code: 'GER', name: 'Germany', group: 'H', flag: '\u{1F1E9}\u{1F1EA}', confederation: 'UEFA' },
  { code: 'GHA', name: 'Ghana', group: 'H', flag: '\u{1F1EC}\u{1F1ED}', confederation: 'CAF' },
  { code: 'PAR', name: 'Paraguay', group: 'H', flag: '\u{1F1F5}\u{1F1FE}', confederation: 'CONMEBOL' },
  { code: 'SAU', name: 'Saudi Arabia', group: 'H', flag: '\u{1F1F8}\u{1F1E6}', confederation: 'AFC' },

  // Group I
  { code: 'ESP', name: 'Spain', group: 'I', flag: '\u{1F1EA}\u{1F1F8}', confederation: 'UEFA' },
  { code: 'ALG', name: 'Algeria', group: 'I', flag: '\u{1F1E9}\u{1F1FF}', confederation: 'CAF' },
  { code: 'HON', name: 'Honduras', group: 'I', flag: '\u{1F1ED}\u{1F1F3}', confederation: 'CONCACAF' },
  { code: 'QAT', name: 'Qatar', group: 'I', flag: '\u{1F1F6}\u{1F1E6}', confederation: 'AFC' },

  // Group J
  { code: 'POR', name: 'Portugal', group: 'J', flag: '\u{1F1F5}\u{1F1F9}', confederation: 'UEFA' },
  { code: 'CMR', name: 'Cameroon', group: 'J', flag: '\u{1F1E8}\u{1F1F2}', confederation: 'CAF' },
  { code: 'PAN', name: 'Panama', group: 'J', flag: '\u{1F1F5}\u{1F1E6}', confederation: 'CONCACAF' },
  { code: 'CHN', name: 'China', group: 'J', flag: '\u{1F1E8}\u{1F1F3}', confederation: 'AFC' },

  // Group K
  { code: 'BEL', name: 'Belgium', group: 'K', flag: '\u{1F1E7}\u{1F1EA}', confederation: 'UEFA' },
  { code: 'TUN', name: 'Tunisia', group: 'K', flag: '\u{1F1F9}\u{1F1F3}', confederation: 'CAF' },
  { code: 'VEN', name: 'Venezuela', group: 'K', flag: '\u{1F1FB}\u{1F1EA}', confederation: 'CONMEBOL' },
  { code: 'IND', name: 'India', group: 'K', flag: '\u{1F1EE}\u{1F1F3}', confederation: 'AFC' },

  // Group L
  { code: 'ITA', name: 'Italy', group: 'L', flag: '\u{1F1EE}\u{1F1F9}', confederation: 'UEFA' },
  { code: 'CIV', name: 'Ivory Coast', group: 'L', flag: '\u{1F1E8}\u{1F1EE}', confederation: 'CAF' },
  { code: 'BOL', name: 'Bolivia', group: 'L', flag: '\u{1F1E7}\u{1F1F4}', confederation: 'CONMEBOL' },
  { code: 'THA', name: 'Thailand', group: 'L', flag: '\u{1F1F9}\u{1F1ED}', confederation: 'AFC' },
];

// ---------------------------------------------------------------------------
// 16 VENUES
// ---------------------------------------------------------------------------
export const WC_VENUES: WCVenue[] = [
  {
    id: 'metlife',
    name: 'MetLife Stadium',
    city: 'East Rutherford, NJ',
    country: 'USA',
    capacity: 82500,
    lat: 40.8128,
    lon: -74.0742,
    timezone: 'America/New_York',
  },
  {
    id: 'sofi',
    name: 'SoFi Stadium',
    city: 'Los Angeles, CA',
    country: 'USA',
    capacity: 70240,
    lat: 33.9535,
    lon: -118.3392,
    timezone: 'America/Los_Angeles',
  },
  {
    id: 'att',
    name: 'AT&T Stadium',
    city: 'Dallas, TX',
    country: 'USA',
    capacity: 80000,
    lat: 32.7473,
    lon: -97.0945,
    timezone: 'America/Chicago',
  },
  {
    id: 'hardrock',
    name: 'Hard Rock Stadium',
    city: 'Miami, FL',
    country: 'USA',
    capacity: 65326,
    lat: 25.958,
    lon: -80.2389,
    timezone: 'America/New_York',
  },
  {
    id: 'nrg',
    name: 'NRG Stadium',
    city: 'Houston, TX',
    country: 'USA',
    capacity: 72220,
    lat: 29.6847,
    lon: -95.4107,
    timezone: 'America/Chicago',
  },
  {
    id: 'lumen',
    name: 'Lumen Field',
    city: 'Seattle, WA',
    country: 'USA',
    capacity: 69000,
    lat: 47.5952,
    lon: -122.3316,
    timezone: 'America/Los_Angeles',
  },
  {
    id: 'linc',
    name: 'Lincoln Financial Field',
    city: 'Philadelphia, PA',
    country: 'USA',
    capacity: 69796,
    lat: 39.9008,
    lon: -75.1675,
    timezone: 'America/New_York',
  },
  {
    id: 'gillette',
    name: 'Gillette Stadium',
    city: 'Foxborough, MA',
    country: 'USA',
    capacity: 65878,
    lat: 42.0909,
    lon: -71.2643,
    timezone: 'America/New_York',
  },
  {
    id: 'mercedes',
    name: 'Mercedes-Benz Stadium',
    city: 'Atlanta, GA',
    country: 'USA',
    capacity: 71000,
    lat: 33.7553,
    lon: -84.401,
    timezone: 'America/New_York',
  },
  {
    id: 'arrowhead',
    name: 'Arrowhead Stadium',
    city: 'Kansas City, MO',
    country: 'USA',
    capacity: 76416,
    lat: 39.0489,
    lon: -94.484,
    timezone: 'America/Chicago',
  },
  {
    id: 'levis',
    name: "Levi's Stadium",
    city: 'Santa Clara, CA',
    country: 'USA',
    capacity: 68500,
    lat: 37.4033,
    lon: -121.9694,
    timezone: 'America/Los_Angeles',
  },
  {
    id: 'bmo',
    name: 'BMO Field',
    city: 'Toronto, ON',
    country: 'Canada',
    capacity: 30000,
    lat: 43.6332,
    lon: -79.4186,
    timezone: 'America/Toronto',
  },
  {
    id: 'bcplace',
    name: 'BC Place',
    city: 'Vancouver, BC',
    country: 'Canada',
    capacity: 54500,
    lat: 49.2768,
    lon: -123.112,
    timezone: 'America/Vancouver',
  },
  {
    id: 'azteca',
    name: 'Estadio Azteca',
    city: 'Mexico City',
    country: 'Mexico',
    capacity: 87523,
    lat: 19.3029,
    lon: -99.1505,
    timezone: 'America/Mexico_City',
  },
  {
    id: 'akron',
    name: 'Estadio Akron',
    city: 'Guadalajara',
    country: 'Mexico',
    capacity: 49850,
    lat: 20.6809,
    lon: -103.4625,
    timezone: 'America/Mexico_City',
  },
  {
    id: 'bbva',
    name: 'Estadio BBVA',
    city: 'Monterrey',
    country: 'Mexico',
    capacity: 53500,
    lat: 25.6669,
    lon: -100.2447,
    timezone: 'America/Monterrey',
  },
];

// ---------------------------------------------------------------------------
// VENUE ASSIGNMENTS -- helpers to distribute matches across venues
// ---------------------------------------------------------------------------
const groupVenues: string[] = [
  'metlife', 'sofi', 'att', 'hardrock', 'nrg', 'lumen',
  'linc', 'gillette', 'mercedes', 'arrowhead', 'levis',
  'bmo', 'bcplace', 'azteca', 'akron', 'bbva',
];

function venueForGroupMatch(matchIdx: number): string {
  return groupVenues[matchIdx % groupVenues.length];
}

// ---------------------------------------------------------------------------
// GROUP STAGE DATE GENERATION
// June 11 - July 1, 2026 -- spread 72 matches across ~21 days
// ---------------------------------------------------------------------------
function addDays(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const GROUP_START = '2026-06-11';
const groupTimes = ['13:00', '16:00', '19:00', '22:00'];

function generateGroupMatches(): WCMatch[] {
  const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const matches: WCMatch[] = [];
  let matchNum = 1;
  let globalIdx = 0;

  for (const g of groups) {
    const teams = WC_TEAMS.filter((t) => t.group === g);
    // Round-robin: 6 matches per group (each team plays every other team once)
    const pairings: [number, number][] = [
      [0, 1], [2, 3], // matchday 1
      [0, 2], [1, 3], // matchday 2
      [0, 3], [1, 2], // matchday 3
    ];

    for (let p = 0; p < pairings.length; p++) {
      const [h, a] = pairings[p];
      const dayOffset = Math.floor(globalIdx / 4); // 4 matches per day
      const timeSlot = globalIdx % 4;

      matches.push({
        id: `GS-${g}-${p + 1}`,
        matchNumber: matchNum++,
        stage: 'group',
        group: g,
        homeTeam: teams[h].code,
        awayTeam: teams[a].code,
        venueId: venueForGroupMatch(globalIdx),
        date: addDays(GROUP_START, dayOffset),
        time: groupTimes[timeSlot],
      });
      globalIdx++;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// KNOCKOUT STAGE
// ---------------------------------------------------------------------------
function generateKnockoutMatches(startMatchNum: number): WCMatch[] {
  const matches: WCMatch[] = [];
  let matchNum = startMatchNum;

  // Round of 32 -- 16 matches, July 2-5
  const r32Start = '2026-07-02';
  const r32Pairings: [string, string][] = [
    ['Winner A1', '3rd C/D/E'],
    ['Winner B1', '3rd A/B/F'],
    ['Winner C1', '3rd D/E/F'],
    ['Winner D1', '3rd A/B/C'],
    ['Winner E1', '3rd I/J/K'],
    ['Winner F1', '3rd G/H/L'],
    ['Winner G1', '3rd J/K/L'],
    ['Winner H1', '3rd G/H/I'],
    ['Winner I1', 'Runner A'],
    ['Winner J1', 'Runner B'],
    ['Winner K1', 'Runner C'],
    ['Winner L1', 'Runner D'],
    ['Winner A2', 'Runner E'],
    ['Winner B2', 'Runner F'],
    ['Winner C2', 'Runner G'],
    ['Winner D2', 'Runner H'],
  ];

  for (let i = 0; i < r32Pairings.length; i++) {
    const dayOff = Math.floor(i / 4);
    const timeSlot = i % 4;
    matches.push({
      id: `R32-${i + 1}`,
      matchNumber: matchNum++,
      stage: 'round_of_32',
      homeTeam: r32Pairings[i][0],
      awayTeam: r32Pairings[i][1],
      venueId: groupVenues[i % groupVenues.length],
      date: addDays(r32Start, dayOff),
      time: groupTimes[timeSlot],
    });
  }

  // Round of 16 -- 8 matches, July 7-8
  const r16Start = '2026-07-07';
  for (let i = 0; i < 8; i++) {
    const dayOff = Math.floor(i / 4);
    const timeSlot = i % 4;
    matches.push({
      id: `R16-${i + 1}`,
      matchNumber: matchNum++,
      stage: 'round_of_16',
      homeTeam: `Winner R32-${i * 2 + 1}`,
      awayTeam: `Winner R32-${i * 2 + 2}`,
      venueId: groupVenues[i % 8],
      date: addDays(r16Start, dayOff),
      time: groupTimes[timeSlot],
    });
  }

  // Quarter-finals -- 4 matches, July 11-12
  const qfStart = '2026-07-11';
  const qfVenues = ['metlife', 'sofi', 'att', 'hardrock'];
  for (let i = 0; i < 4; i++) {
    matches.push({
      id: `QF-${i + 1}`,
      matchNumber: matchNum++,
      stage: 'quarter_final',
      homeTeam: `Winner R16-${i * 2 + 1}`,
      awayTeam: `Winner R16-${i * 2 + 2}`,
      venueId: qfVenues[i],
      date: addDays(qfStart, Math.floor(i / 2)),
      time: i % 2 === 0 ? '16:00' : '20:00',
    });
  }

  // Semi-finals -- 2 matches, July 15
  const sfDate = '2026-07-15';
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `SF-${i + 1}`,
      matchNumber: matchNum++,
      stage: 'semi_final',
      homeTeam: `Winner QF-${i * 2 + 1}`,
      awayTeam: `Winner QF-${i * 2 + 2}`,
      venueId: i === 0 ? 'metlife' : 'sofi',
      date: sfDate,
      time: i === 0 ? '16:00' : '20:00',
    });
  }

  // Third-place match -- July 18
  matches.push({
    id: 'TP-1',
    matchNumber: matchNum++,
    stage: 'third_place',
    homeTeam: 'Loser SF-1',
    awayTeam: 'Loser SF-2',
    venueId: 'hardrock',
    date: '2026-07-18',
    time: '16:00',
  });

  // Final -- July 19
  matches.push({
    id: 'FINAL-1',
    matchNumber: matchNum++,
    stage: 'final',
    homeTeam: 'Winner SF-1',
    awayTeam: 'Winner SF-2',
    venueId: 'metlife',
    date: '2026-07-19',
    time: '16:00',
  });

  return matches;
}

// ---------------------------------------------------------------------------
// COMBINED MATCHES
// ---------------------------------------------------------------------------
const groupMatches = generateGroupMatches();
const knockoutMatches = generateKnockoutMatches(groupMatches.length + 1);

export const WC_MATCHES: WCMatch[] = [...groupMatches, ...knockoutMatches];

// ---------------------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------------------
export function getTeamsByGroup(group: string): WCTeam[] {
  return WC_TEAMS.filter((t) => t.group === group);
}

export function getMatchesByStage(stage: string): WCMatch[] {
  return WC_MATCHES.filter((m) => m.stage === stage);
}

export function getMatchesByTeam(teamCode: string): WCMatch[] {
  return WC_MATCHES.filter(
    (m) => m.homeTeam === teamCode || m.awayTeam === teamCode
  );
}

export function getVenueById(id: string): WCVenue | undefined {
  return WC_VENUES.find((v) => v.id === id);
}
