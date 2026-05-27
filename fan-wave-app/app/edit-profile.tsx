import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

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
        .select('display_name, bio, home_city, avatar_url')
        .eq('auth_id', user.id)
        .single();

      if (data) {
        setDisplayName(data.display_name || '');
        setBio(data.bio || '');
        setHomeCity(data.home_city || '');
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

    try {
      const ext = newAvatarUri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${userId}/avatar.${ext}`;

      const response = await fetch(newAvatarUri);
      const blob = await response.blob();

      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: `image/${ext}` });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      return urlData.publicUrl;
    } catch {
      return avatarUrl; // Keep existing on failure
    }
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

      const { error } = await supabase
        .from('users')
        .update({
          display_name: displayName.trim(),
          bio: bio.trim(),
          home_city: homeCity.trim() || null,
          ...(uploadedUrl ? { avatar_url: uploadedUrl } : {}),
        })
        .eq('auth_id', user.id);

      if (error) throw error;

      Alert.alert('Saved', 'Your profile has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const displayAvatar = newAvatarUri || avatarUrl;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
