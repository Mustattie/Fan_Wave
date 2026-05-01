import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/Colors';
import { TrendingUp, TrendingDown } from 'lucide-react-native';

interface AdminKpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  delta?: number;
  deltaLabel?: string;
  onPress?: () => void;
}

export function AdminKpiCard({ icon, label, value, delta, deltaLabel, onPress }: AdminKpiCardProps) {
  const isPositive = delta === undefined || delta >= 0;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.iconRow}>
        {icon}
      </View>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Text style={styles.value}>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
      {delta !== undefined && (
        <View style={styles.deltaRow}>
          {isPositive
            ? <TrendingUp size={12} color={Colors.dark.success} />
            : <TrendingDown size={12} color={Colors.dark.error} />
          }
          <Text style={[styles.delta, { color: isPositive ? Colors.dark.success : Colors.dark.error }]}>
            {isPositive ? '+' : ''}{delta} {deltaLabel ?? ''}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    minWidth: 120,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  iconRow: {
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontWeight: '500',
    marginBottom: 4,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  delta: {
    fontSize: 12,
    fontWeight: '600',
  },
});
