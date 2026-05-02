import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Users, Tent, UsersRound, Video, ChevronRight, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { GeoBreadcrumb } from '@/components/GeoBreadcrumb';
import {
  useGeoCountries, useGeoStates, useGeoCities, useGeoCityDetail,
} from '@/hooks/useAdminData';

const FLAG_MAP: Record<string, string> = {
  'United States': '🇺🇸',
  'United Kingdom': '🇬🇧',
  'Brazil': '🇧🇷',
  'Germany': '🇩🇪',
  'Spain': '🇪🇸',
  'France': '🇫🇷',
  'Australia': '🇦🇺',
  'Japan': '🇯🇵',
  'Mexico': '🇲🇽',
  'Argentina': '🇦🇷',
  'Nigeria': '🇳🇬',
  'South Africa': '🇿🇦',
  'Canada': '🇨🇦',
  'Netherlands': '🇳🇱',
  'Portugal': '🇵🇹',
  'Italy': '🇮🇹',
};

type GeoRow = {
  label: string;
  user_count: number;
  party_count: number;
  group_count: number;
  clip_count?: number;
};

function StatPill({
  icon, value, color,
}: { icon: React.ReactNode; value: number; color: string }) {
  return (
    <View style={styles.pill}>
      {icon}
      <Text style={[styles.pillText, { color }]}>{value.toLocaleString()}</Text>
    </View>
  );
}

function ActivityBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const filled = Math.max(1, Math.round(pct * 100));
  return (
    <View style={styles.activityBarBg}>
      <View style={[styles.activityBarFill, { width: `${filled}%` }]} />
    </View>
  );
}

function CountryCard({
  item, onPress, maxActivity,
}: { item: GeoRow; onPress: () => void; maxActivity: number }) {
  const flag = FLAG_MAP[item.label] ?? '🌍';
  const activity = item.party_count + item.group_count;
  return (
    <TouchableOpacity style={styles.countryCard} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.countryCardTop}>
        <Text style={styles.flagEmoji}>{flag}</Text>
        <View style={styles.countryInfo}>
          <Text style={styles.countryName}>{item.label}</Text>
          <ActivityBar value={activity} max={maxActivity} />
        </View>
        <ChevronRight size={18} color={Colors.dark.textMuted} />
      </View>
      <View style={styles.statRow}>
        <StatPill
          icon={<Users size={12} color={Colors.dark.accent} />}
          value={item.user_count}
          color={Colors.dark.accent}
        />
        <Text style={styles.statLabel}>fans</Text>
        <StatPill
          icon={<Tent size={12} color="#ff8c00" />}
          value={item.party_count}
          color="#ff8c00"
        />
        <Text style={styles.statLabel}>parties</Text>
        <StatPill
          icon={<UsersRound size={12} color={Colors.dark.accentLight} />}
          value={item.group_count}
          color={Colors.dark.accentLight}
        />
        <Text style={styles.statLabel}>groups</Text>
      </View>
    </TouchableOpacity>
  );
}

function GeoTableRow({ item, onPress }: { item: GeoRow; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tableRow} onPress={onPress} activeOpacity={0.75}>
      <MapPin size={13} color={Colors.dark.textMuted} />
      <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
      <View style={styles.chipRow}>
        <StatPill
          icon={<Users size={11} color={Colors.dark.accent} />}
          value={item.user_count}
          color={Colors.dark.accent}
        />
        <StatPill
          icon={<Tent size={11} color="#ff8c00" />}
          value={item.party_count}
          color="#ff8c00"
        />
        <StatPill
          icon={<UsersRound size={11} color={Colors.dark.accentLight} />}
          value={item.group_count}
          color={Colors.dark.accentLight}
        />
        {item.clip_count !== undefined && (
          <StatPill
            icon={<Video size={11} color={Colors.dark.success} />}
            value={item.clip_count}
            color={Colors.dark.success}
          />
        )}
      </View>
      <ChevronRight size={14} color={Colors.dark.textMuted} />
    </TouchableOpacity>
  );
}

