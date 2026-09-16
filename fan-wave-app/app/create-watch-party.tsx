import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  FlatList,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Globe, Lock, UserPlus, X, Users, Search, MapPin, CheckCircle2, CalendarDays } from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Colors } from '@/constants/Colors';
import { SPORTS } from '@/constants/Sports';
import {
  searchVenues,
  geocodeCity,
  searchAddress,
  resetVenueBreakers,
  Venue,
  AddressSuggestion,
} from '@/lib/venueSearchApi';
import { cityFromAddress } from '@/lib/addressCity';
import { PaywallGate } from '@/components/paywall/PaywallGate';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mapGameToDisplay, type GameDisplay } from '@/lib/mappers';
import { reportError } from '@/lib/errorReporting';
import { invalidateCache } from '@/lib/cache';
import { queryClient } from '@/hooks/useQueryClient';

const C = Colors.dark;

// Default Chicago coordinates (used as initial fallback).
// v8.2 Brass Tap P0: this default is the silent reason a user in McKinney TX
// who never had `user_city` resolved correctly was searching a 30km bubble
// around Chicago. Code now resolves the user's city via Supabase profile +
// device GPS BEFORE the first search and only falls back to Chicago if
// every signal is unavailable.
const DEFAULT_LAT = 41.8781;
const DEFAULT_LON = -87.6298;

// Static lat/lon for top US metros — used as the last-resort fallback when
// Nominatim geocoding is failing/rate-limited but we still have a city
// string. Keeps the user from searching Chicago when they typed "Dallas".
const US_METRO_FALLBACKS: Record<string, { lat: number; lon: number }> = {
  atlanta: { lat: 33.749, lon: -84.388 },
  austin: { lat: 30.2672, lon: -97.7431 },
  boston: { lat: 42.3601, lon: -71.0589 },
  chicago: { lat: 41.8781, lon: -87.6298 },
  dallas: { lat: 32.7767, lon: -96.797 },
  denver: { lat: 39.7392, lon: -104.9903 },
  detroit: { lat: 42.3314, lon: -83.0458 },
  houston: { lat: 29.7604, lon: -95.3698 },
  'las vegas': { lat: 36.1699, lon: -115.1398 },
  'los angeles': { lat: 34.0522, lon: -118.2437 },
  mckinney: { lat: 33.1972, lon: -96.6398 },
  miami: { lat: 25.7617, lon: -80.1918 },
  'new york': { lat: 40.7128, lon: -74.006 },
  philadelphia: { lat: 39.9526, lon: -75.1652 },
  phoenix: { lat: 33.4484, lon: -112.074 },
  plano: { lat: 33.0198, lon: -96.6989 },
  portland: { lat: 45.5152, lon: -122.6784 },
  'san antonio': { lat: 29.4241, lon: -98.4936 },
  'san diego': { lat: 32.7157, lon: -117.1611 },
  'san francisco': { lat: 37.7749, lon: -122.4194 },
  seattle: { lat: 47.6062, lon: -122.3321 },
};

function lookupMetroFallback(
  city: string
): { lat: number; lon: number } | null {
  // "McKinney, Texas" → "mckinney"
  const key = city.split(',')[0]!.trim().toLowerCase();
  return US_METRO_FALLBACKS[key] ?? null;
}

// v9.4.0 UAT Round 3 (#4): prior filter was a hardcoded subset of 5
// sports (nfl/nba/mls/mlb/nhl) that stayed static while Discover's sport
// pills already included wnba/cfb/cbb/soccer/etc. per constants/Sports.ts.
// Hosts trying to link a WNBA game had no pill to select. Fold every
// sport in SPORTS into the filter row so the wizard stays in sync with
// the source of truth automatically.
const SPORT_FILTERS = [{ id: 'all', name: 'All' }, ...SPORTS];

type Atmosphere = 'chill' | 'moderate' | 'loud' | 'rowdy';

const ATMOSPHERES: { key: Atmosphere; label: string; emoji: string }[] = [
  { key: 'chill', label: 'Chill', emoji: '😌' },
  { key: 'moderate', label: 'Moderate', emoji: '🙂' },
  { key: 'loud', label: 'Loud', emoji: '🔊' },
  { key: 'rowdy', label: 'Rowdy', emoji: '🤪' },
];

function computeTimePresets(): { label: string; value: string }[] {
  // v8.5 P0: previously this function computed "Tonight 7PM" by setHours(19)
  // regardless of current time. A user creating at 7:48 PM picked
  // "Tonight 7PM" and got a starts_at in the PAST — every list query
  // (.gt('starts_at', now())) then excluded the party so it vanished from
  // the Watch Parties tab.
  // Fix: drop any preset whose computed time is already past + always
  // include forward-looking fallbacks so the row never empties out.
  const now = new Date();

  const makeDate = (dayOffset: number, hours: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hours, 0, 0, 0);
    return d.toISOString();
  };

  // "This Weekend" = next Saturday at 3 PM
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;

  const candidates = [
    { label: 'Tonight 7PM', value: makeDate(0, 19) },
    { label: 'Tonight 8PM', value: makeDate(0, 20) },
    { label: 'Tomorrow 7PM', value: makeDate(1, 19) },
    { label: 'Tomorrow 8PM', value: makeDate(1, 20) },
    { label: 'This Weekend', value: makeDate(daysUntilSaturday, 15) },
  ];

  // Drop presets whose computed time is already in the past relative to
  // now (with a 15-minute grace so "Tonight 7PM" at exactly 7:00 still
  // shows up).
  const cutoff = Date.now() - 15 * 60 * 1000;
  const future = candidates.filter((p) => new Date(p.value).getTime() > cutoff);

  // Guarantee at least three forward-looking presets so the row never
  // collapses to one option late at night.
  if (future.length < 3) {
    future.push({ label: 'Tomorrow Noon', value: makeDate(1, 12) });
    future.push({ label: 'Tomorrow 6PM', value: makeDate(1, 18) });
  }
  return future;
}

