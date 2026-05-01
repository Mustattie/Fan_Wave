import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';

interface GeoBreadcrumbProps {
  country: string | null;
  state: string | null;
  city: string | null;
  onSelectAll: () => void;
  onSelectCountry: () => void;
  onSelectState: () => void;
}

export function GeoBreadcrumb({ country, state, city, onSelectAll, onSelectCountry, onSelectState }: GeoBreadcrumbProps) {
  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={onSelectAll}>
        <Text style={[styles.crumb, !country && styles.crumbActive]}>All Countries</Text>
      </TouchableOpacity>

      {country && (
        <>
          <ChevronRight size={14} color={Colors.dark.textMuted} />
          <TouchableOpacity onPress={onSelectCountry}>
            <Text style={[styles.crumb, country && !state && styles.crumbActive]}>{country}</Text>
          </TouchableOpacity>
        </>
      )}

      {state && (
        <>
          <ChevronRight size={14} color={Colors.dark.textMuted} />
          <TouchableOpacity onPress={onSelectState}>
            <Text style={[styles.crumb, state && !city && styles.crumbActive]}>{state}</Text>
          </TouchableOpacity>
        </>
      )}

      {city && (
        <>
          <ChevronRight size={14} color={Colors.dark.textMuted} />
          <Text style={[styles.crumb, styles.crumbActive]}>{city}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  crumb: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontWeight: '500',
  },
  crumbActive: {
    color: Colors.dark.accent,
    fontWeight: '700',
  },
});
