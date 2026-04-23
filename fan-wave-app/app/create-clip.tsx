import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

const C = Colors.dark;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 300;

export default function CreateClipScreen() {
  const router = useRouter();
  const { videoUri, durationMs } = useLocalSearchParams<{
    videoUri: string;
    durationMs?: string;
  }>();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posting, setPosting] = useState(false);

  const player = useVideoPlayer(videoUri || null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (!videoUri) {
      Alert.alert('No video', 'Please pick a video first.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [videoUri, router]);

  const handlePost = async () => {
    if (!videoUri) return;
    if (!title.trim()) {
      Alert.alert('Title required', 'Please add a caption for your clip.');
      return;
    }

    setPosting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in again.');
        setPosting(false);
        return;
      }

      let { data: profile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', user.id)
        .maybeSingle();
      if (!profile) {
        const { data: created, error: createError } = await supabase
          .from('users')
          .insert({
            auth_id: user.id,
            display_name:
              user.user_metadata?.display_name ||
              user.email?.split('@')[0] ||
              'Fan',
          })
          .select('id')
          .single();
        if (createError) throw createError;
        profile = created;
      }
      const profileId = profile?.id;
      if (!profileId) throw new Error('Profile not found');

      const ext = (videoUri.split('.').pop() || 'mp4').toLowerCase();
      // Folder must be auth.uid() to satisfy the clips bucket RLS policy
      // (see migrations/021_clips_storage_bucket.sql). The media_clips row
      // still references the public.users.id (profileId).
      const path = `${user.id}/${Date.now()}.${ext}`;
      const contentType = ext === 'mp4' ? 'video/mp4' : `video/${ext}`;

      // Native binary upload via expo-file-system — avoids the broken
      // fetch(file://).blob() → supabase.storage.upload() path on Android RN,
      // which surfaces as a generic "Network request failed".
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error('Not signed in');

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const uploadResult = await uploadAsync(
        `${supabaseUrl}/storage/v1/object/clips/${path}`,
        videoUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': contentType,
            'x-upsert': 'false',
          },
        }
      );
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(
          `Upload failed (${uploadResult.status}): ${uploadResult.body}`
        );
      }

      const { data: urlData } = supabase.storage
        .from('clips')
        .getPublicUrl(path);

      const durationSeconds = durationMs
        ? Math.round(Number(durationMs) / 1000)
        : null;

      const { error: insertError } = await supabase.from('media_clips').insert({
        user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        media_url: urlData.publicUrl,
        media_type: 'video',
        duration_seconds: durationSeconds,
      });
      if (insertError) throw insertError;

      router.back();
    } catch (e: any) {
      Alert.alert(
        'Could not post clip',
        e?.message || 'Please check your connection and try again.'
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <X size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Clip</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {videoUri ? (
            <VideoView
              player={player}
              style={styles.videoPreview}
              contentFit="cover"
              allowsFullscreen={false}
              nativeControls={false}
            />
          ) : (
            <View style={[styles.videoPreview, styles.videoPlaceholder]}>
              <ActivityIndicator color={C.accent} />
            </View>
          )}

          <Text style={styles.label}>Caption</Text>
          <TextInput
            style={styles.input}
            placeholder="What's the highlight?"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={(t) => setTitle(t.slice(0, MAX_TITLE))}
            maxLength={MAX_TITLE}
          />
          <Text style={styles.counter}>{title.length}/{MAX_TITLE}</Text>

          <Text style={[styles.label, { marginTop: 16 }]}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Add context, tag teams, etc."
            placeholderTextColor={C.textMuted}
            value={description}
            onChangeText={(t) => setDescription(t.slice(0, MAX_DESCRIPTION))}
            maxLength={MAX_DESCRIPTION}
            multiline
          />
          <Text style={styles.counter}>
            {description.length}/{MAX_DESCRIPTION}
          </Text>
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.postBtn, (posting || !title.trim()) && styles.postBtnDisabled]}
            disabled={posting || !title.trim()}
            onPress={handlePost}
          >
            {posting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.postBtnText}>Post Clip</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  videoPreview: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 420,
    borderRadius: 14,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  counter: {
    color: C.textMuted,
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
  },
  postBtn: {
    backgroundColor: C.accent,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  postBtnDisabled: {
    opacity: 0.5,
  },
  postBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
