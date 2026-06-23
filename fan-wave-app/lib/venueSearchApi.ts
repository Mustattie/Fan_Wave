// Venue Search API
//
// v8.6: Venue lookup now goes through the `venue-search` Supabase edge
// function, which proxies Google Places Text Search. The OSM stack
// (Overpass + Nominatim) we shipped through v8.5 could not surface US
// chain bars by name + region — verified on prod with UAT artefacts
// "The Brass Tap" / "The Pub Mckinney" / "Room One Eleven" all returning
// empty even with chain aliases applied and bbox-bounded Nominatim
// fallbacks. Google Places handles chain names natively + has near-
// universal POI coverage in the US, so the architecture flip closes the
// "no venues found" failure mode at the root.
//
// What's kept on Nominatim:
//   - geocodeCity:    free, accurate enough for metro centroid lookup,
//                     and not part of the "find a venue" failure path.
//   - searchAddress:  autocomplete for the manual-address flow when the
//                     user can't find their venue in Places. Different
//                     cost line (Google Geocoding) — defer until we
//                     see a need.
//
// Public API surface intentionally unchanged so create-watch-party.tsx
// and any other call site keeps compiling.

import { supabase } from './supabase';
import { nominatimBreaker } from './circuitBreaker';

export interface Venue {
  name: string;
  address: string;
  lat: number;
  lon: number;
  type: 'bar' | 'pub' | 'restaurant' | 'cafe';
  distance: number; // meters from search point
  /** Google Place ID — preserved for future "save venue" / dedupe paths */
  placeId?: string;
}

export type VenueSearchStatus = 'ok' | 'api_error' | 'breaker_open';

export interface VenueSearchResult {
  venues: Venue[];
  status: VenueSearchStatus;
  errorMessage?: string;
}

// Kept as a no-op alias so any older caller importing it still resolves.
// The Google Places normalisation lives server-side now; alias rewriting
// on the client is no longer required.
export function normalizeVenueQuery(input: string): string {
  return (input || '').trim();
}

// ---------------------------------------------------------------------------
// Cache (15 min) — fronts the edge function so repeated searches for the
// same (query, ~city) inside one session don't double-bill Google. Keyed
// by ~3-decimal coords (~110 m precision) so users at the same venue
// share cache entries; cross-metro users get their own slot.
// ---------------------------------------------------------------------------
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return e.data as T;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// Nominatim rate limit (still relevant for geocodeCity / searchAddress)
let lastNominatimRequest = 0;
async function respectNominatimRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastNominatimRequest;
  if (elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed));
  }
  lastNominatimRequest = Date.now();
}

// Haversine — used as a defensive distance recompute when the edge
// function payload is missing it (shouldn't happen, but cheap).
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Retained for callers that previously reset the Overpass/Nominatim
// breakers between retries. Only Nominatim has a live breaker now.
export function resetVenueBreakers(): void {
  nominatimBreaker.reset();
}

// ---------------------------------------------------------------------------
// Internal: hit the venue-search edge function and shape the response into
// the Venue[] envelope every caller already speaks. All errors bubble up
// as `api_error` with a human-readable message so the UI can show "Try
// again" instead of an empty list with no signal.
// ---------------------------------------------------------------------------
async function invokeVenueSearch(
  query: string,
  lat: number,
  lon: number,
  radiusMeters: number,
  userCoords?: { lat: number; lon: number } | null,
): Promise<VenueSearchResult> {
  const q = (query || '').trim();
  if (q.length < 2) {
    return { venues: [], status: 'ok' };
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    return {
      venues: [],
      status: 'api_error',
      errorMessage: `invalid coords lat=${lat} lon=${lon}`,
    };
  }

  // Cache key includes user-position (rounded to ~110 m) when present so
  // two users at the same venue share cache while two users 5+ miles
  // apart don't get each other's distance numbers.
  const userKey = userCoords
    ? `_u${userCoords.lat.toFixed(3)}_${userCoords.lon.toFixed(3)}`
    : '';
  const cacheKey =
    `places_${lat.toFixed(3)}_${lon.toFixed(3)}_${radiusMeters}_${q.toLowerCase()}${userKey}`;
  const cached = getCached<Venue[]>(cacheKey);
  if (cached) {
    return { venues: cached, status: 'ok' };
  }

  // Distance reference for the defensive client-side recompute below.
  // Same precedence the edge function uses — GPS if supplied, search
  // center otherwise.
  const distLat = userCoords?.lat ?? lat;
  const distLon = userCoords?.lon ?? lon;

  try {
    const { data, error } = await supabase.functions.invoke('venue-search', {
      body: {
        query: q,
        lat,
        lon,
        radiusMeters,
        ...(userCoords
          ? { userLat: userCoords.lat, userLon: userCoords.lon }
          : {}),
      },
    });
    if (error) {
      // supabase-js wraps non-2xx as FunctionsHttpError; surface the
      // message so the UI footer doesn't lie about why the search failed.
      return {
        venues: [],
        status: 'api_error',
        errorMessage: error.message ?? 'venue-search failed',
      };
    }
    const rawVenues: any[] = Array.isArray(data?.venues) ? data.venues : [];
    const venues: Venue[] = rawVenues
      .map((v): Venue | null => {
        const vLat = Number(v.lat);
        const vLon = Number(v.lon);
        if (!Number.isFinite(vLat) || !Number.isFinite(vLon)) return null;
        const distance = Number.isFinite(v.distanceMeters)
          ? Number(v.distanceMeters)
          : calculateDistance(distLat, distLon, vLat, vLon);
        return {
          name: String(v.name || '').trim() || 'Unknown venue',
          address: String(v.address || 'Address not available'),
          lat: vLat,
          lon: vLon,
          type: (v.type as Venue['type']) || 'bar',
          distance,
          placeId: typeof v.placeId === 'string' ? v.placeId : undefined,
        };
      })
      .filter((v): v is Venue => v !== null);
    setCache(cacheKey, venues);
    return { venues, status: 'ok' };
  } catch (e: any) {
    return {
      venues: [],
      status: 'api_error',
      errorMessage: e?.message ?? 'venue-search threw',
    };
  }
}

