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
// searchVenues – Overpass API
// ---------------------------------------------------------------------------
export async function searchVenues(
  lat: number,
  lon: number,
  radius: number = 2000
): Promise<Venue[]> {
  const cacheKey = `venues_${lat.toFixed(3)}_${lon.toFixed(3)}_${radius}`;
  const cached = getCached<Venue[]>(cacheKey);
  if (cached) return cached;

  return overpassBreaker.execute(async () => {
    const query = `
      [out:json][timeout:25];
      (
        node["amenity"="bar"](around:${radius},${lat},${lon});
        node["amenity"="pub"](around:${radius},${lat},${lon});
        node["amenity"="restaurant"](around:${radius},${lat},${lon});
        node["amenity"="cafe"](around:${radius},${lat},${lon});
      );
      out body;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) throw new Error('Overpass API error');

    const data = await response.json();

    const venues: Venue[] = (data.elements || []).map((el: any) => {
      const tags = el.tags || {};

      const street = tags['addr:street'] || '';
      const houseNumber = tags['addr:housenumber'] || '';
      const address =
        street || houseNumber
          ? `${street} ${houseNumber}`.trim()
          : 'Address not available';

      return {
        name: tags.name || 'Unnamed Venue',
        address,
        lat: el.lat,
        lon: el.lon,
        type: tags.amenity as Venue['type'],
        distance: calculateDistance(lat, lon, el.lat, el.lon),
      };
    });

    venues.sort((a, b) => a.distance - b.distance);
    setCache(cacheKey, venues);
    return venues;
  }, [] as Venue[]);
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
