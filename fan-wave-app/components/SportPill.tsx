import React from 'react';
import { Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Colors } from '@/constants/Colors';

interface Pill {
  id: string;
  label: string;
}

interface SportPillRowProps {
  pills: Pill[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function SportPillRow({ pills, activeId, onSelect }: SportPillRowProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scrollContainer}
    >
      {pills.map((pill) => (
        <TouchableOpacity
          key={pill.id}
          style={[styles.pill, activeId === pill.id && styles.pillActive]}
          onPress={() => onSelect(pill.id)}
        >
          <Text
            style={[
              styles.pillText,
              activeId === pill.id && styles.pillTextActive,
            ]}
          >
            {pill.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    flexShrink: 0,
  },
  pillActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  pillTextActive: {
    color: '#fff',
  },
});
