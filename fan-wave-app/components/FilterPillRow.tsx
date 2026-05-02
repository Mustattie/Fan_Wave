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
      style={styles.list}
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
  list: {
    flexGrow: 0,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: '#3a3a5a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  pillText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
  },
});
