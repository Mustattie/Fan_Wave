/**
 * cityFromAddress — pull the locality out of a formatted street address.
 *
 * v9.4.3 UAT Round 4. A watch party at "301 N Custer Rd #180, McKinney, TX
 * 75071, USA" was displaying as "Uncork'd Bar & Grill · Dallas", because
 * create-watch-party stamped `venue_city` with the CREATOR's home city
 * (`userCity`) rather than the venue's. Dallas is the right search anchor —
 * a McKinney user wants the whole metro's venues — but it is the wrong
 * label once a specific venue has been chosen.
 *
 * Google Places (venue search) hands back only a formatted string, so the
 * city has to be parsed back out of it. Nominatim (manual address entry)
 * returns the locality as its own field — prefer that when it is available
 * and use this only as the fallback.
 *
 * Deliberately conservative: anything it cannot confidently parse returns
 * null so the caller can fall back rather than persisting a wrong city.
 */

const COUNTRY_TOKENS = new Set([
  'usa',
  'us',
  'u.s.',
  'u.s.a.',
  'united states',
  'united states of america',
  'canada',
  'ca',
  'mexico',
  'méxico',
  'mx',
]);

// US states + DC, both spellings, plus the Canadian provinces — Nominatim
// and Places are both restricted to us,ca,mx in this app.
const STATE_TOKENS = new Set(
  [
    'AL', 'Alabama', 'AK', 'Alaska', 'AZ', 'Arizona', 'AR', 'Arkansas',
    'CA', 'California', 'CO', 'Colorado', 'CT', 'Connecticut', 'DE', 'Delaware',
    'FL', 'Florida', 'GA', 'Georgia', 'HI', 'Hawaii', 'ID', 'Idaho',
    'IL', 'Illinois', 'IN', 'Indiana', 'IA', 'Iowa', 'KS', 'Kansas',
    'KY', 'Kentucky', 'LA', 'Louisiana', 'ME', 'Maine', 'MD', 'Maryland',
    'MA', 'Massachusetts', 'MI', 'Michigan', 'MN', 'Minnesota',
    'MS', 'Mississippi', 'MO', 'Missouri', 'MT', 'Montana', 'NE', 'Nebraska',
    'NV', 'Nevada', 'NH', 'New Hampshire', 'NJ', 'New Jersey',
    'NM', 'New Mexico', 'NY', 'New York', 'NC', 'North Carolina',
    'ND', 'North Dakota', 'OH', 'Ohio', 'OK', 'Oklahoma', 'OR', 'Oregon',
    'PA', 'Pennsylvania', 'RI', 'Rhode Island', 'SC', 'South Carolina',
    'SD', 'South Dakota', 'TN', 'Tennessee', 'TX', 'Texas', 'UT', 'Utah',
    'VT', 'Vermont', 'VA', 'Virginia', 'WA', 'Washington',
    'WV', 'West Virginia', 'WI', 'Wisconsin', 'WY', 'Wyoming',
    'DC', 'District of Columbia', 'PR', 'Puerto Rico',
    'AB', 'Alberta', 'BC', 'British Columbia', 'MB', 'Manitoba',
    'NB', 'New Brunswick', 'NL', 'Newfoundland and Labrador',
    'NS', 'Nova Scotia', 'ON', 'Ontario', 'PE', 'Prince Edward Island',
    'QC', 'Quebec', 'SK', 'Saskatchewan',
  ].map((s) => s.toLowerCase()),
);

/** US ZIP, ZIP+4, or a Canadian postal code, alone in its comma segment. */
const POSTCODE_ONLY = /^(\d{5}(-\d{4})?|[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d)$/;

/** "TX 75071" / "Texas 75071" / "ON M5V 3L9" — state and postcode fused. */
const STATE_WITH_POSTCODE = /^(.+?)\s+(\d{5}(-\d{4})?|[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d)$/;

export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  // A bare "McKinney" is a city already; a bare street line is not a city,
  // and we cannot tell them apart, so a single segment is never trusted.
  if (parts.length < 2) return null;

  // Peel the tail: country, then postcode, then state — in whatever
  // combination this particular formatter used.
  if (COUNTRY_TOKENS.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  if (parts.length && POSTCODE_ONLY.test(parts[parts.length - 1])) parts.pop();

  if (parts.length) {
    const tail = parts[parts.length - 1];
    const fused = tail.match(STATE_WITH_POSTCODE);
    if (fused && STATE_TOKENS.has(fused[1].trim().toLowerCase())) {
      parts.pop();
    } else if (STATE_TOKENS.has(tail.toLowerCase())) {
      parts.pop();
    }
  }

  // Whatever is now last is the locality — but only if something that looks
  // like a street line still precedes it. Otherwise we are about to return
  // the street itself, which is worse than returning nothing.
  if (parts.length < 2) return null;

  const city = parts[parts.length - 1];
  if (!/[A-Za-z]/.test(city)) return null;

  return city;
}