function CityDetail({
  city, state, country,
}: { city: string; state: string; country: string }) {
  const { data, isLoading } = useGeoCityDetail(city, state, country);
  const flag = FLAG_MAP[country] ?? '🌍';

  if (isLoading) return <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />;
  if (!data) return <Text style={styles.empty}>No data for this city.</Text>;

  return (
    <FlatList
      data={[]}
      renderItem={null}
      keyExtractor={() => ''}
      ListHeaderComponent={(
        <View>
          <View style={styles.cityHeader}>
            <Text style={styles.cityFlag}>{flag}</Text>
            <View>
              <Text style={styles.cityName}>{city}</Text>
              <Text style={styles.citySub}>{state} · {country}</Text>
            </View>
          </View>

          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <Users size={20} color={Colors.dark.accent} />
              <Text style={styles.kpiValue}>{data.kpis.user_count.toLocaleString()}</Text>
              <Text style={styles.kpiLabel}>Fans</Text>
            </View>
            <View style={styles.kpiCard}>
              <Tent size={20} color="#ff8c00" />
              <Text style={styles.kpiValue}>{data.kpis.party_count.toLocaleString()}</Text>
              <Text style={styles.kpiLabel}>Parties</Text>
            </View>
            <View style={styles.kpiCard}>
              <UsersRound size={20} color={Colors.dark.accentLight} />
              <Text style={styles.kpiValue}>{data.kpis.group_count.toLocaleString()}</Text>
              <Text style={styles.kpiLabel}>Groups</Text>
            </View>
            <View style={styles.kpiCard}>
              <Video size={20} color={Colors.dark.success} />
              <Text style={styles.kpiValue}>{data.kpis.clip_count.toLocaleString()}</Text>
              <Text style={styles.kpiLabel}>Clips</Text>
            </View>
          </View>

          {data.recent_parties.length > 0 && (
            <View style={styles.detailSection}>
              <View style={styles.sectionHead}>
                <Tent size={13} color="#ff8c00" />
                <Text style={styles.sectionTitle}>Recent Parties (30d)</Text>
              </View>
              {data.recent_parties.map((p) => (
                <View key={p.id} style={styles.detailRow}>
                  <View style={styles.detailInfo}>
                    <Text style={styles.detailName}>{p.title}</Text>
                    <Text style={styles.detailSub}>{p.venue_name} · {p.rsvp_count} RSVPs</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {data.active_groups.length > 0 && (
            <View style={styles.detailSection}>
              <View style={styles.sectionHead}>
                <UsersRound size={13} color={Colors.dark.accentLight} />
                <Text style={styles.sectionTitle}>Active Groups</Text>
              </View>
              {data.active_groups.map((g) => (
                <View key={g.id} style={styles.detailRow}>
                  <View style={styles.detailInfo}>
                    <Text style={styles.detailName}>{g.name}</Text>
                    <Text style={styles.detailSub}>{g.member_count} members</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {data.recent_signups.length > 0 && (
            <View style={styles.detailSection}>
              <View style={styles.sectionHead}>
                <Users size={13} color={Colors.dark.accent} />
                <Text style={styles.sectionTitle}>New Fans (7d)</Text>
              </View>
              {data.recent_signups.map((u) => (
                <View key={u.id} style={styles.detailRow}>
                  <Text style={styles.detailName}>{u.display_name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    />
  );
}

export default function AdminGeography() {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedState, setSelectedState]     = useState<string | null>(null);
  const [selectedCity,  setSelectedCity]      = useState<string | null>(null);

  const { data: countries, isLoading: cLoading } = useGeoCountries();
  const { data: states,    isLoading: sLoading } = useGeoStates(selectedCountry);
  const { data: cities,    isLoading: cityLoading } = useGeoCities(selectedCountry, selectedState);

  const resetToAll     = () => { setSelectedCountry(null); setSelectedState(null); setSelectedCity(null); };
  const resetToCountry = () => { setSelectedState(null); setSelectedCity(null); };
  const resetToState   = () => { setSelectedCity(null); };

  const isLoading = cLoading || sLoading || cityLoading;

  const currentLevel: 'countries' | 'states' | 'cities' | 'city' =
    selectedCity    ? 'city'
    : selectedState ? 'cities'
    : selectedCountry ? 'states'
    : 'countries';

  const rows: GeoRow[] =
    currentLevel === 'countries' ? (countries ?? []).map((r) => ({ label: r.country, ...r }))
    : currentLevel === 'states'  ? (states    ?? []).map((r) => ({ label: r.state,   ...r }))
    : currentLevel === 'cities'  ? (cities    ?? []).map((r) => ({ label: r.city,    ...r }))
    : [];

  const onRowPress = (row: GeoRow) => {
    if (currentLevel === 'countries') setSelectedCountry(row.label);
    else if (currentLevel === 'states') setSelectedState(row.label);
    else if (currentLevel === 'cities') setSelectedCity(row.label);
  };

  const maxActivity = rows.reduce((m, r) => Math.max(m, r.party_count + r.group_count), 1);

  const levelTitle: Record<typeof currentLevel, string> = {
    countries: 'Fan Nations',
    states:    `States · ${selectedCountry}`,
    cities:    `Cities · ${selectedState}`,
    city:       selectedCity ?? '',
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <GeoBreadcrumb
        country={selectedCountry}
        state={selectedState}
        city={selectedCity}
        onSelectAll={resetToAll}
        onSelectCountry={resetToCountry}
        onSelectState={resetToState}
      />

      {currentLevel === 'city' && selectedCity && selectedState && selectedCountry ? (
        <CityDetail city={selectedCity} state={selectedState} country={selectedCountry} />
      ) : (
        <>
          <View style={styles.levelHeader}>
            <Text style={styles.levelTitle}>{levelTitle[currentLevel]}</Text>
          </View>

          {isLoading ? (
            <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.label}
              contentContainerStyle={styles.list}
              renderItem={({ item }) =>
                currentLevel === 'countries' ? (
                  <CountryCard
                    item={item}
                    onPress={() => onRowPress(item)}
                    maxActivity={maxActivity}
                  />
                ) : (
                  <GeoTableRow item={item} onPress={() => onRowPress(item)} />
                )
              }
              ListEmptyComponent={(
                <View style={styles.emptyWrap}>
                  <MapPin size={40} color={Colors.dark.textMuted} />
                  <Text style={styles.empty}>No fan activity yet</Text>
                  <Text style={styles.emptySub}>
                    Geographic data appears as fans sign up and create parties in their cities
                  </Text>
                </View>
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.dark.background },
  loader:        { marginTop: 40 },

  // Level header
  levelHeader:   { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  levelTitle:    { fontSize: 16, fontWeight: '700', color: Colors.dark.text },

  // Country card
  countryCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  countryCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flagEmoji:      { fontSize: 28 },
  countryInfo:    { flex: 1, gap: 6 },
  countryName:    { fontSize: 15, fontWeight: '700', color: Colors.dark.text },
  activityBarBg: {
    height: 4, borderRadius: 2,
    backgroundColor: Colors.dark.border,
    overflow: 'hidden',
  },
  activityBarFill: {
    height: 4, borderRadius: 2,
    backgroundColor: Colors.dark.accent,
  },
  statRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel: { fontSize: 10, color: Colors.dark.textMuted, marginRight: 4 },

  // State / city rows
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    padding: 14, gap: 8,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  chipRow:  { flexDirection: 'row', gap: 5 },

  // Pill
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6,
  },
  pillText: { fontSize: 11, fontWeight: '700' },

  // List
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },

  // City detail
  cityHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, paddingBottom: 8 },
  cityFlag:   { fontSize: 32 },
  cityName:   { fontSize: 17, fontWeight: '700', color: Colors.dark.text },
  citySub:    { fontSize: 12, color: Colors.dark.textMuted, marginTop: 2 },
  kpiGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 10, paddingHorizontal: 16, paddingBottom: 16,
  },
  kpiCard: {
    flex: 1, minWidth: '40%',
    backgroundColor: Colors.dark.surface,
    borderRadius: 12, padding: 14,
    alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  kpiValue: { fontSize: 20, fontWeight: '800', color: Colors.dark.text },
  kpiLabel: { fontSize: 11, color: Colors.dark.textMuted },

  // Detail sections
  detailSection: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionHead:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionTitle:  { fontSize: 13, fontWeight: '700', color: Colors.dark.text },
  detailRow: {
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  detailInfo: { flex: 1 },
  detailName: { fontSize: 13, fontWeight: '600', color: Colors.dark.text },
  detailSub:  { fontSize: 11, color: Colors.dark.textSecondary, marginTop: 2 },

  // Empty state
  emptyWrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32, gap: 10 },
  empty:     { fontSize: 15, fontWeight: '600', color: Colors.dark.textMuted, textAlign: 'center' },
  emptySub:  { fontSize: 13, color: Colors.dark.textMuted, textAlign: 'center', lineHeight: 19 },
});
