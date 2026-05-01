import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Users, Tent, UsersRound, Video, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { GeoBreadcrumb } from '@/components/GeoBreadcrumb';
import {
  useGeoCountries, useGeoStates, useGeoCities, useGeoCityDetail,
} from '@/hooks/useAdminData';

type GeoRow = {
  label: string;
  user_count: number;
  party_count: number;
  group_count: number;
  clip_count?: number;
};

function StatChip({ icon, value }: { icon: React.ReactNode; value: number }) {
  return (
    <View style={styles.chip}>
      {icon}
      <Text style={styles.chipText}>{value.toLocaleString()}</Text>
    </View>
  );
}

function GeoTableRow({ item, onPress }: { item: GeoRow; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tableRow} onPress={onPress}>
      <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
      <View style={styles.chipRow}>
        <StatChip icon={<Users size={11} color={Colors.dark.accent} />} value={item.user_count} />
        <StatChip icon={<Tent size={11} color="#ff8c00" />} value={item.party_count} />
        <StatChip icon={<UsersRound size={11} color={Colors.dark.accentLight} />} value={item.group_count} />
        {item.clip_count !== undefined && (
          <StatChip icon={<Video size={11} color={Colors.dark.success} />} value={item.clip_count} />
        )}
      </View>
      <ChevronRight size={16} color={Colors.dark.textMuted} />
    </TouchableOpacity>
  );
}

function CityDetail({ city, state, country }: { city: string; state: string; country: string }) {
  const { data, isLoading } = useGeoCityDetail(city, state, country);

  if (isLoading) return <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />;
  if (!data) return <Text style={styles.empty}>No data for this city.</Text>;

  return (
    <FlatList
      data={[]}
      renderItem={null}
      keyExtractor={() => ''}
      ListHeaderComponent={
        <View>
          <View style={styles.kpiStrip}>
            <StatChip icon={<Users size={14} color={Colors.dark.accent} />} value={data.kpis.user_count} />
            <StatChip icon={<Tent size={14} color="#ff8c00" />} value={data.kpis.party_count} />
            <StatChip icon={<UsersRound size={14} color={Colors.dark.accentLight} />} value={data.kpis.group_count} />
            <StatChip icon={<Video size={14} color={Colors.dark.success} />} value={data.kpis.clip_count} />
          </View>

          {data.recent_parties.length > 0 && (
            <View style={styles.detailSection}>
              <Text style={styles.detailTitle}>Recent Parties (30d)</Text>
              {data.recent_parties.map((p) => (
                <View key={p.id} style={styles.detailRow}>
                  <Tent size={14} color="#ff8c00" />
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
              <Text style={styles.detailTitle}>Active Groups</Text>
              {data.active_groups.map((g) => (
                <View key={g.id} style={styles.detailRow}>
                  <UsersRound size={14} color={Colors.dark.accentLight} />
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
              <Text style={styles.detailTitle}>Recent Signups (7d)</Text>
              {data.recent_signups.map((u) => (
                <View key={u.id} style={styles.detailRow}>
                  <Users size={14} color={Colors.dark.accent} />
                  <Text style={styles.detailName}>{u.display_name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      }
    />
  );
}

export default function AdminGeography() {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  const { data: countries, isLoading: cLoading } = useGeoCountries();
  const { data: states, isLoading: sLoading } = useGeoStates(selectedCountry);
  const { data: cities, isLoading: cityLoading } = useGeoCities(selectedCountry, selectedState);

  const resetToAll = () => {
    setSelectedCountry(null);
    setSelectedState(null);
    setSelectedCity(null);
  };
  const resetToCountry = () => {
    setSelectedState(null);
    setSelectedCity(null);
  };
  const resetToState = () => {
    setSelectedCity(null);
  };

  const isLoading = cLoading || sLoading || cityLoading;

  const currentLevel: 'countries' | 'states' | 'cities' | 'city' =
    selectedCity ? 'city'
    : selectedState ? 'cities'
    : selectedCountry ? 'states'
    : 'countries';

  const rows: GeoRow[] =
    currentLevel === 'countries'
      ? (countries ?? []).map((r) => ({ label: r.country, ...r }))
      : currentLevel === 'states'
      ? (states ?? []).map((r) => ({ label: r.state, ...r }))
      : currentLevel === 'cities'
      ? (cities ?? []).map((r) => ({ label: r.city, ...r }))
      : [];

  const onRowPress = (row: GeoRow) => {
    if (currentLevel === 'countries') setSelectedCountry(row.label);
    else if (currentLevel === 'states') setSelectedState(row.label);
    else if (currentLevel === 'cities') setSelectedCity(row.label);
  };

  const levelTitle: Record<typeof currentLevel, string> = {
    countries: 'Countries',
    states: `States in ${selectedCountry}`,
    cities: `Cities in ${selectedState}`,
    city: selectedCity ?? '',
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
            <View style={styles.legend}>
              <StatChip icon={<Users size={11} color={Colors.dark.accent} />} value={0} />
              <Text style={styles.legendText}>Users</Text>
              <StatChip icon={<Tent size={11} color="#ff8c00" />} value={0} />
              <Text style={styles.legendText}>Parties</Text>
              <StatChip icon={<UsersRound size={11} color={Colors.dark.accentLight} />} value={0} />
              <Text style={styles.legendText}>Groups</Text>
            </View>
          </View>

          {isLoading ? (
            <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.label}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <GeoTableRow item={item} onPress={() => onRowPress(item)} />
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>No data available at this level.</Text>
              }
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  loader: { marginTop: 40 },
  levelHeader: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  levelTitle: { fontSize: 15, fontWeight: '700', color: Colors.dark.text },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 10, color: Colors.dark.textMuted, marginRight: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 6 },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    padding: 14, gap: 10,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6,
  },
  chipText: { fontSize: 11, fontWeight: '700', color: Colors.dark.text },
  kpiStrip: {
    flexDirection: 'row', gap: 10, padding: 16,
    flexWrap: 'wrap',
  },
  detailSection: { paddingHorizontal: 16, paddingBottom: 16 },
  detailTitle: { fontSize: 14, fontWeight: '700', color: Colors.dark.text, marginBottom: 8 },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  detailInfo: { flex: 1 },
  detailName: { fontSize: 13, fontWeight: '600', color: Colors.dark.text },
  detailSub: { fontSize: 11, color: Colors.dark.textSecondary, marginTop: 2 },
  empty: { color: Colors.dark.textMuted, fontSize: 14, textAlign: 'center', marginTop: 40 },
});
