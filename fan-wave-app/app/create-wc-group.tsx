import React, { useState } from 'react';
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
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Users } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

const WC_CREATED_GROUPS_KEY = 'wc_created_groups';

const C = Colors.dark;
const GREEN = C.accentGreen;

const COUNTRIES = [
  { code: 'us', flag: '🇺🇸', name: 'USA' },
  { code: 'mx', flag: '🇲🇽', name: 'Mexico' },
  { code: 'ca', flag: '🇨🇦', name: 'Canada' },
  { code: 'br', flag: '🇧🇷', name: 'Brazil' },
  { code: 'ar', flag: '🇦🇷', name: 'Argentina' },
  { code: 'en', flag: '🏴', name: 'England' },
  { code: 'fr', flag: '🇫🇷', name: 'France' },
  { code: 'de', flag: '🇩🇪', name: 'Germany' },
  { code: 'es', flag: '🇪🇸', name: 'Spain' },
  { code: 'pt', flag: '🇵🇹', name: 'Portugal' },
  { code: 'nl', flag: '🇳🇱', name: 'Netherlands' },
  { code: 'jp', flag: '🇯🇵', name: 'Japan' },
  { code: 'kr', flag: '🇰🇷', name: 'South Korea' },
  { code: 'ng', flag: '🇳🇬', name: 'Nigeria' },
  { code: 'sn', flag: '🇸🇳', name: 'Senegal' },
];

const WC_CITIES = [
  'New York', 'Los Angeles', 'Dallas', 'Houston', 'Miami',
  'Chicago', 'Toronto', 'Mexico City', 'Seattle', 'Philadelphia',
  'San Francisco', 'Atlanta', 'Boston', 'Guadalajara', 'Monterrey',
];

