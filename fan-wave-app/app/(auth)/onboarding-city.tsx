import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MapPin, Search, Check } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

const POPULAR_CITIES = [
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
  'Seattle',
];

interface NominatimResult {
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
}

export default function OnboardingCityScreen() {
  const router = useRouter();
  const { selectedSports } = useLocalSearchParams<{ selectedSports: string }>();
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reverseGeocodeViaNominatim = useCallback(
    async (latitude: number, longitude: number): Promise<string | null> => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
          { headers: { 'User-Agent': 'FanSphere/1.0' } }
        );
        const data = await res.json();
        const city =
          data.address?.city || data.address?.town || data.address?.village;
        const state = data.address?.state || '';
        if (!city) return null;
        return state ? `${city}, ${state}` : city;
      } catch {
        return null;
      }
    },
    []
  );

  const handleDetectLocation = useCallback(async () => {
    setDetecting(true);
    setDetected(false);
    setLocationError(null);

    if (Platform.OS !== 'web') {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocationError(
            'Location permission denied. Search for your city below.'
          );
          setDetecting(false);
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude, longitude } = position.coords;

        // Primary: on-device reverse geocode (offline, no rate limits).
        let resolvedCity: string | null = null;
        try {
          const results = await Location.reverseGeocodeAsync({
            latitude,
            longitude,
          });
          if (results && results.length > 0) {
            const first = results[0];
            const cityName = first.city || first.subregion || first.district;
            const region = first.region || '';
            if (cityName) {
              resolvedCity = region ? `${cityName}, ${region}` : cityName;
            }
          }
        } catch {
          // Fall through to Nominatim fallback.
        }

        // Fallback: HTTP reverse geocode via Nominatim.
        if (!resolvedCity) {
          resolvedCity = await reverseGeocodeViaNominatim(latitude, longitude);
        }

        if (resolvedCity) {
          setSelectedCity(resolvedCity);
          setDetected(true);
        } else {
          setLocationError(
            "Couldn't determine your city. Search for your city below."
          );
        }
      } catch {
        setLocationError(
          "Couldn't determine your city. Search for your city below."
        );
      } finally {
        setDetecting(false);
      }
      return;
    }

    // Web path
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const resolvedCity = await reverseGeocodeViaNominatim(
            pos.coords.latitude,
            pos.coords.longitude
          );
          if (resolvedCity) {
            setSelectedCity(resolvedCity);
            setDetected(true);
          } else {
            setLocationError(
              "Couldn't determine your city. Search for your city below."
            );
          }
          setDetecting(false);
        },
        () => {
          setLocationError(
            'Location permission denied. Search for your city below.'
          );
          setDetecting(false);
        }
      );
    } else {
      setLocationError(
        'Location not available. Search for your city below.'
      );
      setDetecting(false);
    }
  }, [reverseGeocodeViaNominatim]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const encoded = encodeURIComponent(query.trim());
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=5&addressdetails=1&countrycodes=us,ca,mx`,
          {
            headers: { 'User-Agent': 'FanSphere/1.0' },
          }
        );
        const data: NominatimResult[] = await res.json();

        const cities = data.map((item) => {
          const addr = item.address;
          const cityName =
            addr?.city || addr?.town || addr?.village || query;
          const region = addr?.state || '';
          const country = addr?.country_code?.toUpperCase() || '';
          if (region && country && country !== 'US') {
            return `${cityName}, ${region}, ${country}`;
          }
          if (region) {
            return `${cityName}, ${region}`;
          }
          return cityName;
        });

        // Deduplicate
        setSearchResults([...new Set(cities)]);
      } catch {
        setSearchResults([]);
      }
    }, 500);
  }, []);

  const handleFinish = useCallback(async () => {
    if (!selectedCity) return;
    await AsyncStorage.setItem('user_city', selectedCity);
    if (selectedSports) {
      await AsyncStorage.setItem(
        'selected_sports',
        JSON.stringify(selectedSports.split(','))
      );
    }
    await AsyncStorage.setItem('onboarding_complete', 'true');

    // Persist to Supabase profile so onboarding state survives device wipes.
    // onboarded_at column is added by migration 020; if it isn't applied yet
    // we retry without it so home_city still gets saved.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('users')
          .update({ home_city: selectedCity, onboarded_at: now })
          .eq('auth_id', user.id);
        if (error) {
          await supabase
            .from('users')
            .update({ home_city: selectedCity })
            .eq('auth_id', user.id);
        }
      }
    } catch {
      // Network/Supabase failure — AsyncStorage cache still unblocks this session
    }

    // expo-router's typed-routes generator hasn't picked up the new file
    // yet; once `expo start` regenerates .expo/types/router.d.ts the cast
    // becomes a no-op. Without it, tsc rejects the literal.
    router.replace('/(auth)/onboarding-suggested-groups' as any);
  }, [selectedCity, selectedSports, router]);

  return (
    <SafeAreaView style={styles.container}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Text style={styles.title}>Where are you based?</Text>
      <Text style={styles.subtitle}>
        We'll show you local watch parties and groups
      </Text>

      {/* Auto-detect card */}
      <TouchableOpacity
        style={styles.detectCard}
        onPress={handleDetectLocation}
        activeOpacity={0.7}
        disabled={detecting}
      >
        {detecting ? (
          <ActivityIndicator color={Colors.dark.accent} size="small" />
        ) : detected ? (
          <Check size={20} color={Colors.dark.success} />
        ) : (
          <MapPin size={20} color={Colors.dark.accent} />
        )}
        <View style={styles.detectTextWrap}>
          {detected ? (
            <>
              <Text style={styles.detectCity}>{selectedCity}</Text>
              <Text style={styles.detectLabel}>Detected from location</Text>
            </>
          ) : (
            <Text style={styles.detectText}>Detect my location</Text>
          )}
        </View>
        {detected && <Check size={18} color={Colors.dark.success} />}
      </TouchableOpacity>

      {locationError && (
        <Text style={styles.locationError}>{locationError}</Text>
      )}

      {/* Search input */}
      <View style={styles.searchWrap}>
        <Search
          size={18}
          color={Colors.dark.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search for a city..."
          placeholderTextColor={Colors.dark.textMuted}
          value={searchQuery}
          onChangeText={handleSearch}
          autoCorrect={false}
        />
      </View>

      {/* Search results */}
      {searchResults.length > 0 && (
        <View style={styles.resultsContainer}>
          {searchResults.map((city) => (
            <TouchableOpacity
              key={city}
              style={[
                styles.resultItem,
                selectedCity === city && styles.resultItemSelected,
              ]}
              onPress={() => {
                setSelectedCity(city);
                setSearchResults([]);
                setSearchQuery('');
                setDetected(false);
              }}
            >
              <MapPin size={16} color={Colors.dark.accent} />
              <Text style={styles.resultText}>{city}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Selected city display */}
      {selectedCity && searchResults.length === 0 && (
        <View style={styles.selectedContainer}>
          <Check size={20} color={Colors.dark.success} />
          <Text style={styles.selectedText}>{selectedCity}</Text>
        </View>
      )}

      {/* Popular cities */}
      <Text style={styles.sectionLabel}>Popular cities</Text>
      <View style={styles.pillsWrap}>
        {POPULAR_CITIES.map((city) => (
          <TouchableOpacity
            key={city}
            style={[
              styles.pill,
              selectedCity === city && styles.pillSelected,
            ]}
            onPress={() => {
              setSelectedCity(city);
              setDetected(false);
              setSearchResults([]);
              setSearchQuery('');
            }}
          >
            <Text
              style={[
                styles.pillText,
                selectedCity === city && styles.pillTextSelected,
              ]}
            >
              {city}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bottom button */}
      <TouchableOpacity
        style={[styles.button, !selectedCity && styles.buttonDisabled]}
        onPress={handleFinish}
        disabled={!selectedCity}
        activeOpacity={0.8}
      >
        <Text
          style={[styles.buttonText, !selectedCity && styles.buttonTextDisabled]}
        >
          Let's Go!
        </Text>
      </TouchableOpacity>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  content: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 28,
  },

  // Detect card
  detectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginBottom: 20,
    gap: 12,
  },
  detectTextWrap: {
    flex: 1,
  },
  detectText: {
    fontSize: 15,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  detectCity: {
    fontSize: 15,
    color: Colors.dark.text,
    fontWeight: '700',
  },
  detectLabel: {
    fontSize: 12,
    color: Colors.dark.success,
    marginTop: 2,
  },
  locationError: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: -12,
    marginBottom: 16,
    paddingHorizontal: 4,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 48,
    color: Colors.dark.text,
    fontSize: 15,
  },

  // Results
  resultsContainer: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  resultItemSelected: {
    backgroundColor: Colors.dark.surfaceLight,
  },
  resultText: {
    fontSize: 14,
    color: Colors.dark.text,
    flex: 1,
  },

  // Selected city
  selectedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.dark.success,
  },
  selectedText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
  },

  // Popular cities
  sectionLabel: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 12,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  pillSelected: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  pillText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: Colors.dark.text,
  },

  // Button
  button: {
    backgroundColor: Colors.dark.accent,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  buttonTextDisabled: {
    color: Colors.dark.textMuted,
  },
});
