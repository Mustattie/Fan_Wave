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
  // 'venue' is the honest bucket for an establishment we can't place in
  // one of the four food-and-drink categories (a stadium, a bowling alley,
  // a brewery Google tags only as 'tourist_attraction'). It exists so that
  // nothing has to be *guessed* into 'bar' -- see classify().
  type: 'bar' | 'pub' | 'restaurant' | 'cafe' | 'venue';
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

// Google Places types that describe a PLACE ON A MAP rather than somewhere
// you can walk into. Text Search happily answers "Prosper Tx" with the town
// of Prosper, and the town is not a venue.
//
// iOS UAT 2026-09-09, BUG-2: searching "Prosper Tx" returned exactly one
// result -- "Prosper — Prosper, TX, USA — Bar — 1.0 mi away". The city
// itself, wearing a Bar badge, selectable, and it went on to be written to
// watch_parties as the venue (BUG-3). Two independent defects lined up:
// nothing filtered geographic results, and classify() defaulted the
// unrecognised type to 'bar'.
const GEOGRAPHIC_TYPES = new Set([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'sublocality_level_4',
  'sublocality_level_5',
  'neighborhood',
  'political',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'country',
  'continent',
  'archipelago',
  'colloquial_area',
  'postal_code',
  'postal_code_prefix',
  'postal_code_suffix',
  'postal_town',
  'plus_code',
  'geocode',
  'route',
  'street_address',
  'street_number',
  'intersection',
  'premise',
  'subpremise',
  'floor',
  'room',
  'natural_feature',
  'land_parcel',
]);

/**
 * True when a Places result is somewhere a person can meet up, rather than
 * a region, road, or coordinate.
 *
 * The rule is deliberately two-sided. Requiring `establishment` alone would
 * be enough today, but Places has shipped result shapes with a thin `types`
 * array before, and a single missing tag would quietly reopen BUG-2. So we
 * reject anything carrying a geographic type AND require positive evidence
 * of an establishment.
 */
function isEstablishment(primaryType: string | undefined, types: string[]): boolean {
  const all = new Set([primaryType, ...types].filter(Boolean) as string[]);
  for (const t of all) {
    if (GEOGRAPHIC_TYPES.has(t)) return false;
  }
  return all.has('establishment') || all.has('point_of_interest') || all.has('food');
}

// Map Google Places `primaryType` / `types[]` to Fan Sphere's narrower set.
//
// Unrecognised establishments now land in 'venue' rather than being called
// a bar. A generic badge is a small loss of colour; a wrong badge is the
// app asserting something it does not know, and that is what put a Bar
// label on a municipality.
function classify(primaryType: string | undefined, types: string[]): Venue['type'] {
  const all = new Set([primaryType, ...types].filter(Boolean) as string[]);
  if (all.has('bar') || all.has('night_club') || all.has('sports_bar')) return 'bar';
  if (all.has('pub')) return 'pub';
  if (all.has('cafe') || all.has('coffee_shop')) return 'cafe';
  if (all.has('restaurant') || all.has('meal_takeaway') || all.has('food'))
    return 'restaurant';
  return 'venue';
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

  // One Places Text Search round-trip, normalised into our Venue shape.
  // Returns a discriminated result so the caller can decide whether a zero-
  // hit answer is worth a second, differently-phrased attempt.
  type SearchOutcome =
    | { ok: true; venues: Venue[] }
    | { ok: false; httpStatus: number; errorMessage: string };

  const runTextSearch = async (textQuery: string): Promise<SearchOutcome> => {
    const placesBody = {
      textQuery,
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
      return {
        ok: false,
        httpStatus: 502,
        errorMessage: `Places fetch threw: ${e?.message ?? 'unknown'}`,
      };
    }

    if (!placesResp.ok) {
      const detail = await placesResp.text().catch(() => '');
      return {
        ok: false,
        httpStatus: 502,
        errorMessage: `Places HTTP ${placesResp.status}: ${detail.slice(0, 240)}`,
      };
    }

    let payload: any;
    try {
      payload = await placesResp.json();
    } catch (e: any) {
      return {
        ok: false,
        httpStatus: 502,
        errorMessage: `Places JSON parse: ${e?.message ?? 'unknown'}`,
      };
    }

    const places: any[] = Array.isArray(payload?.places) ? payload.places : [];
    const venues: Venue[] = places
      .map((p): Venue | null => {
        const pLat = Number(p?.location?.latitude);
        const pLon = Number(p?.location?.longitude);
        if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return null;

        const primaryType =
          typeof p?.primaryType === 'string' ? p.primaryType : undefined;
        const types: string[] = Array.isArray(p?.types) ? p.types : [];

        // BUG-2 gate: drop towns, counties, ZIPs, roads and bare
        // coordinates before they can be dressed up as somewhere to watch
        // a game.
        if (!isEstablishment(primaryType, types)) return null;

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
          type: classify(primaryType, types),
          distanceMeters: haversineMeters(distanceFromLat, distanceFromLon, pLat, pLon),
          placeId: typeof p?.id === 'string' ? p.id : undefined,
        };
      })
      .filter((v): v is Venue => v !== null)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return { ok: true, venues };
  };

  const primary = await runTextSearch(query);
  if (!primary.ok) {
    return new Response(
      JSON.stringify({
        venues: [],
        status: 'api_error',
        errorMessage: primary.errorMessage,
      }),
      { status: primary.httpStatus, headers: JSON_HEADERS },
    );
  }

  let venues = primary.venues;

  // Place-name fallback.
  //
  // The search box is labelled "Search venue name or location...", so hosts
  // type "Prosper Tx" and mean "show me somewhere in Prosper". Text Search
  // reads that as a request for the town, returns the town, and now that the
  // establishment gate drops it the honest answer would be "no venues" --
  // which is worse than what the tester saw, not better.
  //
  // So when a query yields nothing walk-into-able, ask the question the host
  // actually meant. The second call only fires on an otherwise-empty result,
  // so the common case still costs exactly one Places request.
  if (venues.length === 0) {
    const fallback = await runTextSearch(`sports bars and restaurants in ${query}`);
    if (fallback.ok) venues = fallback.venues;
    // A failed fallback is not worth surfacing: the primary search
    // succeeded and legitimately found nothing. Report that, not a
    // secondary network error the user never asked for.
  }

  return new Response(
    JSON.stringify({ venues, status: 'ok' }),
    { status: 200, headers: JSON_HEADERS },
  );
});
