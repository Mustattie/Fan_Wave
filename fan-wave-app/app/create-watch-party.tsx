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
  Platform,
  FlatList,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Globe, Lock, UserPlus, X, Users, Search } from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import { Colors } from '@/constants/Colors';
import { SPORTS } from '@/constants/Sports';
import { searchVenues, geocodeCity, searchAddress, Venue, AddressSuggestion } from '@/lib/venueSearchApi';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mapGameToDisplay, type GameDisplay } from '@/lib/mappers';
import { PremiumPaywall } from '@/components/paywall/PremiumPaywall';

const C = Colors.dark;

// Default Chicago coordinates (used as initial fallback)
const DEFAULT_LAT = 41.8781;
const DEFAULT_LON = -87.6298;

const SPORT_FILTERS = [
  { id: 'all', name: 'All' },
  ...SPORTS.filter((s) => ['nfl', 'nba', 'mls', 'mlb', 'nhl'].includes(s.id)),
];

type Atmosphere = 'chill' | 'moderate' | 'loud' | 'rowdy';

const ATMOSPHERES: { key: Atmosphere; label: string; emoji: string }[] = [
  { key: 'chill', label: 'Chill', emoji: '😌' },
  { key: 'moderate', label: 'Moderate', emoji: '🙂' },
  { key: 'loud', label: 'Loud', emoji: '🔊' },
  { key: 'rowdy', label: 'Rowdy', emoji: '🤪' },
];

function computeTimePresets(): { label: string; value: string }[] {
  const today = new Date();

  const makeDate = (dayOffset: number, hours: number): string => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hours, 0, 0, 0);
    return d.toISOString();
  };

  // "This Weekend" = next Saturday at 3 PM
  const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;

  return [
    { label: 'Tonight 7PM', value: makeDate(0, 19) },
    { label: 'Tonight 8PM', value: makeDate(0, 20) },
    { label: 'Tomorrow 7PM', value: makeDate(1, 19) },
    { label: 'Tomorrow 8PM', value: makeDate(1, 20) },
    { label: 'This Weekend', value: makeDate(daysUntilSaturday, 15) },
  ];
}

const TIME_PRESETS = computeTimePresets();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Soccer Cup 2026 event + Soccer sport IDs (seeded in migration 006). When the
// Soccer Cup tab pushes to /create-watch-party?event=soccer-cup-2026, we
// stamp the resulting watch_parties row with these so the filtered list on
// that tab can actually find it.
// Soccer Cup 2026 event UUID — must match the seeded row in events.
// Centralised in constants/WorldCupIds so all surfaces stay aligned.
import { WC_EVENT_ID as SOCCER_CUP_EVENT_ID } from '@/constants/WorldCupIds';
const SOCCER_SPORT_ID = 'a0000000-0000-0000-0000-000000000004';

