import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { markIntentionalSignOut } from '@/lib/authTelemetry';
import { clearRecoveryPending } from '@/lib/authRecovery';
import { reportError } from '@/lib/errorReporting';
import { KeyboardAwareScreen } from '@/components/KeyboardAwareScreen';

// Reached from the password-reset deep link. The recovery token is
// exchanged for a session by whichever link consumer runs first
// (lib/supabase.ts or app/auth-callback.tsx); both then mark recovery
// pending (lib/authRecovery.ts) and NavigationGuard holds the user here
// until the password is changed. The user must set a new password before
// doing anything else in the app; otherwise their existing (now-known-to-
// attacker) password remains active -- which is why backing out signs out
// rather than leaving the recovery session logged in.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (password.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        reportError(error, { source: 'reset-password:updateUser' });
        Alert.alert('Could not update', error.message);
        return;
      }
      // Recovery is complete; release the guard before the sign-out so
      // the next session (the user signing in with the new password) is
      // routed normally.
      clearRecoveryPending();
      Alert.alert('Password updated', 'You can now sign in with your new password.', [
        {
          text: 'OK',
          onPress: async () => {
            markIntentionalSignOut();
            await supabase.auth.signOut();
            router.replace('/(auth)/sign-in');
          },
        },
      ]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScreen style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity
        onPress={async () => {
          // Backing out abandons the recovery: end the session the link
          // created rather than leave it signed in with the old password.
          clearRecoveryPending();
          markIntentionalSignOut();
          try {
            await supabase.auth.signOut();
          } catch {
            /* the guard routes on the resulting state either way */
          }
          router.replace('/(auth)/sign-in');
        }}
        style={styles.backBtn}
      >
        <ArrowLeft size={24} color={Colors.dark.text} />
      </TouchableOpacity>

      <View style={styles.headerSection}>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>
          At least 8 characters. Use something you haven't used before.
        </Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Lock size={18} color={Colors.dark.textMuted} />
          <TextInput
            style={styles.input}
            placeholder="New password"
            placeholderTextColor={Colors.dark.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity onPress={() => setShow((s) => !s)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            {show ? <EyeOff size={18} color={Colors.dark.textMuted} /> : <Eye size={18} color={Colors.dark.textMuted} />}
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Lock size={18} color={Colors.dark.textMuted} />
          <TextInput
            style={styles.input}
            placeholder="Confirm new password"
            placeholderTextColor={Colors.dark.textMuted}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Update password</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  backBtn: { alignSelf: 'flex-start', padding: 4, marginBottom: 24 },
  headerSection: { marginBottom: 32 },
  title: { fontSize: 30, fontWeight: '900', color: Colors.dark.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: Colors.dark.textSecondary, marginTop: 6, lineHeight: 22 },
  form: { gap: 14 },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  input: { flex: 1, fontSize: 15, color: Colors.dark.text },
  saveButton: {
    backgroundColor: Colors.dark.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
