// Single source of truth for the "popular cities" shortlist.
//
// v9.5.8 (iOS UAT UX-24): there were two lists that had drifted apart.
// Discover's city sheet held 13 cities in no discernible order (Chicago,
// New York, Los Angeles, Houston, Phoenix, ... ), while onboarding's
// "Popular cities" held 12, alphabetically, with San Antonio missing. A
// user who picked their city during onboarding could not find the same
// list when changing it later, and neither order helped them scan.
//
// One list, sorted, used by both. Adding a city here adds it everywhere.
export const POPULAR_CITIES: string[] = [
  'Atlanta',
  'Boston',
  'Chicago',
  'Dallas',
  'Denver',
  'Houston',
  'Los Angeles',
  'Miami',
  'New York',
  'Philadelphia',
  'Phoenix',
  'San Antonio',
  'Seattle',
];