// ---------------------------------------------------------------------------
// searchVenues — radius-anchored search around (lat, lon)
//
// `userCoords` (optional, v8.7+): when supplied, the edge function returns
// `distanceMeters` measured from device GPS rather than the city centroid.
// Search itself stays anchored to (lat, lon) so the venue catchment doesn't
// shrink — a McKinney user still sees Plano / Frisco / Dallas venues, just
// with accurate-to-them distances.
// ---------------------------------------------------------------------------
export async function searchVenues(
  lat: number,
  lon: number,
  query: string = '',
  radius: number = 30000,
  userCoords?: { lat: number; lon: number } | null,
): Promise<VenueSearchResult> {
  return invokeVenueSearch(query, lat, lon, radius, userCoords);
}

// ---------------------------------------------------------------------------
// searchVenuesByName — name + city fallback. With Google Places one call
// covers both name and proximity, so this just delegates to the same
// edge function with the city appended to the query as a soft bias.
// ---------------------------------------------------------------------------
export async function searchVenuesByName(
  query: string,
  city: string | null,
  centerLat?: number,
  centerLon?: number,
  userCoords?: { lat: number; lon: number } | null,
): Promise<VenueSearchResult> {
  const q = (query || '').trim();
  if (q.length < 2) return { venues: [], status: 'ok' };

  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
    // Without coords we can't bias Places. Geocode the city first.
    const cityPart = (city || '').split(',')[0]?.trim() ?? '';
    if (!cityPart) {
      return {
        venues: [],
        status: 'api_error',
        errorMessage: 'No center coords and no city to geocode',
      };
    }
    const geo = await geocodeCity(cityPart);
    if (!geo) {
      return {
        venues: [],
        status: 'api_error',
        errorMessage: `Could not geocode ${cityPart}`,
      };
    }
    return invokeVenueSearch(q, geo.lat, geo.lon, 30000, userCoords);
  }

  return invokeVenueSearch(
    q,
    centerLat as number,
    centerLon as number,
    30000,
    userCoords,
  );
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
  viewboxLon?: number,
): Promise<AddressSuggestion[]> {
  if (!query || query.trim().length < 3) return [];

  const cacheKey = `addr_${query.toLowerCase().trim()}`;
  const cached = getCached<AddressSuggestion[]>(cacheKey);
  if (cached) return cached;

  return nominatimBreaker.execute(async () => {
    await respectNominatimRateLimit();

    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query.trim(),
    )}&limit=5&addressdetails=1&countrycodes=us,ca,mx`;

    if (viewboxLat && viewboxLon) {
      const delta = 0.5;
      url += `&viewbox=${viewboxLon - delta},${viewboxLat + delta},${viewboxLon + delta},${viewboxLat - delta}&bounded=0`;
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'FanSphere/1.0' },
    });

    if (!response.ok) throw new Error('Nominatim error');

    const results = await response.json();
    const houseNumberMatch = query.trim().match(/^(\d+[\w-]*)\s+/);
    const typedHouseNumber = houseNumberMatch ? houseNumberMatch[1] : null;

    const suggestions: AddressSuggestion[] = (results || []).map((r: any) => {
      const addr = r.address || {};
      const resultHouseNumber = addr.house_number || null;
      const houseNumber = resultHouseNumber || typedHouseNumber;
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
  cityName: string,
): Promise<{ lat: number; lon: number; displayName: string } | null> {
  const cacheKey = `geo_${cityName.toLowerCase()}`;
  const cached = getCached<{ lat: number; lon: number; displayName: string }>(cacheKey);
  if (cached) return cached;

  return nominatimBreaker.execute(async () => {
    await respectNominatimRateLimit();

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      cityName,
    )}&limit=1&addressdetails=1&countrycodes=us,ca,mx`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'FanSphere/1.0' },
    });

    if (!response.ok) throw new Error('Nominatim geocode error');

    const results = await response.json();
    if (!results || results.length === 0) return null;

    const first = results[0];
    const result = {
      lat: parseFloat(first.lat),
      lon: parseFloat(first.lon),
      displayName: first.display_name,
    };
    setCache(cacheKey, result);
    return result;
  }, null);
}