export default function CreateWCGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ template: string }>();
  const template = params.template || 'team';

  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const getTemplateTitle = () => {
    switch (template) {
      case 'team': return 'Team Fan Group';
      case 'match': return 'Match Watch Group';
      case 'travel': return 'Travel Fan Group';
      case 'city': return 'City Hub Group';
      default: return 'WC Fan Group';
    }
  };

  const getTemplateIcon = () => {
    switch (template) {
      case 'team': return '🏴';
      case 'match': return '⚽';
      case 'travel': return '✈️';
      case 'city': return '🏙️';
      default: return '⚽';
    }
  };

  const generateDefaultName = () => {
    const country = COUNTRIES.find(c => c.code === selectedCountry);
    switch (template) {
      case 'team':
        return country ? `${country.name} Fans ${country.flag}` : '';
      case 'match':
        return '';
      case 'travel':
        return selectedCity ? `Traveling to ${selectedCity} ✈️` : '';
      case 'city':
        return selectedCity ? `${selectedCity} Soccer Cup Hub 🏙️` : '';
      default:
        return '';
    }
  };

  const isValid = groupName.trim().length >= 3;

  const saveGroupLocally = async (group: any) => {
    try {
      const raw = await AsyncStorage.getItem(WC_CREATED_GROUPS_KEY);
      const existing = raw ? JSON.parse(raw) : [];
      existing.push(group);
      await AsyncStorage.setItem(WC_CREATED_GROUPS_KEY, JSON.stringify(existing));
    } catch {
      // Silently fail
    }
  };

  const handleCreate = async () => {
    if (!isValid) return;
    setIsCreating(true);

    const tags = ['Soccer Cup'];
    if (selectedCountry) {
      const country = COUNTRIES.find(c => c.code === selectedCountry);
      if (country) tags.push(country.name);
    }
    if (selectedCity) tags.push(selectedCity);
    if (template === 'travel') tags.push('Travel');

    const groupData = {
      id: `wc-new-${Date.now()}`,
      name: groupName.trim(),
      description: description.trim() || `Soccer Cup 2026 ${getTemplateTitle()}`,
      icon: getTemplateIcon(),
      memberCount: 1,
      onlineCount: 1,
      tags,
      isPublic: true,
    };

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please sign in to create a group.');
        setIsCreating(false);
        return;
      }

      const { data, error } = await supabase
        .from('chat_rooms')
        .insert({
          name: groupData.name,
          description: groupData.description,
          group_type: 'worldcup',
          visibility: 'public',
          avatar_url: groupData.icon,
          tags,
          city: selectedCity || null,
          owner_id: user.id,
          member_count: 1,
        })
        .select()
        .single();

      if (error) {
        Alert.alert('Error', `Could not create group: ${error.message}`);
        setIsCreating(false);
        return;
      }

      if (data) {
        groupData.id = data.id;
      }
    } catch {
      Alert.alert('Error', 'Could not create group. Please check your connection.');
      setIsCreating(false);
      return;
    }

    await saveGroupLocally(groupData);

    setIsCreating(false);
    Alert.alert('Group Created!', `"${groupName}" has been created.`, [
      { text: 'View Group', onPress: () => router.replace(`/fan-group/${groupData.id}` as any) },
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  const showCountryPicker = template === 'team' || template === 'match';
  const showCityPicker = template === 'travel' || template === 'city';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create {getTemplateTitle()}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Template indicator */}
        <View style={styles.templateBanner}>
          <Text style={styles.templateIcon}>{getTemplateIcon()}</Text>
          <Text style={styles.templateLabel}>{getTemplateTitle()}</Text>
        </View>

        {/* Country picker */}
        {showCountryPicker && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Select Country</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {COUNTRIES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.chip, selectedCountry === c.code && styles.chipActive]}
                  onPress={() => {
                    setSelectedCountry(c.code);
                    if (!groupName || groupName === generateDefaultName()) {
                      const country = COUNTRIES.find(ct => ct.code === c.code);
                      if (country && template === 'team') {
                        setGroupName(`${country.name} Fans ${country.flag}`);
                      }
                    }
                  }}
                >
                  <Text style={styles.chipFlag}>{c.flag}</Text>
                  <Text style={[styles.chipText, selectedCountry === c.code && styles.chipTextActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* City picker */}
        {showCityPicker && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Select City</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {WC_CITIES.map((city) => (
                <TouchableOpacity
                  key={city}
                  style={[styles.chip, selectedCity === city && styles.chipActive]}
                  onPress={() => {
                    setSelectedCity(city);
                    if (!groupName) {
                      if (template === 'travel') setGroupName(`Traveling to ${city} ✈️`);
                      if (template === 'city') setGroupName(`${city} Soccer Cup Hub 🏙️`);
                    }
                  }}
                >
                  <Text style={[styles.chipText, selectedCity === city && styles.chipTextActive]}>
                    {city}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Group Name */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Group Name</Text>
          <TextInput
            style={styles.input}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Enter group name..."
            placeholderTextColor={C.textMuted}
            maxLength={50}
          />
          <Text style={styles.charCount}>{groupName.length}/50</Text>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="What's this group about?"
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
          <Text style={styles.charCount}>{description.length}/200</Text>
        </View>

        {/* Match-specific: second country */}
        {template === 'match' && selectedCountry && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Opponent Country</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {COUNTRIES.filter(c => c.code !== selectedCountry).map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={styles.chip}
                  onPress={() => {
                    const home = COUNTRIES.find(ct => ct.code === selectedCountry);
                    if (home) {
                      setGroupName(`${home.name} vs ${c.name} Watch ${home.flag}${c.flag}`);
                    }
                  }}
                >
                  <Text style={styles.chipFlag}>{c.flag}</Text>
                  <Text style={styles.chipText}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* Create Button — paddingBottom uses safe-area inset so the green
          button sits above the Android nav bar / iPhone home indicator. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.createButton, !isValid && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={!isValid || isCreating}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Users size={20} color="#fff" />
              <Text style={styles.createButtonText}>Create Group</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  templateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: `${GREEN}15`,
    borderWidth: 1,
    borderColor: `${GREEN}44`,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
  },
  templateIcon: {
    fontSize: 32,
  },
  templateLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: GREEN,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
    marginBottom: 10,
  },
  chipRow: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: '#3a3a5a',
    minHeight: 42,
  },
  chipActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  chipFlag: {
    fontSize: 18,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 18,
  },
  chipTextActive: {
    color: '#fff',
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: C.text,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: C.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    // paddingBottom set dynamically via useSafeAreaInsets().bottom in JSX
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GREEN,
    paddingVertical: 16,
    borderRadius: 14,
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