// NOTE: do NOT export a module-level constant. computeTimePresets() must
// run fresh on every screen mount, otherwise a user who sits on the
// Create screen for an hour can still select a preset whose computed
// time is now in the past (Hermes module init only happens once per
// process). The component reads `useMemo(computeTimePresets, [])` so
// each mount gets a fresh snapshot.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateWatchPartyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [venueQuery, setVenueQuery] = useState('');
  const [venueResults, setVenueResults] = useState<Venue[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [venueLoading, setVenueLoading] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [selectedManualCoords, setSelectedManualCoords] = useState<{ lat: number; lon: number } | null>(null);
  // v9.4.3 UAT Round 4: locality of the picked manual address, so the party
  // is not stamped with the creator's home city. See selectedManualCity use
  // in handleCreate.
  const [selectedManualCity, setSelectedManualCity] = useState<string | null>(null);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2 state
  const [sportFilter, setSportFilter] = useState('all');
  const [selectedGame, setSelectedGame] = useState<GameDisplay | null>(null);
  const [noGame, setNoGame] = useState(false);
  const [allGames, setAllGames] = useState<GameDisplay[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);

  // Step 3 state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [atmosphere, setAtmosphere] = useState<Atmosphere>('moderate');
  const [capacity, setCapacity] = useState(50);
  // useMemo runs once per mount — gives a fresh "what's still in the
  // future?" snapshot each time the user opens the Create flow, so a
  // user who returned to a stale screen never picks a past preset.
  const TIME_PRESETS = React.useMemo(() => computeTimePresets(), []);
  const [selectedTime, setSelectedTime] = useState(TIME_PRESETS[0].value);
  // v9.4.0 UAT Round 3 (#4): custom date+time picker for hosts scheduling
  // 1-2+ weeks out. Presets stop at "This Weekend"; without a custom
  // path the wizard couldn't create an August 22nd party. `customTime`
  // holds the user's picked ISO; when set, it wins over any preset.
  const [customTime, setCustomTime] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  // v9.5.7 (iOS UAT BUG-16): the picker opened on "Sep 16, 2026" -- a week
  // out -- because the draft was seeded at now + 7 days. Nothing about the
  // custom path implies "a week from now"; it exists for any date the five
  // presets don't cover, and the nearest of those is tomorrow. Seeding at
  // tomorrow 7 PM means the most common custom choices are a scroll or two
  // away instead of a week of back-scrolling.
  const [customPickerDraft, setCustomPickerDraft] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
    return d;
  });
  const effectiveStartTime = customTime ?? selectedTime;
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [invitedFriends, setInvitedFriends] = useState<{ name: string; phone: string }[]>([]);
  const [friendName, setFriendName] = useState('');
  const [friendPhone, setFriendPhone] = useState('');
  const [showManualInvite, setShowManualInvite] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactsList, setContactsList] = useState<Contacts.Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [creating, setCreating] = useState(false);

  // Geo coordinates for venue search (loaded from user city).
  // `coordSource` tracks WHY we're at these coords so we can fall back
  // intelligently when the user's search returns nothing.
  const [searchLat, setSearchLat] = useState(DEFAULT_LAT);
  const [searchLon, setSearchLon] = useState(DEFAULT_LON);
  const [userCity, setUserCity] = useState<string | null>(null);
  const [coordSource, setCoordSource] = useState<
    'default' | 'geocode' | 'metro_fallback' | 'device_gps'
  >('default');

  // Resolve the user's search center. v8.2 Brass Tap P0: cascade through
  //   1) Nominatim geocode of stored `user_city`
  //   2) Static US-metro lookup (Nominatim down / "Dallas, TX" geocoded
  //      to the wrong McKinney etc.)
  //   3) Device GPS (real "where I am right now")
  //   4) Chicago default (last resort — same as before)
  // …so a user in McKinney never falls through to searching Chicago.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let storedCity: string | null = null;
      let storedState: string | null = null;
      try {
        storedCity = await AsyncStorage.getItem('user_city');
        storedState = await AsyncStorage.getItem('user_state');
      } catch {
        // ignore — fallthrough to GPS/default below
      }

      // v8.5 P0: previously this read AsyncStorage 'user_city' ONLY.
      // If AsyncStorage was empty (fresh install, cache cleared) the cascade
      // fell through to Chicago even though users.home_city had the right
      // value in Supabase. We now fetch home_city + home_state from the
      // public.users table (keyed by auth_id) as a tier-0 source-of-truth,
      // then write back to AsyncStorage so subsequent screens hit the warm
      // cache.
      if (!storedCity) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase
              .from('users')
              .select('home_city, home_state')
              .eq('auth_id', user.id)
              .maybeSingle();
            const dbCity = (profile?.home_city ?? '').toString().trim();
            const dbState = (profile?.home_state ?? '').toString().trim();
            if (dbCity) {
              storedCity = dbCity;
              storedState = dbState || null;
              try {
                await AsyncStorage.setItem('user_city', dbCity);
                if (dbState) {
                  await AsyncStorage.setItem('user_state', dbState);
                }
              } catch {
                // best-effort cache seed
              }
            }
          }
        } catch {
          // network/auth failure — fall through to GPS/default
        }
      }

      if (storedCity) {
        if (!cancelled) setUserCity(storedCity);

        // Build a state-qualified query for geocoding so Nominatim
        // doesn't pick the wrong "Dallas" (TX vs OR vs PA vs GA).
        // Strip any state already embedded in the city string first to
        // avoid "Dallas, TX, TX" double-tacking.
        const cityForGeocode = (() => {
          const stripped = storedCity.split(',')[0]?.trim() ?? storedCity;
          if (storedState) return `${stripped}, ${storedState}`;
          return storedCity;
        })();

        // (1) Try real geocode first.
        try {
          const geo = await geocodeCity(cityForGeocode);
          if (!cancelled && geo) {
            console.log(
              `[create-watch-party] coords from geocode "${cityForGeocode}" → (${geo.lat}, ${geo.lon})`
            );
            setSearchLat(geo.lat);
            setSearchLon(geo.lon);
            setCoordSource('geocode');
            return;
          }
        } catch {
          // swallow — try metro fallback next
        }

        // (2) Static metro fallback.
        const metro = lookupMetroFallback(storedCity);
        if (!cancelled && metro) {
          console.log(
            `[create-watch-party] coords from metro fallback "${storedCity}" → (${metro.lat}, ${metro.lon})`
          );
          setSearchLat(metro.lat);
          setSearchLon(metro.lon);
          setCoordSource('metro_fallback');
          return;
        }
      }

      // (3) Device GPS — best signal when the user hasn't set a home_city.
      try {
        if (Platform.OS !== 'web') {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === 'granted') {
            const pos = await Location.getLastKnownPositionAsync();
            if (!cancelled && pos) {
              console.log(
                `[create-watch-party] coords from device GPS → (${pos.coords.latitude}, ${pos.coords.longitude})`
              );
              setSearchLat(pos.coords.latitude);
              setSearchLon(pos.coords.longitude);
              setCoordSource('device_gps');
              return;
            }
          }
        }
      } catch {
        // ignore — fall through to default
      }

      // (4) Keep Chicago default. Log it so device logs make the cause obvious.
      console.warn(
        '[create-watch-party] no home_city / GPS — using Chicago default coords'
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load upcoming games from Supabase.
  //
  // v9.4.0 UAT Round 3 (#4): prior code capped at 20 rows which is a
  // day or two of MLB during the regular season. Hosts scheduling a
  // party 1-2 weeks out saw an empty list because those games hadn't
  // scrolled into the first 20. Bumped to 200 so a ~2-week window is
  // returned and rendered in day-grouped sections below.
  useEffect(() => {
    (async () => {
      setGamesLoading(true);
      try {
        const { data, error } = await supabase
          .from('games')
          .select('*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)')
          .gt('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(200);

        if (error) throw error;
        setAllGames((data || []).map(mapGameToDisplay));
      } catch {
        setAllGames([]);
      } finally {
        setGamesLoading(false);
      }
    })();
  }, []);

  // -----------------------------------------------------------------------
  // Venue search
  //
  // v8.2 Brass Tap P0: `searchVenues` now returns `{ venues, status }` so
  // we can render "API down" vs "0 hits in OSM" as two distinct messages.
  // On retry after a failure we also reset the circuit breaker so a user
  // re-tapping Search doesn't silently get short-circuited for another
  // 60s.
  // -----------------------------------------------------------------------
  const [searchError, setSearchError] = useState<string | null>(null);
  const lastSearchFailedRef = useRef(false);

  // v8.7+ P0: opt-in device-GPS for venue distances. Search center stays at
  // the user's home_city (so a McKinney user still gets the full Dallas-
  // metro catchment), but `userLocation` — when granted — overrides the
  // returned `distanceMeters` so each row reads "5 mi" instead of
  // "33 mi from downtown Dallas".
  //
  // Stays OFF by default; only requests permission when the user taps
  // "Use my location". Apple/Play guidelines + sensible UX both prefer
  // just-in-time prompts tied to a clear action.
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'requesting' | 'denied' | 'active'
  >('idle');


  // v9.5.6 (BUG-5): the search runner is parameterised so the same code
  // path serves an explicit query and the implicit "what's near me"
  // browse. `centre` is the Places locationBias anchor; `emptyLabel` is
  // what the zero-hit message calls the thing that was searched for.
  const runVenueSearch = useCallback(async (
    rawQuery: string,
    centre: { lat: number; lon: number },
    emptyLabel: string,
  ) => {
    const venueQuery = rawQuery;
    if (!venueQuery.trim()) return;
    const searchLat = centre.lat;
    const searchLon = centre.lon;
    setVenueLoading(true);
    setSearchError(null);

    if (lastSearchFailedRef.current) {
      resetVenueBreakers();
      lastSearchFailedRef.current = false;
    }

    let verboseFlag = false;
    try {
      verboseFlag = (await AsyncStorage.getItem('verbose_search_errors')) === '1';
    } catch {
      // ignore
    }
    const showDebug = __DEV__ || verboseFlag;
    const debugSuffix = (err: string | undefined): string =>
      showDebug
        ? ` (coord_source=${coordSource}@${
            (userCity || 'unknown').split(',')[0]?.trim().toLowerCase()
          }, tier=places, err=${err ?? 'n/a'})`
        : '';

    try {
      const result = await searchVenues(
        searchLat,
        searchLon,
        venueQuery,
        30000,
        userLocation,
      );

      console.log(
        `[create-watch-party] venue search tier=places status=${result.status} hits=${result.venues.length} ` +
          `coordSource=${coordSource} center=(${searchLat.toFixed(3)},${searchLon.toFixed(3)}) q="${venueQuery.trim()}"`
      );

      if (result.status === 'ok' && result.venues.length > 0) {
        setVenueResults(result.venues);
        setVenueLoading(false);
        return;
      }

      setVenueResults([]);

      if (result.status === 'ok') {
        setSearchError(
          `No venues found within 30 km of ${userCity ?? 'your location'} matching ${emptyLabel}. Try a shorter name, or "Enter venue manually".` +
            debugSuffix(undefined)
        );
      } else {
        lastSearchFailedRef.current = true;
        console.error('[create-watch-party] venue search failed:', result.errorMessage);
        // v9.4.2 UAT: pipe the actual edge-function errorMessage into
        // error reporting so a production "Search temporarily unavailable"
        // no longer disappears into device console-log. Common cause is
        // the venue-search function missing GOOGLE_PLACES_API_KEY on prod.
        reportError(new Error(result.errorMessage ?? 'venue-search returned non-ok'), {
          source: 'create-watch-party:handleVenueSearch',
          status: result.status,
          coordSource,
          city: userCity ?? null,
          query: venueQuery.trim(),
        });
        setSearchError(
          'Search temporarily unavailable. Check your connection and tap Search to retry, or "Enter venue manually".' +
            debugSuffix(result.errorMessage)
        );
      }
    } catch (e: any) {
      lastSearchFailedRef.current = true;
      console.error('[create-watch-party] unexpected venue search error:', e);
      reportError(e, {
        source: 'create-watch-party:handleVenueSearch',
        coordSource,
        city: userCity ?? null,
        query: venueQuery.trim(),
      });
      setVenueResults([]);
      setSearchError(
        'Something went wrong searching for venues. Tap Search to retry, or "Enter venue manually".' +
          debugSuffix(e?.message)
      );
    } finally {
      setVenueLoading(false);
    }
  }, [coordSource, userCity, userLocation]);

  const handleVenueSearch = useCallback(() => {
    if (!venueQuery.trim()) return;
    return runVenueSearch(
      venueQuery,
      { lat: searchLat, lon: searchLon },
      `"${venueQuery.trim()}"`,
    );
  }, [runVenueSearch, venueQuery, searchLat, searchLon]);

  // Browse-without-typing.
  //
  // iOS UAT 2026-09-09, BUG-5: granting location flipped the pill to
  // "Using your location" and then did nothing -- empty results area, no
  // hint, Next still disabled. A first-time host had granted a permission
  // and been handed a dead end.
  //
  // Handing over your GPS is a request to be shown what's around you, so
  // that is now what happens. Anchored on the device fix rather than the
  // home-city centroid: the whole point of the tap was "near ME".
  const handleNearbySearch = useCallback(
    (coords: { lat: number; lon: number }) =>
      runVenueSearch('sports bar', coords, 'sports bars near you'),
    [runVenueSearch],
  );

  const handleUseMyLocation = useCallback(async () => {
    if (locationStatus === 'requesting') return;
    setLocationStatus('requesting');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('denied');
        Alert.alert(
          'Location permission needed',
          'Enable location access in Settings to see distances from where you actually are. We only use this for distance display — your position is never stored.',
        );
        return;
      }
      // getCurrentPositionAsync gives a fresh, accurate fix.
      // getLastKnownPositionAsync would be faster but can be hours stale on
      // Android. For a one-tap action the ~1 s wait is fine.
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!pos?.coords) {
        setLocationStatus('denied');
        return;
      }
      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setUserLocation(coords);
      setLocationStatus('active');
      // Only auto-browse when the host hasn't already typed something --
      // clobbering a half-typed venue name with a generic nearby list
      // would be its own bug.
      if (!venueQuery.trim() && venueResults.length === 0) {
        void handleNearbySearch(coords);
      }
    } catch (e: any) {
      console.warn('[create-watch-party] location request failed', e?.message);
      setLocationStatus('denied');
    }
  }, [locationStatus, venueQuery, venueResults.length, handleNearbySearch]);

  const handleClearMyLocation = useCallback(() => {
    setUserLocation(null);
    setLocationStatus('idle');
  }, []);

  // -----------------------------------------------------------------------
  // Address autocomplete (debounced)
  // -----------------------------------------------------------------------
  const handleAddressChange = useCallback(
    (text: string) => {
      setManualAddress(text);
      setSelectedManualCoords(null);

      if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);

      if (text.trim().length < 3) {
        setAddressSuggestions([]);
        return;
      }

      setAddressLoading(true);
      addressDebounceRef.current = setTimeout(async () => {
        const results = await searchAddress(text, searchLat, searchLon);
        setAddressSuggestions(results);
        setAddressLoading(false);
      }, 400);
    },
    [searchLat, searchLon]
  );

  const handleSelectAddress = useCallback((suggestion: AddressSuggestion) => {
    setManualAddress(suggestion.displayName);
    setSelectedManualCoords({ lat: suggestion.lat, lon: suggestion.lon });
    // v9.4.3: Nominatim hands back the locality for the picked suggestion --
    // exact, so it beats re-parsing the formatted string later.
    setSelectedManualCity(suggestion.city ?? null);
    setAddressSuggestions([]);
  }, []);

  // -----------------------------------------------------------------------
  // Contact picker
  // -----------------------------------------------------------------------
  const openContactPicker = useCallback(async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Contacts permission denied',
        'Enable Contacts access in Settings, or use "Enter manually" to add friends by phone number.'
      );
      return;
    }
    setContactPickerOpen(true);
    setContactsLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      const withPhones = data
        .filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0 && c.name)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setContactsList(withPhones);
    } catch (e) {
      Alert.alert('Could not load contacts', 'Please try again.');
      setContactPickerOpen(false);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  const addContactToInvites = useCallback((name: string, phone: string) => {
    const cleaned = phone.replace(/\s+/g, '');
    setInvitedFriends((prev) => {
      if (prev.some((f) => f.phone.replace(/\s+/g, '') === cleaned)) return prev;
      return [...prev, { name, phone }];
    });
  }, []);

  const handlePickContact = useCallback(
    (contact: Contacts.Contact) => {
      const phones = contact.phoneNumbers || [];
      const name = contact.name || 'Unknown';
      if (phones.length === 1) {
        addContactToInvites(name, phones[0].number || '');
        setContactPickerOpen(false);
        return;
      }
      Alert.alert(
        `Pick a number for ${name}`,
        undefined,
        [
          ...phones.map((p) => ({
            text: `${p.label ? `${p.label}: ` : ''}${p.number}`,
            onPress: () => {
              addContactToInvites(name, p.number || '');
              setContactPickerOpen(false);
            },
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ]
      );
    },
    [addContactToInvites]
  );

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  const metersToMiles = (m: number) => (m / 1609.344).toFixed(1);

  const venueTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'bar':
        return '#6c5ce7';
      case 'pub':
        return '#00b894';
      case 'restaurant':
        return '#e17055';
      case 'cafe':
        return '#fdcb6e';
      default:
        return C.textMuted;
    }
  };

  const isStep1Valid = manualEntry
    ? manualName.trim().length > 0
    : selectedVenue !== null;

  const filteredGames =
    sportFilter === 'all'
      ? allGames
      : allGames.filter(
          (g) =>
            g.sport === sportFilter ||
            (sportFilter === 'mls' && g.sport === 'soccer')
        );

  // v9.4.0 UAT Round 3 (#4): group filtered games by local-day into an
  // ESPN/Google-style layout (Today / Tomorrow / Fri Aug 14 / ...). Each
  // section renders 5 games and reveals the rest behind a "Show more"
  // toggle. Sections without any games are omitted entirely.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const gamesByDay = React.useMemo(() => {
    const buckets = new Map<string, { label: string; games: GameDisplay[] }>();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    for (const g of filteredGames) {
      if (!g.scheduledAt) continue;
      const d = new Date(g.scheduledAt);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((dayStart - startOfToday) / (24 * 60 * 60 * 1000));
      let label: string;
      if (diffDays === 0) label = 'Today';
      else if (diffDays === 1) label = 'Tomorrow';
      else label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      const bucket = buckets.get(dayKey);
      if (bucket) {
        bucket.games.push(g);
      } else {
        buckets.set(dayKey, { label, games: [g] });
      }
    }
    return [...buckets.entries()].map(([key, val]) => ({ key, ...val }));
  }, [filteredGames]);

  const toggleDay = (key: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Auto-generate title when entering step 3.
  //
  // v9.5.6 (iOS UAT BUG-7): the game-derived title was
  // "<Home> vs <Away> Watch Party", which for "Indiana Hoosiers vs North
  // Texas Mean Green" overflowed a single-line input as
  // "…North Texas Mean Green W…" -- the host could not see what the
  // title ended with without tapping into the field.
  //
  // The " Watch Party" suffix was the least informative 12 characters in
  // the string and the screen it appears on is already titled "Party
  // details" on a Create Watch Party wizard, so it is redundant as well as
  // expensive. Dropping it, plus letting the input wrap to two lines,
  // makes the common case fully readable. The venue-derived variants keep
  // their wording -- "Watch Party at Brass Tap" is short and reads as a
  // sentence rather than a fixture.
  const goToStep3 = () => {
    let autoTitle = '';
    if (selectedGame) {
      autoTitle = `${selectedGame.homeTeam.name} vs ${selectedGame.awayTeam.name}`;
    } else if (manualEntry && manualName.trim()) {
      autoTitle = `Watch Party at ${manualName.trim()}`;
    } else if (selectedVenue) {
      autoTitle = `Watch Party at ${selectedVenue.name}`;
    } else {
      autoTitle = 'Watch Party';
    }
    if (!title) setTitle(autoTitle);
    setStep(3);
  };

  // -----------------------------------------------------------------------
  // Create party
  // -----------------------------------------------------------------------
  const handleCreate = async () => {
    setCreating(true);

    // v9.5.7 (iOS UAT BUG-13): a manual venue whose address was TYPED but
    // whose autocomplete suggestion was never TAPPED had selectedManualCoords
    // === null, and the insert below fell back to DEFAULT_LAT/DEFAULT_LON --
    // the Chicago constants at the top of this file. The tester created
    // "QA Test Bar, 2500 Victory Ave, Dallas" and it was written at
    // 41.8781/-87.6298, downtown Chicago, with venue_city 'Dallas'. The
    // detail screen looked perfect; every distance-ranked surface put the
    // party 800 miles away.
    //
    // A default coordinate is the wrong shape of answer here. Geocode what
    // the host actually typed, and if that cannot be resolved, say so
    // instead of inventing a location.
    let resolvedManualCoords = selectedManualCoords;
    if (manualEntry && !resolvedManualCoords && manualAddress.trim().length >= 3) {
      try {
        const hits = await searchAddress(manualAddress.trim(), searchLat, searchLon);
        if (hits.length > 0) {
          resolvedManualCoords = { lat: hits[0].lat, lon: hits[0].lon };
          if (!selectedManualCity && hits[0].city) setSelectedManualCity(hits[0].city);
        }
      } catch {
        // Fall through to the guard below.
      }
    }
    if (manualEntry && !resolvedManualCoords) {
      setCreating(false);
      Alert.alert(
        'We need the venue location',
        "We couldn't find that address on the map, so people wouldn't be able to see how far away your party is. Pick one of the address suggestions as you type, or try a fuller address.",
      );
      return;
    }

    const venueName = manualEntry ? manualName.trim() : selectedVenue?.name ?? '';
    const venueAddress = manualEntry
      ? manualAddress.trim()
      : selectedVenue?.address ?? '';

    const venueCity = manualEntry
      ? selectedManualCity ?? cityFromAddress(venueAddress)
      : cityFromAddress(venueAddress);

    const localId = `wp-${Date.now()}`;

    const partyData: Record<string, any> = {
      title: title.trim() || 'Watch Party',
      description: description.trim(),
      venue_name: venueName,
      venue_address: venueAddress,
      // v9.4.3 UAT Round 4: was `userCity`, the CREATOR's home city. A party
      // at "301 N Custer Rd #180, McKinney, TX 75071" created by a Dallas
      // user rendered as "Uncork'd Bar & Grill · Dallas" on the detail
      // screen and the RSVP tab. The search radius stays anchored to
      // home_city (a McKinney fan wants the whole metro) but the SAVED city
      // must describe the venue. userCity survives only as a last resort
      // for an unparseable address.
      venue_city: venueCity ?? (userCity ? userCity.split(',')[0]!.trim() : null),
      // The metro this party is filed under for "near you" matching (mig
      // 087). Keeps a McKinney venue discoverable by Dallas fans now that
      // venue_city names the venue's own city.
      venue_metro: userCity ? userCity.split(',')[0]!.trim() : null,
      // BUG-13: no Chicago fallback on the manual path -- handleCreate
      // returns early above rather than guessing. A Places-selected venue
      // always carries real coordinates, so its ?? is unreachable in
      // practice and stays only as a type guard.
      venue_lat: manualEntry ? resolvedManualCoords!.lat : (selectedVenue?.lat ?? DEFAULT_LAT),
      venue_lon: manualEntry ? resolvedManualCoords!.lon : (selectedVenue?.lon ?? DEFAULT_LON),
      game_id: selectedGame?.id ?? null,
      atmosphere,
      capacity,
      starts_at: effectiveStartTime,
      visibility: visibility === 'private' ? 'private' : 'public',
    };

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated');

      // Look up sport_id if a game is selected
      if (selectedGame?.sport) {
        const { data: sportRow } = await supabase
          .from('sports')
          .select('id')
          .ilike('name', selectedGame.sport)
          .maybeSingle();
        if (sportRow) partyData.sport_id = sportRow.id;
      }

      const { data: partyRow, error: insertError } = await supabase
        .from('watch_parties')
        .insert({ ...partyData, creator_id: userId })
        .select()
        .single();

      if (insertError) throw insertError;
      if (!partyRow) throw new Error('Failed to create party');

      // Auto-RSVP as 'going'. v8.5 P0: previously this insert had no error
      // check, so an RLS rejection (e.g. transient auth refresh race)
      // silently produced a party with no RSVP row — the
      // creator looked like a non-attendee and "RSVP still not saving"
      // got reported across 4 UAT cycles. We now check the error, retry
      // once after a 250ms delay (covers fast double-create races), and
      // surface a visible Alert if both attempts fail so the user is no
      // longer left guessing.
      const tryRsvp = async () => {
        return supabase.from('watch_party_rsvps').insert({
          watch_party_id: partyRow.id,
          user_id: userId,
          status: 'going',
        });
      };
      const first = await tryRsvp();
      if (first.error) {
        const code = (first.error as any)?.code;
        const msg = (first.error.message ?? '').toLowerCase();
        const isDup = code === '23505' || msg.includes('duplicate');
        if (!isDup) {
          await new Promise((r) => setTimeout(r, 250));
          const retry = await tryRsvp();
          if (retry.error) {
            const rCode = (retry.error as any)?.code;
            const rMsg = (retry.error.message ?? '').toLowerCase();
            const rDup = rCode === '23505' || rMsg.includes('duplicate');
            if (!rDup) {
              reportError(retry.error, {
                source: 'create-watch-party:autoRsvp',
                partyId: partyRow.id,
                attempt: 2,
              });
              // Surface a non-blocking Alert. We don't roll back the
              // party — the row is still created and other users can
              // RSVP — but the host should know to tap RSVP themselves.
              Alert.alert(
                'Party created — RSVP not saved',
                'Your watch party was created, but we couldn\'t auto-RSVP you. Open the party and tap RSVP to mark yourself as going.'
              );
            }
          }
        }
      }

      // Save invited friends for private parties
      if (invitedFriends.length > 0) {
        await supabase.from('watch_party_invites').insert(
          invitedFriends.map((f) => ({
            watch_party_id: partyRow.id,
            invited_by: userId,
            name: f.name,
            phone: f.phone,
          }))
        );
      }

      // v8.5 P0 (round 2): purge the AsyncStorage offline-fallback +
      // React Query cache for watch parties so the just-created party
      // is visible on the next Home/Discover fetch. Without this, the
      // stale offline-fallback layer could serve the prior empty list
      // back through a getStaleCache call inside the queryFn catch
      // (network blip during refetch), causing the v8.4 "party doesn't
      // appear for 2 minutes" symptom to re-emerge.
      if (userCity) {
        await invalidateCache('watchParties', userCity).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['watchParties'] });
      queryClient.invalidateQueries({ queryKey: ['watchPartiesInfinite'] });

      setCreating(false);
      Alert.alert('Watch Party Created!', `"${partyData.title}" is live.`, [
        {
          text: 'View Party',
          onPress: () => {
            router.back();
            setTimeout(() => router.push(`/watch-party/${partyRow.id}` as any), 100);
          },
        },
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      setCreating(false);
      // v9.1 UAT pivot: creating a watch party is a free-tier action.
      // Migration 070 drops the has_premium_access gate on
      // watch_parties_insert so this catch only fires on genuine errors
      // (network, validation, RLS mismatch other than premium). Show a
      // neutral toast instead of a paywall sheet.
      Alert.alert('Error', 'Could not create watch party. Please try again.');
    }
  };

  // -----------------------------------------------------------------------
  // Step indicator
  // -----------------------------------------------------------------------
  const StepIndicator = () => (
    <View style={styles.stepDots}>
      {[1, 2, 3].map((s) => (
        <View
          key={s}
          style={[
            styles.dot,
            s === step ? styles.dotActive : styles.dotInactive,
          ]}
        />
      ))}
    </View>
  );

  // -----------------------------------------------------------------------
  // Render steps
  // -----------------------------------------------------------------------

  const renderStep1 = () => (
    <ScrollView style={styles.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Where are you watching?</Text>

      {!manualEntry ? (
        <>
          {/* v8.7+ Opt-in GPS for accurate distance display.
              Search is still anchored to home_city (broader catchment),
              but distances show "X mi from you" when location is on. */}
          <View style={styles.locationRow}>
            {locationStatus === 'active' && userLocation ? (
              <View style={styles.locationActivePill}>
                <CheckCircle2 size={14} color={C.success} />
                <Text style={styles.locationActiveText}>Using your location</Text>
                <TouchableOpacity
                  onPress={handleClearMyLocation}
                  hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                >
                  <X size={14} color={C.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.locationCta}
                onPress={handleUseMyLocation}
                disabled={locationStatus === 'requesting'}
                activeOpacity={0.8}
              >
                {locationStatus === 'requesting' ? (
                  <ActivityIndicator size="small" color={C.accent} />
                ) : (
                  <MapPin size={14} color={C.accent} />
                )}
                <Text style={styles.locationCtaText}>
                  {locationStatus === 'requesting'
                    ? 'Getting your location…'
                    : '📍 Use my location for distances'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search venue name or location..."
              placeholderTextColor={C.textMuted}
              value={venueQuery}
              onChangeText={setVenueQuery}
              onSubmitEditing={handleVenueSearch}
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleVenueSearch}>
              <Text style={styles.searchBtnText}>Search</Text>
            </TouchableOpacity>
          </View>

          {venueLoading && (
            <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} />
          )}

          {!venueLoading && searchError && (
            <View style={styles.searchErrorBox}>
              <Text style={styles.searchErrorText}>{searchError}</Text>
            </View>
          )}

          {/* BUG-5: an empty results area with a disabled Next button told
              a first-time host nothing. Say what to do instead. */}
          {!venueLoading && !searchError && venueResults.length === 0 && (
            <View style={styles.venueHintBox}>
              <Text style={styles.venueHintText}>
                {locationStatus === 'active'
                  ? 'Search a bar or restaurant by name, or type a city to see what’s there. Nothing you like? Tap “Enter venue manually” below.'
                  : 'Search a bar or restaurant by name — or a city, like “Prosper TX” — to see places nearby.'}
              </Text>
            </View>
          )}

          {/* Distance-mode hint — only shown once results are in so a
              first-time user isn't reading legalese before they search. */}
          {!venueLoading && venueResults.length > 0 && (
            <Text style={styles.distanceHint}>
              {locationStatus === 'active'
                ? 'Distances from your current location'
                : `Distances from ${userCity || 'your city'} — tap "Use my location" above for accurate mileage`}
            </Text>
          )}

          {venueResults.map((v, i) => {
            const isSelected = selectedVenue?.name === v.name && selectedVenue?.lat === v.lat;
            return (
              <TouchableOpacity
                key={`${v.name}-${i}`}
                style={[styles.venueCard, isSelected && styles.venueCardSelected]}
                onPress={() => setSelectedVenue(v)}
              >
                <View style={styles.venueCardTop}>
                  <Text style={styles.venueName}>{v.name}</Text>
                  <View
                    style={[
                      styles.venueTypeBadge,
                      { backgroundColor: venueTypeBadgeColor(v.type) },
                    ]}
                  >
                    <Text style={styles.venueTypeBadgeText}>{v.type}</Text>
                  </View>
                </View>
                <Text style={styles.venueAddress}>{v.address}</Text>
                <Text style={styles.venueDistance}>
                  {metersToMiles(v.distance)} mi away
                </Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity onPress={() => setManualEntry(true)}>
            <Text style={styles.manualLink}>Enter venue manually</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Venue name"
            placeholderTextColor={C.textMuted}
            value={manualName}
            onChangeText={setManualName}
          />
          <TextInput
            style={[styles.input, { marginTop: 12 }]}
            placeholder="Address (start typing to search...)"
            placeholderTextColor={C.textMuted}
            value={manualAddress}
            onChangeText={handleAddressChange}
          />
          {addressLoading && (
            <ActivityIndicator color={C.accent} style={{ marginTop: 8 }} size="small" />
          )}
          {addressSuggestions.length > 0 && (
            <View style={styles.addressDropdown}>
              {addressSuggestions.map((s, i) => (
                <TouchableOpacity
                  key={`addr-${i}`}
                  style={styles.addressItem}
                  onPress={() => handleSelectAddress(s)}
                >
                  <Text style={styles.addressItemText} numberOfLines={2}>
                    {s.displayName}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity
            onPress={() => {
              setManualEntry(false);
              setManualName('');
              setManualAddress('');
            }}
          >
            <Text style={styles.manualLink}>Search for venues instead</Text>
          </TouchableOpacity>
        </>
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  );

  const renderStep2 = () => (
    <ScrollView style={styles.stepContent}>
      <Text style={styles.stepTitle}>Link a game (optional)</Text>

      {/* Sport filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
      >
        {SPORT_FILTERS.map((sf) => (
          <TouchableOpacity
            key={sf.id}
            style={[
              styles.filterPill,
              sportFilter === sf.id && styles.filterPillActive,
            ]}
            onPress={() => setSportFilter(sf.id)}
          >
            <Text
              style={[
                styles.filterPillText,
                sportFilter === sf.id && styles.filterPillTextActive,
              ]}
            >
              {sf.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* No game option */}
      <TouchableOpacity
        style={[
          styles.gameCard,
          noGame && !selectedGame && styles.gameCardSelected,
        ]}
        onPress={() => {
          setNoGame(true);
          setSelectedGame(null);
        }}
      >
        <Text style={styles.noGameText}>
          General watch party — no game linked
        </Text>
      </TouchableOpacity>

      {/* Game list -- v9.4.0 UAT Round 3 (#4): grouped by local day
          with a 5-per-section preview + "Show more" toggle. Mirrors
          how Google/ESPN render an upcoming schedule so a host
          planning 1-2 weeks out can scroll to Fri/Sat and pick the
          game without an overwhelming flat list. */}
      {gamesLoading && (
        <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} />
      )}
      {gamesByDay.map((day) => {
        const expanded = expandedDays.has(day.key);
        const visible = expanded ? day.games : day.games.slice(0, 5);
        const hidden = day.games.length - visible.length;
        return (
          <View key={day.key} style={{ marginTop: 8 }}>
            <Text style={styles.dayHeader}>{day.label}</Text>
            {visible.map((g) => {
              const isSelected = selectedGame?.id === g.id;
              return (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.gameCard, isSelected && styles.gameCardSelected]}
                  onPress={() => {
                    setSelectedGame(g);
                    setNoGame(false);
                  }}
                >
                  <Text style={styles.gameTeams}>
                    {g.homeTeam.icon} {g.homeTeam.name}{'  '}vs{'  '}
                    {g.awayTeam.icon} {g.awayTeam.name}
                  </Text>
                  <View style={styles.gameMetaRow}>
                    <Text style={styles.gameTime}>{g.time}</Text>
                    <Text style={styles.gameLeague}>{g.league}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            {hidden > 0 && (
              <TouchableOpacity
                style={styles.showMoreBtn}
                onPress={() => toggleDay(day.key)}
              >
                <Text style={styles.showMoreText}>Show {hidden} more</Text>
              </TouchableOpacity>
            )}
            {expanded && day.games.length > 5 && (
              <TouchableOpacity
                style={styles.showMoreBtn}
                onPress={() => toggleDay(day.key)}
              >
                <Text style={styles.showMoreText}>Show less</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <View style={{ height: 100 }} />
    </ScrollView>
  );

  const renderStep3 = () => (
    // v9.2.5 UAT 2026-07-28: 120px bottom padding gives the last text field
    // room to scroll above the on-screen keyboard on shorter Android devices
    // where the resize alone doesn't leave the focused input visible.
    <ScrollView
      style={styles.stepContent}
      contentContainerStyle={{ paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Text style={styles.stepTitle}>Party details</Text>

      {/* Title */}
      <Text style={styles.fieldLabel}>Title</Text>
      <TextInput
        style={[styles.input, styles.titleInput]}
        placeholder="Watch Party Title"
        placeholderTextColor={C.textMuted}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        // BUG-7: wraps instead of clipping. blurOnSubmit keeps Return
        // closing the keyboard rather than inserting a newline into a
        // field that is rendered on one line everywhere else.
        multiline
        blurOnSubmit
        returnKeyType="done"
        onSubmitEditing={Keyboard.dismiss}
        textAlignVertical="top"
      />

      {/* Description */}
      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
        Description (optional)
      </Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        placeholder="Tell people what to expect..."
        placeholderTextColor={C.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        maxLength={2000}
      />

      {/* Atmosphere */}
      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Atmosphere</Text>
      <View style={styles.atmosphereRow}>
        {ATMOSPHERES.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[
              styles.atmospherePill,
              atmosphere === a.key && styles.atmospherePillActive,
            ]}
            onPress={() => setAtmosphere(a.key)}
          >
            <Text style={styles.atmospherePillText}>
              {a.emoji} {a.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Capacity */}
      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Capacity</Text>
      <View style={styles.capacityRow}>
        <TouchableOpacity
          style={styles.capacityBtn}
          onPress={() => setCapacity((c) => Math.max(5, c - 5))}
        >
          <Text style={styles.capacityBtnText}>-</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.capacityInput}
          value={String(capacity)}
          onChangeText={(t) => {
            const n = parseInt(t, 10);
            if (!isNaN(n)) setCapacity(Math.min(500, Math.max(5, n)));
          }}
          keyboardType="number-pad"
        />
        <TouchableOpacity
          style={styles.capacityBtn}
          onPress={() => setCapacity((c) => Math.min(500, c + 5))}
        >
          <Text style={styles.capacityBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Start time
          v9.4.0 UAT Round 3 (#4): custom-date chip added so hosts
          scheduling 1-2+ weeks out (e.g. "Sunday Aug 22, 4pm") have a
          path. Selecting a preset clears customTime; picking a custom
          time deselects the preset visually via customTime !== null.

          v9.5.6 (iOS UAT BUG-6): the custom chip used to RELABEL itself
          with the chosen date, which meant "Custom…" vanished the moment
          you used it -- no visible way back into the picker -- and the
          longer label wrapped the chip onto a row of its own, stranded
          under five presets still drawn in their unselected style. Nothing
          on screen said which value was actually going to be used.

          Now the picker entry keeps its name and its place on a dedicated
          row, and a single summary line states the start time in full. The
          summary also answers the "did I choose this?" problem with the
          pre-selected 'Tonight 7PM' default: whatever is live is spelled
          out, chosen or inherited. */}
      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Start time</Text>
      <View style={styles.timeRow}>
        {TIME_PRESETS.map((t) => {
          const isActive = !customTime && selectedTime === t.value;
          return (
            <TouchableOpacity
              key={t.value}
              style={[styles.timeChip, isActive && styles.timeChipActive]}
              onPress={() => {
                setSelectedTime(t.value);
                setCustomTime(null);
                // BUG-16: the iOS pickers render INLINE (a compact
                // "Sep 16, 2026" button), and tapping a preset left
                // showDatePicker true -- so the picker stayed on screen
                // under the chips and read as a second active value.
                // Choosing a preset is a decision to not use the picker.
                setShowDatePicker(false);
                setShowTimePicker(false);
              }}
            >
              <Text
                style={[styles.timeChipText, isActive && styles.timeChipTextActive]}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.customTimeRow}>
        <TouchableOpacity
          style={[styles.customTimeBtn, !!customTime && styles.timeChipActive]}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.8}
        >
          <CalendarDays
            size={15}
            color={customTime ? '#fff' : C.textSecondary}
          />
          <Text
            style={[
              styles.timeChipText,
              !!customTime && styles.timeChipTextActive,
            ]}
          >
            {customTime ? 'Change date & time…' : 'Pick another date…'}
          </Text>
        </TouchableOpacity>
        {customTime ? (
          <TouchableOpacity
            style={styles.customTimeClear}
            onPress={() => setCustomTime(null)}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Text style={styles.customTimeClearText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.startsAtSummary}>
        Starts{' '}
        <Text style={styles.startsAtSummaryValue}>
          {new Date(effectiveStartTime).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </Text>
      {/* BUG-16, second half: "the picker exposes only a date control;
          there is no visible way to set the time."

          True on iOS. The two-step flow (date picker -> onChange ->
          time picker) only reaches step two once the DATE picker has
          fired a change, and iOS renders these inline as bare compact
          buttons with no label, no framing and no confirm -- so a
          half-finished custom time looked like a stray pill sitting under
          the preset chips rather than a control mid-use.

          iOS has a single `datetime` mode that puts both wheels in one
          control; use it, inside a framed panel with an explicit Done, so
          the whole choice is visible and dismissible in one place. Android
          has no datetime mode, so it keeps the sequential date-then-time
          flow its users already expect from the platform pickers. */}
      {Platform.OS === 'ios'
        ? showDatePicker && (
            <View style={styles.pickerPanel}>
              <View style={styles.pickerPanelHeader}>
                <Text style={styles.pickerPanelTitle}>Pick a date and time</Text>
                <TouchableOpacity
                  onPress={() => {
                    setCustomTime(customPickerDraft.toISOString());
                    setShowDatePicker(false);
                  }}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <Text style={styles.pickerPanelDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={customPickerDraft}
                mode="datetime"
                display="spinner"
                themeVariant="dark"
                minimumDate={new Date()}
                maximumDate={new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)}
                onChange={(_e: DateTimePickerEvent, d?: Date) => {
                  if (!d) return;
                  setCustomPickerDraft(d);
                  // Reflect the scroll immediately in the summary line so
                  // the value in play is never ambiguous.
                  setCustomTime(d.toISOString());
                }}
              />
            </View>
          )
        : (
          <>
            {showDatePicker && (
              <DateTimePicker
                value={customPickerDraft}
                mode="date"
                minimumDate={new Date()}
                maximumDate={new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)}
                onChange={(e: DateTimePickerEvent, d?: Date) => {
                  setShowDatePicker(false);
                  if (e.type === 'dismissed' || !d) return;
                  const merged = new Date(customPickerDraft);
                  merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                  setCustomPickerDraft(merged);
                  setShowTimePicker(true);
                }}
              />
            )}
            {showTimePicker && (
              <DateTimePicker
                value={customPickerDraft}
                mode="time"
                onChange={(e: DateTimePickerEvent, d?: Date) => {
                  setShowTimePicker(false);
                  if (e.type === 'dismissed' || !d) return;
                  const merged = new Date(customPickerDraft);
                  merged.setHours(d.getHours(), d.getMinutes(), 0, 0);
                  setCustomPickerDraft(merged);
                  setCustomTime(merged.toISOString());
                }}
              />
            )}
          </>
        )}

      {/* Visibility */}
      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Visibility</Text>
      <View style={styles.visibilityRow}>
        <TouchableOpacity
          style={[styles.visibilityOption, visibility === 'public' && styles.visibilityOptionActive]}
          onPress={() => setVisibility('public')}
        >
          <Globe size={20} color={visibility === 'public' ? '#fff' : C.textSecondary} />
          <View style={styles.visibilityTextWrap}>
            <Text style={[styles.visibilityLabel, visibility === 'public' && styles.visibilityLabelActive]}>
              Public
            </Text>
            <Text style={styles.visibilityDesc}>Visible to all fans</Text>
          </View>
        </TouchableOpacity>
        {/* v9.5: Private parties are the Home Team benefit — the guest list
            is the thing a private host actually wants (who is coming, who is
            a maybe, who dropped), and migration 089 returns the full roster
            only for private parties. Creating a PUBLIC party stays open to
            everyone: mig 070's rule was that the paywall must not block
            creating a watch party, and it still doesn't. Only this one
            toggle is gated, and it opens the sheet rather than dead-ending.
            Server-side, watch_parties_insert enforces the same condition, so
            a client that skips this still cannot write a private row. */}
        <PaywallGate require="home_team">
          <TouchableOpacity
            style={[styles.visibilityOption, visibility === 'private' && styles.visibilityOptionActive]}
            onPress={() => setVisibility('private')}
          >
            <Lock size={20} color={visibility === 'private' ? '#fff' : C.textSecondary} />
            <View style={styles.visibilityTextWrap}>
              <Text style={[styles.visibilityLabel, visibility === 'private' && styles.visibilityLabelActive]}>
                Private
              </Text>
              <Text style={styles.visibilityDesc}>Invite only · see who's coming</Text>
            </View>
          </TouchableOpacity>
        </PaywallGate>
      </View>

      {/* Invite Friends (shown when private) */}
      {visibility === 'private' && (
        <View style={styles.inviteSection}>
          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Invite Friends</Text>

          <TouchableOpacity style={styles.contactsCta} onPress={openContactPicker}>
            <Users size={20} color="#fff" />
            <Text style={styles.contactsCtaText}>Add from Contacts</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.manualToggle}
            onPress={() => setShowManualInvite((v) => !v)}
          >
            <Text style={styles.manualToggleText}>
              {showManualInvite ? 'Hide manual entry' : 'Enter manually'}
            </Text>
          </TouchableOpacity>

          {showManualInvite && (
            <View style={styles.addFriendRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Name"
                placeholderTextColor={C.textMuted}
                value={friendName}
                onChangeText={setFriendName}
              />
              <TextInput
                style={[styles.input, { flex: 1, marginLeft: 8 }]}
                placeholder="Phone number"
                placeholderTextColor={C.textMuted}
                value={friendPhone}
                onChangeText={setFriendPhone}
                keyboardType="phone-pad"
              />
              <TouchableOpacity
                style={[
                  styles.addFriendBtn,
                  (!friendName.trim() || !friendPhone.trim()) && { opacity: 0.4 },
                ]}
                disabled={!friendName.trim() || !friendPhone.trim()}
                onPress={() => {
                  addContactToInvites(friendName.trim(), friendPhone.trim());
                  setFriendName('');
                  setFriendPhone('');
                }}
              >
                <UserPlus size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Invited list */}
          {invitedFriends.length > 0 && (
            <View style={styles.invitedList}>
              {invitedFriends.map((f, i) => (
                <View key={i} style={styles.invitedChip}>
                  <View style={styles.invitedAvatar}>
                    <Text style={styles.invitedInitial}>
                      {f.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.invitedName}>{f.name}</Text>
                    <Text style={styles.invitedPhone}>{f.phone}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      setInvitedFriends((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    <X size={18} color={C.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {invitedFriends.length === 0 && (
            <Text style={styles.inviteHint}>
              Pick friends from your contacts — or tap "Enter manually" to type a name and number.
            </Text>
          )}
        </View>
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  );

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------
  return (
    <KeyboardAvoidingView
      style={styles.container}
      // v9.2.5 UAT 2026-07-28: on Android, softwareKeyboardLayoutMode="resize"
      // (app.json) already shrinks the window to fit above the keyboard, so
      // KAV must be a no-op (behavior=undefined). Prior behavior="height"
      // double-adjusted and reintroduced the Description field + Create
      // button being covered by the keyboard on Step 3. iOS still needs
      // behavior="padding" — no native resize there.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header
          v9.4.0 UAT Round 3 (#7): top back-arrow used to `router.back()`
          from every step, exiting the whole wizard and dropping the
          user's in-progress form. The bottom "Back" button stepped
          within the wizard, so users hit the top arrow expecting the
          same behavior and lost their work. Now the header arrow
          mirrors the bottom Back on steps 2/3 and only exits on step 1. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (step > 1 ? setStep((step - 1) as 1 | 2 | 3) : router.back())}
          style={styles.backBtn}
        >
          <Text style={styles.backArrow}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Watch Party</Text>
        <StepIndicator />
      </View>

      {/* Step content */}
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}

      {/* Bottom button */}
      <View style={[styles.bottomBar, { paddingBottom: 12 + insets.bottom }]}>
        {step === 1 && (
          <TouchableOpacity
            style={[styles.primaryBtn, !isStep1Valid && styles.primaryBtnDisabled]}
            disabled={!isStep1Valid}
            onPress={() => setStep(2)}
          >
            <Text style={styles.primaryBtnText}>Next</Text>
          </TouchableOpacity>
        )}
        {step === 2 && (
          <View style={styles.bottomRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setStep(1)}
            >
              <Text style={styles.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1, marginLeft: 12 }]}
              onPress={goToStep3}
            >
              <Text style={styles.primaryBtnText}>
                {selectedGame || noGame ? 'Next' : 'Skip'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {step === 3 && (
          <View style={styles.bottomRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setStep(2)}
            >
              <Text style={styles.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1, marginLeft: 12 }]}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Create Watch Party</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Contact picker modal */}
      <Modal
        visible={contactPickerOpen}
        animationType="slide"
        onRequestClose={() => setContactPickerOpen(false)}
        transparent={false}
      >
        <View style={styles.contactModal}>
          <View style={styles.contactModalHeader}>
            <Text style={styles.contactModalTitle}>Pick a contact</Text>
            <TouchableOpacity onPress={() => setContactPickerOpen(false)}>
              <X size={22} color={C.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.contactSearchRow}>
            <Search size={18} color={C.textMuted} />
            <TextInput
              style={styles.contactSearchInput}
              placeholder="Search contacts"
              placeholderTextColor={C.textMuted}
              value={contactSearch}
              onChangeText={setContactSearch}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          {contactsLoading ? (
            <View style={styles.contactsCenter}>
              <ActivityIndicator color={C.text} />
            </View>
          ) : (
            <FlatList
              data={contactsList.filter((c) =>
                (c.name || '').toLowerCase().includes(contactSearch.toLowerCase())
              )}
              keyExtractor={(item, idx) => `${item.name}-${idx}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.contactRow}
                  onPress={() => handlePickContact(item)}
                >
                  <View style={styles.contactAvatar}>
                    <Text style={styles.contactInitial}>
                      {(item.name || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.contactPhone}>
                      {item.phoneNumbers?.[0]?.number}
                      {(item.phoneNumbers?.length || 0) > 1 &&
                        ` · ${item.phoneNumbers!.length} numbers`}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.contactsCenter}>
                  <Text style={styles.contactEmpty}>No contacts with phone numbers.</Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.background,
  },
  backBtn: {
    padding: 8,
    marginRight: 8,
  },
  backArrow: {
    color: C.text,
    fontSize: 22,
  },
  headerTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    borderRadius: 50,
  },
  dotActive: {
    width: 10,
    height: 10,
    backgroundColor: C.accent,
  },
  dotInactive: {
    width: 7,
    height: 7,
    backgroundColor: '#555555',
  },

  // Step content
  stepContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  stepTitle: {
    color: C.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
  },
  fieldLabel: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // GPS opt-in
  locationRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  locationCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: C.accent + '14',
    borderWidth: 1,
    borderColor: C.accent + '55',
  },
  locationCtaText: {
    color: C.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  locationActivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: C.success + '18',
    borderWidth: 1,
    borderColor: C.success + '55',
  },
  locationActiveText: {
    color: C.success,
    fontSize: 13,
    fontWeight: '600',
  },
  distanceHint: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 8,
    paddingHorizontal: 2,
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchBtn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    marginLeft: 10,
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },

  // Venue card
  venueCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  venueCardSelected: {
    borderColor: C.accent,
  },
  venueCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  venueName: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  venueTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
  },
  venueTypeBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  venueAddress: {
    color: C.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  venueDistance: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  manualLink: {
    color: C.accent,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 16,
  },
  searchErrorBox: {
    backgroundColor: '#3a1f1f',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#7a3030',
  },
  searchErrorText: {
    color: '#ffb4b4',
    fontSize: 13,
    lineHeight: 18,
  },
  addressDropdown: {
    backgroundColor: C.surface,
    borderRadius: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.accent + '40',
    overflow: 'hidden',
  },
  addressItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.background + '80',
  },
  addressItemText: {
    color: C.text,
    fontSize: 14,
    lineHeight: 20,
  },

  // Inputs
  pickerPanel: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    overflow: 'hidden',
  },
  pickerPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pickerPanelTitle: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  pickerPanelDone: {
    color: C.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  customTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  customTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  customTimeClear: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  customTimeClearText: {
    color: C.textSecondary,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  startsAtSummary: {
    marginTop: 10,
    color: C.textSecondary,
    fontSize: 13,
  },
  startsAtSummaryValue: {
    color: C.text,
    fontWeight: '600',
  },
  venueHintBox: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  venueHintText: {
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  input: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
  },
  titleInput: {
    minHeight: 46,
    maxHeight: 88,
    lineHeight: 20,
  },
  textarea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },

  // Filter pills
  filterRow: {
    flexDirection: 'row',
    marginBottom: 16,
    maxHeight: 40,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterPillActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  filterPillText: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#fff',
  },

  // Game card
  gameCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  gameCardSelected: {
    borderColor: C.accent,
  },
  dayHeader: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  showMoreBtn: {
    paddingVertical: 8,
    marginBottom: 6,
    alignItems: 'center',
  },
  showMoreText: {
    color: C.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  noGameText: {
    color: C.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  gameTeams: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  gameMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gameTime: {
    color: C.textSecondary,
    fontSize: 12,
  },
  gameLeague: {
    color: C.textMuted,
    fontSize: 12,
  },

  // Atmosphere
  atmosphereRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  atmospherePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  atmospherePillActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  atmospherePillText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
  },

  // Capacity
  capacityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  capacityBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  capacityBtnText: {
    color: C.text,
    fontSize: 22,
    fontWeight: '700',
  },
  capacityInput: {
    width: 70,
    textAlign: 'center',
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
  },

  // Time chips
  timeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  timeChipActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  timeChipText: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  timeChipTextActive: {
    color: '#fff',
  },

  // Visibility
  visibilityRow: {
    flexDirection: 'row',
    gap: 12,
  },
  visibilityOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  visibilityOptionActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  visibilityTextWrap: {
    flex: 1,
  },
  visibilityLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textSecondary,
  },
  visibilityLabelActive: {
    color: '#fff',
  },
  visibilityDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },

  // Invite friends
  inviteSection: {},
  addFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  addFriendBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  invitedList: {
    marginTop: 12,
    gap: 8,
  },
  invitedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  invitedAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitedInitial: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  invitedName: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
  },
  invitedPhone: {
    color: C.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
  inviteHint: {
    color: C.textMuted,
    fontSize: 13,
    marginTop: 10,
    lineHeight: 18,
  },
  contactsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.accent,
    paddingVertical: 14,
    borderRadius: 12,
  },
  contactsCtaText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  manualToggle: {
    alignSelf: 'center',
    paddingVertical: 10,
  },
  manualToggleText: {
    color: C.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  contactModal: {
    flex: 1,
    backgroundColor: C.background,
  },
  contactModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  contactModalTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
  },
  contactSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  contactSearchInput: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  contactInitial: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
  },
  contactName: {
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
  },
  contactPhone: {
    color: C.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  contactsCenter: {
    padding: 32,
    alignItems: 'center',
  },
  contactEmpty: {
    color: C.textMuted,
    fontSize: 14,
  },

  // Bottom bar — paddingBottom set dynamically via insets.bottom at the JSX site
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryBtn: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryBtnText: {
    color: C.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
