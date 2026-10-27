import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// Historical event links may still reach this component. Never offer a
// purchase for an event that has ended; keep existing entitlements intact.
export function WCPassPaywall({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>This event has ended</Text>
          <Text style={styles.body}>
            Event passes are no longer sold. Find current games in Game Day.
            You can restore previous purchases from Profile → Subscription.
          </Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: Colors.dark.surface, borderRadius: 16, padding: 24 },
  title: { color: Colors.dark.text, fontSize: 22, fontWeight: '700', marginBottom: 12 },
  body: { color: Colors.dark.textSecondary, fontSize: 16, lineHeight: 24 },
  button: { backgroundColor: Colors.dark.accent, padding: 14, borderRadius: 10, marginTop: 20 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
});
