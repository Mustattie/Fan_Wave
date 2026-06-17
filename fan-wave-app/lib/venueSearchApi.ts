// Venue Search API Utility
// Uses Overpass API for venue search and Nominatim for geocoding

import { nominatimBreaker, overpassBreaker } from './circuitBreaker';

export interface Venue {
  name: string;
  address: string;
  lat: number;
  lon: number;
  type: 'bar' | 'pub' | 'restaurant' | 'cafe';
  distance: number; // meters from search point
}

/**
 * Result envelope so the UI can distinguish "API failed" from "0 hits".
 * v8.2 Brass Tap P0: the old API returned `Venue[]` and swallowed every
 * error to `[]`, so the user saw an empty list whether Overpass was down,
 * the breaker was open, or OSM genuinely had nothing for the query —
 * exactly the silent-failure bug we shipped in v6.
 */
export type VenueSearchStatus = 'ok' | 'api_error' | 'breaker_open';

export interface VenueSearchResult {
  venues: Venue[];
  status: VenueSearchStatus;
  /** Optional debug detail surfaced only to console + (sparingly) UI. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const cache = new Map<string, { data: any; timestamp: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Rate limiting (Nominatim: max 1 req/sec)
// ---------------------------------------------------------------------------
let lastNominatimRequest = 0;

async function respectNominatimRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastNominatimRequest;
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  }
  lastNominatimRequest = Date.now();
}

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ---------------------------------------------------------------------------
// resetVenueBreakers — let the caller force-clear OPEN state on user retry
// ---------------------------------------------------------------------------
export function resetVenueBreakers(): void {
  overpassBreaker.reset();
  nominatimBreaker.reset();
}

// ---------------------------------------------------------------------------
// searchVenues – Overpass API
//
// v8.2 Brass Tap P0:
//   • Returns a `VenueSearchResult` envelope so the caller can show a
//     real error vs an empty result. The old `Venue[]` return type
//     swallowed every failure mode to `[]`.
//   • Logs the full Overpass query + HTTP status so a single device-log
//     dump tells us whether the request even left the device.
//   • Coords of (0,0) are now treated as a programmer error — we log and
//     short-circuit to a clear error instead of querying mid-ocean.
//
// Historic v6 changes preserved:
//   • query is pushed to Overpass as a server-side `name~` regex filter.
//   • radius defaults to 30 km — covers a typical metro area.
//   • Two-pronged query: amenity-tagged venues + any node with a matching
//     name (handles unusual OSM tagging like "The Brass Tap" tagged as
//     shop=alcohol).
// ---------------------------------------------------------------------------
export async function searchVenues(
  lat: number,
  lon: number,
  query: string = '',
  radius: number = 30000
): Promise<VenueSearchResult> {
  // Programmer-error guard. (0,0) is the Atlantic Ocean off Africa —
  // a 30 km Overpass query around it returns nothing and is a sign the
  // caller never resolved the user's city to coords.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    const msg = `searchVenues called with invalid coords lat=${lat} lon=${lon}`;
    console.error(`[venueSearchApi] ${msg}`);
    return { venues: [], status: 'api_error', errorMessage: msg };
  }

  const q = query.trim().replace(/["\\]/g, '');
  const cacheKey = `venues_${lat.toFixed(3)}_${lon.toFixed(3)}_${radius}_${q.toLowerCase()}`;
  const cached = getCached<Venue[]>(cacheKey);
  if (cached) {
    console.log(
      `[venueSearchApi] cache HIT key=${cacheKey} → ${cached.length} venues`
    );
    return { venues: cached, status: 'ok' };
  }

  const amenityRegex =
    '^(bar|pub|restaurant|cafe|nightclub|cinema|fast_food|biergarten)$';
  const nameClause = q.length >= 2 ? `["name"~"${q}",i]` : '';
  const nameOnlyClause =
    q.length >= 2
      ? `node["name"~"${q}",i](around:${radius},${lat},${lon});`
      : '';

  const overpassQuery = `
    [out:json][timeout:25];
    (
      node["amenity"~"${amenityRegex}"]${nameClause}(around:${radius},${lat},${lon});
      ${nameOnlyClause}
    );
    out body;
  `;

  console.log(
    `[venueSearchApi] Overpass request lat=${lat.toFixed(4)} lon=${lon.toFixed(4)} ` +
      `radius=${radius}m q="${q}"`
  );

  const venues = await overpassBreaker.execute(async () => {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });

    console.log(
      `[venueSearchApi] Overpass response status=${response.status}`
    );

    if (!response.ok) {
      throw new Error(`Overpass API error: HTTP ${response.status}`);
    }

    const data = await response.json();

    // Two Overpass clauses can return the same node twice; dedupe by id.
    const seen = new Set<number>();
    const out: Venue[] = [];
    for (const el of data.elements || []) {
      if (typeof el.id === 'number' && seen.has(el.id)) continue;
      if (typeof el.id === 'number') seen.add(el.id);
      const tags = el.tags || {};
      // Skip unnamed nodes — they're rarely useful for "Search a venue."
      if (!tags.name) continue;
      const street = tags['addr:street'] || '';
      const houseNumber = tags['addr:housenumber'] || '';
      const city = tags['addr:city'] || '';
      const parts = [houseNumber, street, city].filter(Boolean).join(' ').trim();
      const address = parts || 'Address not available';
      out.push({
        name: tags.name,
        address,
        lat: el.lat,
        lon: el.lon,
        type: (tags.amenity as Venue['type']) || 'bar',
        distance: calculateDistance(lat, lon, el.lat, el.lon),
      });
    }

    out.sort((a, b) => a.distance - b.distance);
    setCache(cacheKey, out);
    console.log(
      `[venueSearchApi] Overpass returned ${data.elements?.length ?? 0} raw / ${out.length} named venues`
    );
    return out;
  }, [] as Venue[]);

  // Pull the failure mode out of the breaker so the UI can render the
  // right toast. We only treat empty-venues-with-error as an error case;
  // empty-venues-with-no-error is a legitimate "OSM has nothing" result.
  if (venues.length === 0) {
    if (overpassBreaker.wasShortCircuited) {
      return {
        venues,
        status: 'breaker_open',
        errorMessage: 'Venue search temporarily unavailable (cooling down).',
      };
    }
    if (overpassBreaker.lastError) {
      return {
        venues,
        status: 'api_error',
        errorMessage: overpassBreaker.lastError.message,
      };
    }
  }

  return { venues, status: 'ok' };
}

// ---------------------------------------------------------------------------
// searchAddress – Nominatim autocomplete for address input
// ---------------------------------------------------------------------------
export interface AddressSuggestion {
  displayName: string;
  lat: number;
  lon: number;
}

export async function searchAddress(
  query: string,
  viewboxLat?: number,
  viewboxLon?: number
): Promise<AddressSuggestion[]> {
  if (!query || query.trim().length < 3) return [];

  const cacheKey = `addr_${query.toLowerCase().trim()}`;
  const cached = getCached<AddressSuggestion[]>(cacheKey);
  if (cached) return cached;

  return nominatimBreaker.execute(async () => {
    await respectNominatimRateLimit();

    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query.trim()
    )}&limit=5&addressdetails=1&countrycodes=us,ca,mx`;

    // Bias results toward user's city if available
    if (viewboxLat && viewboxLon) {
      const delta = 0.5; // ~55km bounding box
      url += `&viewbox=${viewboxLon - delta},${viewboxLat + delta},${viewboxLon + delta},${viewboxLat - delta}&bounded=0`;
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'FanSphere/1.0' },
    });

    if (!response.ok) throw new Error('Nominatim error');

    const results = await response.json();

    // Extract leading house number from user query (e.g. "16505" from "16505 Garden Drive")
    const houseNumberMatch = query.trim().match(/^(\d+[\w-]*)\s+/);
    const typedHouseNumber = houseNumberMatch ? houseNumberMatch[1] : null;

    const suggestions: AddressSuggestion[] = (results || []).map((r: any) => {
      const addr = r.address || {};
      const resultHouseNumber = addr.house_number || null;
      const houseNumber = resultHouseNumber || typedHouseNumber;

      // Build a clean display name with the house number included
      const road = addr.road || '';
      const city = addr.city || addr.town || addr.village || '';
      const state = addr.state || '';
      const postcode = addr.postcode || '';

      let displayName: string;
      if (road) {
        const parts = [
          houseNumber ? `${houseNumber} ${road}` : road,
          city,
          state,
          postcode,
        ].filter(Boolean);
        displayName = parts.join(', ');
      } else {
        // Fallback: prepend house number to Nominatim display_name if missing
        displayName =
          houseNumber && !r.display_name.startsWith(houseNumber)
            ? `${houseNumber} ${r.display_name}`
            : r.display_name;
      }

      return {
        displayName,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
      };
    });

    setCache(cacheKey, suggestions);
    return suggestions;
  }, [] as AddressSuggestion[]);
}

// ---------------------------------------------------------------------------
// geocodeCity – Nominatim
// ---------------------------------------------------------------------------
export async function geocodeCity(
  cityName: string
): Promise<{ lat: number; lon: number; displayName: string } | null> {
  const cacheKey = `geo_${cityName.toLowerCase()}`;
  const cached = getCached<{ lat: number; lon: number; displayName: string }>(cacheKey);
  if (cached) return cached;

  return nominatimBreaker.execute(async () => {
    await respectNominatimRateLimit();

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      cityName
    )}&limit=1&addressdetails=1&countrycodes=us,ca,mx`;

    console.log(`[venueSearchApi] geocodeCity "${cityName}"`);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'FanSphere/1.0' },
    });

    if (!response.ok) throw new Error('Nominatim geocode error');

    const results = await response.json();

    if (!results || results.length === 0) {
      console.warn(
        `[venueSearchApi] geocodeCity "${cityName}" returned 0 results`
      );
      return null;
    }

    const first = results[0];
    const result = {
      lat: parseFloat(first.lat),
      lon: parseFloat(first.lon),
      displayName: first.display_name,
    };
    console.log(
      `[venueSearchApi] geocodeCity "${cityName}" → (${result.lat}, ${result.lon}) ${result.displayName}`
    );

    setCache(cacheKey, result);
    return result;
  }, null);
}
