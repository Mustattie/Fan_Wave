// Post-onboarding sport-follow editor.
//
// v9.4.0 UAT Round 3 (#21): tapping "My Sports" in Profile used to route
// to /(auth)/onboarding-sports, which then hit its "if already onboarded,
// bounce to /(tabs)" guard (onboarding-sports.tsx:26-42) and dumped the
// user back on Home. UAT read that as "the button routes to Home."
//
// This screen is the persistent editor: same picker UI, no onboarding
// guard, saves to AsyncStorage 'selected_sports' immediately on toggle
// (matches how Home + Game Day read the source of truth). Also fires an
// invalidation on any react-query surface that reads the sport list.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { SPORTS } from '@/constants/Sports';
import { Colors } from '@/constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryClient } from '@/hooks/useQueryClient';

type SportItem = (typeof SPORTS)[number];

export default function MySportsScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Hydrate from AsyncStorage on mount. Home + Game Day already treat
  // this key as the source of truth for the interest filter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('selected_sports');
        const list: string[] = raw ? JSON.parse(raw) : [];
        if (!cancelled) setSelected(new Set(list.map((s) => s.toString().toLowerCase())));
      } catch {
        if (!cancelled) setSelected(new Set());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistSelection = useCallback(async (next: Set<string>) => {
    setSaving(true);
    try {
      await AsyncStorage.setItem('selected_sports', JSON.stringify([...next]));
      // Nudge any read side (Home Today's Games, Game Day filter) so the
      // new interest list is respected without a manual pull-to-refresh.
      queryClient.invalidateQueries({ queryKey: ['games'] });
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleSport = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        void persistSelection(next);
        return next;
      });
    },
    [persistSelection],
  );

  const renderItem = ({ item }: { item: SportItem }) => {
    const isSelected = selected.has(item.id);
    return (
      <TouchableOpacity
        style={[styles.card, isSelected && styles.cardSelected]}
        activeOpacity={0.7}
        onPress={() => toggleSport(item.id)}
      >
        <Text style={styles.emoji}>{item.icon}</Text>
        <Text style={styles.sportName}>{item.name}</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Sports</Text>
        <Text style={styles.subtitle}>
          Tap to add or remove. Your Home + Game Day feeds update instantly.
        </Text>
      </View>

      <FlatList
        data={SPORTS}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.bottom}>
        <Text style={styles.countText}>
          {selected.size} following {saving && ' · saving…'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backBtn: { alignSelf: 'flex-start', padding: 4, marginBottom: 8 },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: Colors.dark.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: Colors.dark.textSecondary },
  grid: { paddingHorizontal: 24 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: { borderColor: Colors.dark.accent, backgroundColor: Colors.dark.accent + '22' },
  emoji: { fontSize: 32, marginBottom: 4 },
  sportName: { color: Colors.dark.text, fontSize: 12, fontWeight: '500' },
  bottom: { padding: 24, alignItems: 'center' },
  countText: { color: Colors.dark.textSecondary, fontSize: 13 },
});
