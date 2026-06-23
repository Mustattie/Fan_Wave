import React, { useState, useEffect } from 'react';
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
import { ArrowLeft, Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { KeyboardAwareScreen } from '@/components/KeyboardAwareScreen';
import { reportError } from '@/lib/errorReporting';
import { queryClient } from '@/hooks/useQueryClient';

// v8.5 P0: parse "Dallas" or "Dallas, TX" or "Dallas, Texas" so the user
// can type either format. State is two-letter code uppercase when we can
// recognise it; otherwise stored as-typed and let geocoding figure it
// out. Returns null state when the input has no comma — the caller
// MUST treat that as "clear the previously-stored state" so a user who
// moves "Dallas, TX" → "Boston" doesn't end up geocoding "Boston, TX".
function parseCityState(input: string): { city: string; state: string | null } {
  const trimmed = (input || '').trim();
  if (!trimmed) return { city: '', state: null };
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { city: parts[0] || '', state: null };
  const city = parts[0];
  const rawState = parts[1];
  // Two-letter abbreviation already? Keep uppercase. Else pass through.
  const state =
    rawState.length === 2 ? rawState.toUpperCase() : rawState;
  return { city, state };
}

export default function EditProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [newAvatarUri, setNewAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('users')
        .select('display_name, bio, home_city, home_state, avatar_url')
        .eq('auth_id', user.id)
        .single();

      if (data) {
        setDisplayName(data.display_name || '');
        setBio(data.bio || '');
        // Present as "City, ST" when both present so the user sees what
        // they previously stored. They can edit either part.
        const cityShown = data.home_state
          ? `${data.home_city || ''}, ${data.home_state}`.replace(/^, /, '')
          : data.home_city || '';
        setHomeCity(cityShown);
        setAvatarUrl(data.avatar_url);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  };

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Allow Fan Sphere to access your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setNewAvatarUri(result.assets[0].uri);
    }
  };

  const uploadAvatar = async (userId: string): Promise<string | null> => {
    if (!newAvatarUri) return avatarUrl;

    // RN/Expo gotcha: `fetch(localUri).blob()` silently returns a 0-byte
    // blob on Android in many SDK versions, so the upload succeeds with
    // an empty file and the avatar appears blank or unchanged. The
    // reliable cross-platform pattern is to read the file as base64 via
    // expo-file-system, convert to a Uint8Array, and upload that.
    const ext = newAvatarUri.split('.').pop()?.toLowerCase() || 'jpg';
    const contentType =
      ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : 'image/jpeg';

    // v8.4 permanent fix: per-upload UNIQUE path so the resulting
    // public URL is genuinely different every save. expo-image's
    // URL-keyed cache then works naturally — no cache-bust query
    // string, no useFocusEffect refetch trick, no "stale avatar for
    // a minute after Save" symptom. Old files are cleaned up below.
    const uniqueId = Date.now().toString(36);
    const path = `${userId}/avatar-${uniqueId}.${ext}`;

    const base64 = await FileSystem.readAsStringAsync(newAvatarUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64 || base64.length === 0) {
      throw new Error('Selected image is empty or unreadable');
    }
    // atob is polyfilled in RN — turn base64 → binary string → byte array.
    const binary = global.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, bytes, { upsert: false, contentType });
    if (uploadError) throw uploadError;

    // Best-effort cleanup: remove any prior avatar-*.{ext} for this user
    // so storage doesn't grow unbounded across many edits. Failures here
    // are non-blocking — the new avatar still saves; orphaned files just
    // sit until the next save.
    try {
      const { data: existing } = await supabase.storage
        .from('avatars')
        .list(userId, { limit: 50 });
      const toDelete = (existing ?? [])
        .filter(
          (f) =>
            f.name.startsWith('avatar-') &&
            !path.endsWith('/' + f.name),
        )
        .map((f) => `${userId}/${f.name}`);
      if (toDelete.length > 0) {
        await supabase.storage.from('avatars').remove(toDelete);
      }
    } catch (e) {
      reportError(e, { source: 'edit-profile:uploadAvatar:cleanup' });
    }

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(path);
    // No cache-bust query string needed — the path itself is unique.
    return urlData.publicUrl;
  };

  const handleSave = async () => {
    if (!displayName.trim() || displayName.trim().length < 2) {
      Alert.alert('Invalid Name', 'Display name must be at least 2 characters.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const uploadedUrl = await uploadAvatar(user.id);

      // Parse city + state out of the single input so the geocoder gets
      // an unambiguous "Dallas, TX" instead of an ambiguous "Dallas".
      // No state in the input ⇒ explicitly NULL home_state so a move
      // from "Dallas, TX" → "Boston" doesn't leave "Boston, TX" stale.
      const parsed = parseCityState(homeCity);

      const { error } = await supabase
        .from('users')
        .update({
          display_name: displayName.trim(),
          bio: bio.trim(),
          home_city: parsed.city || null,
          home_state: parsed.state,
          ...(uploadedUrl ? { avatar_url: uploadedUrl } : {}),
        })
        .eq('auth_id', user.id);

      if (error) throw error;

      // v8.5 P0: keep AsyncStorage in sync so the venue-search center
      // cascade in create-watch-party.tsx hits the new value immediately
      // — without waiting for the next SIGNED_IN/INITIAL_SESSION event.
      if (parsed.city) {
        await AsyncStorage.setItem('user_city', parsed.city).catch(() => {});
      } else {
        await AsyncStorage.removeItem('user_city').catch(() => {});
      }
      if (parsed.state) {
        await AsyncStorage.setItem('user_state', parsed.state).catch(() => {});
      } else {
        await AsyncStorage.removeItem('user_state').catch(() => {});
      }

      // Reflect the new avatar locally so the user sees it without a
      // re-fetch on next focus.
      if (uploadedUrl && uploadedUrl !== avatarUrl) {
        setAvatarUrl(uploadedUrl);
        setNewAvatarUri(null);
      }

      // v8.6 P0: invalidate every cache slot keyed on the OLD city so the
      // user's next render of Home / Discover / My Groups picks up the
      // newly-saved home_city instead of holding the previous value for
      // up to 30s (staleTime). Without this, the user sees Discover header
      // and Watch-Parties-Near-You stuck on the old city after Save.
      queryClient.invalidateQueries({ queryKey: ['userCity'] });
      queryClient.invalidateQueries({ queryKey: ['watchParties'] });
      queryClient.invalidateQueries({ queryKey: ['watchPartiesInfinite'] });
      queryClient.invalidateQueries({ queryKey: ['myGroups'] });

      Alert.alert('Saved', 'Your profile has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      // Surface the real error instead of swallowing it — silent failure
      // was the original bug ("clicked Save but the image never shows").
      reportError(e, { source: 'edit-profile:handleSave' });
      Alert.alert(
        'Error',
        e?.message
          ? `Could not save profile: ${e.message}`
          : 'Could not save profile. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </View>
    );
  }

  const displayAvatar = newAvatarUri || avatarUrl;

  return (
    <KeyboardAwareScreen
      style={styles.container}
      contentContainerStyle={styles.content}
      header={
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Edit Profile</Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={styles.saveBtn}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.dark.accent} />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      }
    >
          {/* Avatar */}
          <TouchableOpacity style={styles.avatarContainer} onPress={pickAvatar}>
            {displayAvatar ? (
              <Image source={{ uri: displayAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarEmoji}>👤</Text>
              </View>
            )}
            <View style={styles.cameraOverlay}>
              <Camera size={16} color="#fff" />
            </View>
          </TouchableOpacity>

          {/* Fields */}
          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your display name"
            placeholderTextColor={Colors.dark.textMuted}
            maxLength={30}
          />

          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell fans about yourself..."
            placeholderTextColor={Colors.dark.textMuted}
            maxLength={160}
            multiline
          />
          <Text style={styles.charCount}>{bio.length}/160</Text>

          <Text style={styles.label}>Home City</Text>
          <TextInput
            style={styles.input}
            value={homeCity}
            onChangeText={setHomeCity}
            placeholder="e.g., Dallas, TX"
            placeholderTextColor={Colors.dark.textMuted}
          />
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.dark.text },
  saveBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: Colors.dark.accent },
  content: { padding: 24, alignItems: 'center' },
  avatarContainer: { marginBottom: 24, position: 'relative' },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.dark.surface },
  avatarPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.dark.surface, alignItems: 'center', justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 40 },
  cameraOverlay: {
    position: 'absolute', bottom: 0, right: 0,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.dark.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.dark.background,
  },
  label: {
    fontSize: 13, fontWeight: '600', color: Colors.dark.textSecondary,
    alignSelf: 'flex-start', marginBottom: 8, marginTop: 16,
  },
  input: {
    width: '100%', backgroundColor: Colors.dark.surface,
    borderRadius: 12, padding: 14, fontSize: 15, color: Colors.dark.text,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  charCount: {
    fontSize: 11, color: Colors.dark.textMuted, alignSelf: 'flex-end', marginTop: 4,
  },
});
