import React from 'react';
import { FlatList, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';

interface FilterPillRowProps {
  items: string[];
  activeItem: string;
  onSelect: (item: string) => void;
  accentColor?: string;
}

export function FilterPillRow({ items, activeItem, onSelect, accentColor = Colors.dark.accent }: FilterPillRowProps) {
  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={items}
      keyExtractor={(item) => item}
      contentContainerStyle={styles.row}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[
            styles.pill,
            activeItem === item && [styles.pillActive, { backgroundColor: accentColor, borderColor: accentColor }],
          ]}
          onPress={() => onSelect(item)}
        >
          <Text style={[styles.pillText, activeItem === item && styles.pillTextActive]}>
            {item}
          </Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  pill: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: '#3a3a5a',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  pillActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  pillText: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '600',
    lineHeight: 20,
  },
  pillTextActive: {
    color: '#ffffff',
  },
});
