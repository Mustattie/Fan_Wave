// venue-search edge function — Google Places Text Search (v1)
//
// v8.6: replaces the client-side OSM stack (Overpass + Nominatim) that
// couldn't surface US chain bars by name. Google Places (New) returns
// chain matches natively and has near-universal POI coverage in NA.
//
// Hard rules:
//   1. Places API (New) REQUIRES the X-Goog-FieldMask header — without it
//      the API rejects with HTTP 400 and a generic "FieldMask required"
//      message. Most "edge function returned non-2xx" reports for this
//      function trace back to a missing/typoed FieldMask.
//   2. The API key is server-only — never expose it to the client. The
//      key must NOT have HTTP referrer restrictions (those would block
//      server-to-server calls); use an IP allowlist or no restriction
//      for the Supabase egress range.
//   3. verify_jwt is ON (set in Dashboard), so this function only runs
//      for authenticated app users.
//
// Request body:  { query, lat, lon, radiusMeters?, userLat?, userLon? }
//   - lat/lon: search-center coords (city centroid) — controls which
//     venues Google returns
//   - userLat/userLon (optional): device GPS — used ONLY for the
//     returned `distanceMeters` so the UI can show "5 mi from you"
//     instead of "33 mi from Dallas downtown". When omitted, distance
//     falls back to search center (legacy behaviour).
// Response 200:  { venues: Venue[]; status: 'ok' }
// Response 4xx/5xx: { venues: []; status: 'api_error'; errorMessage: string }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

interface Venue {
  name: string;
  address: string;
  lat: number;
  lon: number;
  type: 'bar' | 'pub' | 'restaurant' | 'cafe';
  distanceMeters: number;
  placeId?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json',
};

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
].join(',');

function haversineMeters(
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

// Map Google Places `primaryType` / `types[]` to Fan Sphere's narrower set.
// Anything we don't recognise defaults to 'bar' so the UI still renders
// instead of dropping the row — Places Text Search is queried specifically
// for venues, not arbitrary POIs.
function classify(primaryType: string | undefined, types: string[]): Venue['type'] {
  const all = new Set([primaryType, ...types].filter(Boolean) as string[]);
  if (all.has('bar') || all.has('night_club')) return 'bar';
  if (all.has('pub')) return 'pub';
  if (all.has('cafe') || all.has('coffee_shop')) return 'cafe';
  if (all.has('restaurant') || all.has('meal_takeaway') || all.has('food'))
    return 'restaurant';
  return 'bar';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: `method ${req.method} not allowed`,
      }),
      { status: 405, headers: JSON_HEADERS },
    );
  }

  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: 'GOOGLE_PLACES_API_KEY not configured',
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  let body: {
    query?: string;
    lat?: number;
    lon?: number;
    radiusMeters?: number;
    userLat?: number;
    userLon?: number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: 'invalid JSON body',
      }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const query = (body.query || '').trim();
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const userLatRaw = Number(body.userLat);
  const userLonRaw = Number(body.userLon);
  const hasUserCoords =
    Number.isFinite(userLatRaw) &&
    Number.isFinite(userLonRaw) &&
    !(userLatRaw === 0 && userLonRaw === 0);
  // Distance origin: device GPS when supplied, otherwise the search
  // center. Search itself ALWAYS uses (lat, lon) so the Google Places
  // catchment stays at metro scale; only the per-venue distance we
  // return to the client switches.
  const distanceFromLat = hasUserCoords ? userLatRaw : lat;
  const distanceFromLon = hasUserCoords ? userLonRaw : lon;
  const radiusRaw = Number(body.radiusMeters ?? 30000);
  // Places API (New) accepts 0 < radius <= 50000 m. Clamp defensively.
  const radius = Math.min(Math.max(500, radiusRaw), 50000);

  if (query.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: `invalid input: query="${query}" lat=${lat} lon=${lon}`,
      }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const placesBody = {
    textQuery: query,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius,
      },
    },
    pageSize: 20,
    // No language/region restriction so chain names match in any locale.
  };

  let placesResp: Response;
  try {
    placesResp = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(placesBody),
      },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: `Places fetch threw: ${e?.message ?? 'unknown'}`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!placesResp.ok) {
    const detail = await placesResp.text().catch(() => '');
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: `Places HTTP ${placesResp.status}: ${detail.slice(0, 240)}`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  let payload: any;
  try {
    payload = await placesResp.json();
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: `Places JSON parse: ${e?.message ?? 'unknown'}`,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const places: any[] = Array.isArray(payload?.places) ? payload.places : [];
  const venues: Venue[] = places
    .map((p): Venue | null => {
      const pLat = Number(p?.location?.latitude);
      const pLon = Number(p?.location?.longitude);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return null;
      return {
        name:
          (typeof p?.displayName?.text === 'string'
            ? p.displayName.text.trim()
            : '') || 'Unknown venue',
        address:
          typeof p?.formattedAddress === 'string'
            ? p.formattedAddress
            : 'Address not available',
        lat: pLat,
        lon: pLon,
        type: classify(
          typeof p?.primaryType === 'string' ? p.primaryType : undefined,
          Array.isArray(p?.types) ? p.types : [],
        ),
        distanceMeters: haversineMeters(distanceFromLat, distanceFromLon, pLat, pLon),
        placeId: typeof p?.id === 'string' ? p.id : undefined,
      };
    })
    .filter((v): v is Venue => v !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return new Response(
    JSON.stringify({ venues, status: 'ok' }),
    { status: 200, headers: JSON_HEADERS },
  );
});
