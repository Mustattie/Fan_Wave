import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, AlertTriangle, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';
import { KeyboardAwareScreen } from '@/components/KeyboardAwareScreen';

const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDelete = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
      await supabase.auth.signOut();
      Alert.alert(
        'Account deleted',
        'Your Fan Sphere account and personal data have been removed.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/welcome' as any) }],
      );
    } catch (e) {
      reportError(e, { source: 'DeleteAccountScreen:handleDelete' });
      Alert.alert(
        'Could not delete account',
        'Something went wrong. Please try again, or email support@thabtech.com if it keeps failing.',
      );
      setDeleting(false);
    }
  };

  return (
    <KeyboardAwareScreen
      style={styles.container}
      contentContainerStyle={styles.scroll}
      header={
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} disabled={deleting} style={styles.backBtn}>
            <ChevronLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delete Account</Text>
          <View style={styles.backBtn} />
        </View>
      }
    >
        <View style={styles.iconWrap}>
          <AlertTriangle size={40} color={Colors.dark.error} />
        </View>

        <Text style={styles.title}>This will permanently delete your account</Text>

        <Text style={styles.body}>
          Deleting your Fan Sphere account is immediate and cannot be undone. Here's
          what happens when you confirm:
        </Text>

        <View style={styles.bulletList}>
          <Text style={styles.bullet}>• Your profile, display name, and login are removed</Text>
          <Text style={styles.bullet}>• Your posts, clips, comments, and watch-party RSVPs are deleted</Text>
          <Text style={styles.bullet}>• Your fan group memberships and team follows are removed</Text>
          <Text style={styles.bullet}>• Your subscription entitlements and purchase history are cleared</Text>
          <Text style={styles.bullet}>• You can never recover the account or sign back in with the same email</Text>
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>About your subscription</Text>
          <Text style={styles.calloutBody}>
            Deleting your Fan Sphere account does NOT cancel any active Premium or
            Soccer Cup Pass subscription billed by {STORE_NAME}. To stop future
            charges, cancel the subscription in your {STORE_NAME} account settings
            BEFORE deleting here.
          </Text>
        </View>

        <Text style={styles.confirmLabel}>
          Type <Text style={styles.confirmWord}>DELETE</Text> below to confirm:
        </Text>

        <TextInput
          style={styles.input}
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder="DELETE"
          placeholderTextColor={Colors.dark.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!deleting}
        />

        <TouchableOpacity
          style={[styles.dangerBtn, (!canDelete || deleting) && styles.dangerBtnDisabled]}
          onPress={handleDelete}
          disabled={!canDelete || deleting}
          activeOpacity={0.8}
        >
          {deleting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Trash2 size={18} color="#fff" />
              <Text style={styles.dangerBtnText}>Permanently Delete My Account</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => router.back()}
          disabled={deleting}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.dark.text },
  scroll: { padding: 20, paddingBottom: 40 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.dark.error + '22',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginVertical: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: { fontSize: 14, color: Colors.dark.textSecondary, lineHeight: 20, marginBottom: 16 },
  bulletList: { marginBottom: 20 },
  bullet: { fontSize: 13, color: Colors.dark.text, lineHeight: 22 },
  callout: {
    backgroundColor: Colors.dark.surface,
    borderLeftWidth: 3,
    borderLeftColor: Colors.dark.accentGreen,
    padding: 14,
    borderRadius: 8,
    marginBottom: 24,
  },
  calloutTitle: { fontSize: 13, fontWeight: '700', color: Colors.dark.text, marginBottom: 6 },
  calloutBody: { fontSize: 12, lineHeight: 18, color: Colors.dark.textSecondary },
  confirmLabel: { fontSize: 14, color: Colors.dark.text, marginBottom: 8 },
  confirmWord: { fontWeight: '800', color: Colors.dark.error },
  input: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.dark.text,
    marginBottom: 20,
  },
  dangerBtn: {
    backgroundColor: Colors.dark.error,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  dangerBtnDisabled: { opacity: 0.4 },
  dangerBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: Colors.dark.textSecondary, fontWeight: '600' },
});
