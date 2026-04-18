import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';
import { FOLLOW_TIERS, FollowTier, TierDefinition } from '@/constants/FollowTiers';

interface TierPickerProps {
  selectedTier: FollowTier;
  onSelect: (tier: FollowTier) => void;
  compact?: boolean;
}

export function TierPicker({ selectedTier, onSelect, compact }: TierPickerProps) {
  if (compact) {
    return (
      <View style={styles.compactRow}>
        {FOLLOW_TIERS.map((tier) => {
          const isSelected = selectedTier === tier.id;
          return (
            <TouchableOpacity
              key={tier.id}
              style={[
                styles.compactPill,
                isSelected
                  ? { backgroundColor: tier.color, borderColor: tier.color }
                  : { backgroundColor: Colors.dark.surface, borderColor: Colors.dark.border },
                isSelected && { transform: [{ scale: 1.05 }] },
              ]}
              activeOpacity={0.7}
              onPress={() => onSelect(tier.id)}
            >
              <Text
                style={[
                  styles.compactText,
                  { color: isSelected ? '#ffffff' : Colors.dark.textSecondary },
                ]}
              >
                {tier.icon} {tier.shortLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.fullContainer}>
      {FOLLOW_TIERS.map((tier) => {
        const isSelected = selectedTier === tier.id;
        return (
          <TouchableOpacity
            key={tier.id}
            style={[
              styles.fullCard,
              isSelected
                ? {
                    backgroundColor: `${tier.color}18`,
                    borderColor: tier.color,
                    borderWidth: 2,
                    transform: [{ scale: 1.02 }],
                  }
                : {
                    backgroundColor: Colors.dark.surface,
                    borderColor: Colors.dark.border,
                    borderWidth: 1,
                  },
            ]}
            activeOpacity={0.7}
            onPress={() => onSelect(tier.id)}
          >
            <View style={styles.cardContent}>
              <View style={styles.cardLeft}>
                <View style={styles.cardHeader}>
                  <Text style={styles.tierIcon}>{tier.icon}</Text>
                  <Text style={styles.tierLabel}>{tier.label}</Text>
                </View>
                <Text style={styles.tierDesc}>{tier.description}</Text>
                <View style={styles.chipsRow}>
                  {tier.includesSummary.map((item) => (
                    <Text
                      key={item}
                      style={[
                        styles.chip,
                        isSelected ? { color: tier.color } : { color: Colors.dark.textMuted },
                      ]}
                    >
                      ✓ {item}
                    </Text>
                  ))}
                </View>
              </View>
              <View
                style={[
                  styles.checkCircle,
                  isSelected
                    ? { backgroundColor: tier.color, borderColor: tier.color }
                    : { backgroundColor: 'transparent', borderColor: Colors.dark.border },
                ]}
              >
                {isSelected && <Text style={styles.checkMark}>✓</Text>}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Full mode
  fullContainer: {
    gap: 10,
  },
  fullCard: {
    borderRadius: 14,
    padding: 14,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardLeft: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  tierIcon: {
    fontSize: 20,
  },
  tierLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  tierDesc: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 8,
    lineHeight: 16,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    fontSize: 11,
    fontWeight: '600',
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Compact mode
  compactRow: {
    flexDirection: 'row',
    gap: 8,
  },
  compactPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  compactText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