export default function CreateWatchPartyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event: eventParam } = useLocalSearchParams<{ event?: string }>();
  const isSoccerCupContext = eventParam === 'soccer-cup-2026';
  const [step, setStep] = useState(1);
  const [showPremiumPaywall, setShowPremiumPaywall] = useState(false);

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
  const [selectedTime, setSelectedTime] = useState(TIME_PRESETS[0].value);
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

  // Geo coordinates for venue search (loaded from user city)
  const [searchLat, setSearchLat] = useState(DEFAULT_LAT);
  const [searchLon, setSearchLon] = useState(DEFAULT_LON);
  const [userCity, setUserCity] = useState<string | null>(null);

  // Load user's city from AsyncStorage and geocode to lat/lon
  useEffect(() => {
    (async () => {
      try {
        const storedCity = await AsyncStorage.getItem('user_city');
        if (storedCity) {
          setUserCity(storedCity);
          const geo = await geocodeCity(storedCity);
          if (geo) {
            setSearchLat(geo.lat);
            setSearchLon(geo.lon);
          }
        }
      } catch {
        // Keep default Chicago coordinates
      }
    })();
  }, []);

  // Load upcoming games from Supabase
  useEffect(() => {
    (async () => {
      setGamesLoading(true);
      try {
        const { data, error } = await supabase
          .from('games')
          .select('*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)')
          .gt('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(20);

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
  // -----------------------------------------------------------------------
  const handleVenueSearch = useCallback(async () => {
    if (!venueQuery.trim()) return;
    setVenueLoading(true);
    try {
      // Pass the query directly to Overpass — it filters server-side on
      // name and uses a 30 km radius around the user's city. The previous
      // "first-15 random venues" fallback was killed because it was the
      // root cause of the "out-of-state results" bug from the live v5 test.
      const results = await searchVenues(searchLat, searchLon, venueQuery, 30000);
      setVenueResults(results);
    } catch {
      setVenueResults([]);
    } finally {
      setVenueLoading(false);
    }
  }, [venueQuery, searchLat, searchLon]);

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

  // Auto-generate title when entering step 3
  const goToStep3 = () => {
    let autoTitle = '';
    if (selectedGame) {
      autoTitle = `${selectedGame.homeTeam.name} vs ${selectedGame.awayTeam.name} Watch Party`;
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

    const venueName = manualEntry ? manualName.trim() : selectedVenue?.name ?? '';
    const venueAddress = manualEntry
      ? manualAddress.trim()
      : selectedVenue?.address ?? '';

    const localId = `wp-${Date.now()}`;

    const partyData: Record<string, any> = {
      title: title.trim() || 'Watch Party',
      description: description.trim(),
      venue_name: venueName,
      venue_address: venueAddress,
      venue_city: userCity || null,
      venue_lat: manualEntry ? (selectedManualCoords?.lat ?? DEFAULT_LAT) : (selectedVenue?.lat ?? DEFAULT_LAT),
      venue_lon: manualEntry ? (selectedManualCoords?.lon ?? DEFAULT_LON) : (selectedVenue?.lon ?? DEFAULT_LON),
      game_id: selectedGame?.id ?? null,
      atmosphere,
      capacity,
      starts_at: selectedTime,
      visibility: visibility === 'private' ? 'private' : 'public',
    };

    // When created from the Soccer Cup tab, stamp the event_id + sport_id so
    // the WCWatchParties tab's `.eq('event_id', SOCCER_CUP_EVENT_ID)` query
    // actually surfaces this party. Without this the row gets inserted with
    // event_id=null and disappears from the WC tab list (live Android v5 P0).
    if (isSoccerCupContext) {
      partyData.event_id = SOCCER_CUP_EVENT_ID;
      partyData.sport_id = SOCCER_SPORT_ID;
    }

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

      // Auto-RSVP as 'going'
      await supabase.from('watch_party_rsvps').insert({
        watch_party_id: partyRow.id,
        user_id: userId,
        status: 'going',
      });

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
      // 42501 = row-level security violation. Migration 053 still gates
      // watch_parties_insert behind Premium (or WC pass for WC parties).
      // Surface the upgrade modal rather than the generic error toast so
      // the user has a one-tap path to unblock themselves.
      const code: string | undefined = e?.code;
      const msg: string = (e?.message ?? '').toLowerCase();
      const isRlsBlock =
        code === '42501' ||
        msg.includes('row-level security') ||
        msg.includes('violates row-level security policy');
      if (isRlsBlock) {
        setShowPremiumPaywall(true);
      } else {
        Alert.alert('Error', 'Could not create watch party. Please try again.');
      }
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

      {/* Game list */}
      {gamesLoading && (
        <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} />
      )}
      {filteredGames.map((g) => {
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

      <View style={{ height: 100 }} />
    </ScrollView>
  );

  const renderStep3 = () => (
    <ScrollView style={styles.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Party details</Text>

      {/* Title */}
      <Text style={styles.fieldLabel}>Title</Text>
      <TextInput
        style={styles.input}
        placeholder="Watch Party Title"
        placeholderTextColor={C.textMuted}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
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

      {/* Start time */}
      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Start time</Text>
      <View style={styles.timeRow}>
        {TIME_PRESETS.map((t) => (
          <TouchableOpacity
            key={t.value}
            style={[
              styles.timeChip,
              selectedTime === t.value && styles.timeChipActive,
            ]}
            onPress={() => setSelectedTime(t.value)}
          >
            <Text
              style={[
                styles.timeChipText,
                selectedTime === t.value && styles.timeChipTextActive,
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
        <TouchableOpacity
          style={[styles.visibilityOption, visibility === 'private' && styles.visibilityOptionActive]}
          onPress={() => setVisibility('private')}
        >
          <Lock size={20} color={visibility === 'private' ? '#fff' : C.textSecondary} />
          <View style={styles.visibilityTextWrap}>
            <Text style={[styles.visibilityLabel, visibility === 'private' && styles.visibilityLabelActive]}>
              Private
            </Text>
            <Text style={styles.visibilityDesc}>Invite only</Text>
          </View>
        </TouchableOpacity>
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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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

      <PremiumPaywall
        visible={showPremiumPaywall}
        onClose={() => setShowPremiumPaywall(false)}
      />

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
