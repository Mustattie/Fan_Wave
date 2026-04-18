import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';
import { TierPicker } from '@/components/TierPicker';
import { FollowTier, TIER_BY_ID, TIER_ORDER } from '@/constants/FollowTiers';

interface TierUpsellSheetProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: (newTier: FollowTier) => void;
  teamName: string;
  currentTier: FollowTier;
  targetContent: string;
}

export function TierUpsellSheet({
  visible,
  onClose,
  onUpgrade,
  teamName,
  currentTier,
  targetContent,
}: TierUpsellSheetProps) {
  const [selectedTier, setSelectedTier] = useState<FollowTier>(currentTier);
  const currentDef = TIER_BY_ID[currentTier];
  const canUpgrade = TIER_ORDER[selectedTier] > TIER_ORDER[currentTier];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>
            {currentDef.icon} Upgrade your {teamName} follow
          </Text>
          <Text style={styles.body}>
            You're following {teamName} as{' '}
            <Text style={{ color: currentDef.color, fontWeight: '700' }}>
              {currentDef.label}
            </Text>
            .{'\n'}Upgrade to see {targetContent} in your feed.
          </Text>
          <TierPicker selectedTier={selectedTier} onSelect={setSelectedTier} />
          <TouchableOpacity
            style={[styles.upgradeBtn, !canUpgrade && { opacity: 0.4 }]}
            disabled={!canUpgrade}
            onPress={() => {
              onUpgrade(selectedTier);
              onClose();
            }}
          >
            <Text style={styles.upgradeBtnText}>
              {canUpgrade
                ? `Upgrade to ${TIER_BY_ID[selectedTier].label}`
                : 'Select a higher tier'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.dismiss}>
            <Text style={styles.dismissText}>Not Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.dark.tabBar,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  upgradeBtn: {
    marginTop: 20,
    backgroundColor: Colors.dark.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  upgradeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  dismiss: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  dismissText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
});
