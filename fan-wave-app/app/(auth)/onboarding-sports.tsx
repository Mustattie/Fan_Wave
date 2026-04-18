import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { SPORTS } from '@/constants/Sports';
import { Colors } from '@/constants/Colors';

type SportItem = (typeof SPORTS)[number];

export default function OnboardingSportsScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSport = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleContinue = () => {
    router.push({
      pathname: '/(auth)/onboarding-teams',
      params: { selectedSports: Array.from(selected).join(',') },
    });
  };

  const renderItem = ({ item }: { item: SportItem }) => {
    const isSelected = selected.has(item.id);
    return (
      <TouchableOpacity
        style={[
          styles.card,
          isSelected && styles.cardSelected,
        ]}
        activeOpacity={0.7}
        onPress={() => toggleSport(item.id)}
      >
        <Text style={styles.emoji}>{item.icon}</Text>
        <Text style={styles.sportName}>{item.name}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() && router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>What sports do you follow?</Text>
        <Text style={styles.subtitle}>
          Pick your favorites to personalize your feed
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
          {selected.size} selected
        </Text>
        <TouchableOpacity
          style={[
            styles.button,
            selected.size === 0 && styles.buttonDisabled,
          ]}
          activeOpacity={0.8}
          disabled={selected.size === 0}
          onPress={handleContinue}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  backBtn: {
    alignSelf: 'flex-start',
    padding: 4,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 24,
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
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  card: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  cardSelected: {
    backgroundColor: 'rgba(108, 92, 231, 0.2)',
    borderColor: Colors.dark.accent,
    borderWidth: 2,
    transform: [{ scale: 1.04 }],
  },
  emoji: {
    fontSize: 36,
    marginBottom: 6,
  },
  sportName: {
    fontSize: 12,
    color: Colors.dark.text,
    textAlign: 'center',
  },
  bottom: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
  },
  countText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: Colors.dark.accent,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
});
