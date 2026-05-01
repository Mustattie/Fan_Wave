import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';

interface BarData {
  value: number;
  label: string;
}

interface AdminBarChartProps {
  data: BarData[];
  color?: string;
  height?: number;
  maxValue?: number;
  showValues?: boolean;
}

export function AdminBarChart({
  data,
  color = Colors.dark.accent,
  height = 120,
  maxValue,
  showValues = false,
}: AdminBarChartProps) {
  if (!data || data.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No data</Text>
      </View>
    );
  }

  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.chartArea, { height }]}>
        {data.map((item, idx) => {
          const pct = Math.max((item.value / max) * 100, 2);
          return (
            <View key={idx} style={styles.barCol}>
              {showValues && item.value > 0 && (
                <Text style={styles.barValue}>{item.value}</Text>
              )}
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: `${pct}%`, backgroundColor: color }]} />
              </View>
              <Text style={styles.barLabel} numberOfLines={1}>{item.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    paddingBottom: 20,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  barValue: {
    fontSize: 9,
    color: Colors.dark.textMuted,
    marginBottom: 2,
  },
  barTrack: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 4,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 9,
    color: Colors.dark.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: Colors.dark.textMuted,
    fontSize: 13,
  },
});
