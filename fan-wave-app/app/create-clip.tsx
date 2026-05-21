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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { SPORTS } from '@/constants/Sports';
import { getMomentTypesForSport, type MomentType } from '@/constants/MomentTypes';
import { PaywallGate } from '@/components/paywall/PaywallGate';
import { uploadClip, validateClip, UploadValidationError } from '@/lib/storage';

const C = Colors.dark;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 300;

export default function CreateClipScreen() {
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const { videoUri, durationMs } = useLocalSearchParams<{
    videoUri: string;
    durationMs?: string;
  }>();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posting, setPosting] = useState(false);
  // Mirrors the Post-a-Moment picker so clips get the same sport +
  // moment-type tagging. Defaults to NFL — users can change before posting.
  // Both are optional on the DB side (media_clips.sport_id / moment_type
  // are NULLable), so existing clip posts continue to work unchanged.
  const [sportId, setSportId] = useState<string>('nfl');
  const [selectedMoment, setSelectedMoment] = useState<MomentType | null>(null);
  const momentTypes = getMomentTypesForSport(sportId);

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

    // Client-side pre-upload validation (FW-100). Reject oversized /
    // overlong clips before any bandwidth is spent.
    try {
      const durationSec = durationMs ? Number(durationMs) / 1000 : undefined;
      await validateClip(videoUri, { durationSec });
    } catch (e) {
      if (e instanceof UploadValidationError) {
        Alert.alert('Clip too large', e.message);
        return;
      }
      // Unknown validation error — let the server reject.
    }

    setPosting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in again.');
        setPosting(false);
        return;
      }

      // Rate limiter (FW-102): 5 clips per hour per user.
      const { data: allowed } = await supabase.rpc('check_rate_limit', {
        p_user_id: user.id,
        p_action: 'clip_post',
        p_max_count: 5,
        p_window_seconds: 3600,
      });
      if (allowed === false) {
        Alert.alert('Slow down', "You're posting clips quickly. Try again in a few minutes.");
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
      const contentType = ext === 'mp4' ? 'video/mp4' : `video/${ext}`;
      const { publicUrl } = await uploadClip(videoUri, {
        contentType,
        subpath: `${Date.now()}.${ext}`,
      });

      const durationSeconds = durationMs
        ? Math.round(Number(durationMs) / 1000)
        : null;

      const { error: insertError } = await supabase.from('media_clips').insert({
        user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        media_url: publicUrl,
        media_type: 'video',
        duration_seconds: durationSeconds,
        sport_id: sportId,
        moment_type: selectedMoment?.id ?? null,
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
      <View style={{ flex: 1, marginBottom: keyboardHeight }}>
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

          <Text style={[styles.label, { marginTop: 16 }]}>Sport</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sportRow}
          >
            {SPORTS.map((s) => {
              const active = s.id === sportId;
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.sportPill, active && { borderColor: s.color, backgroundColor: s.color + '22' }]}
                  onPress={() => {
                    setSportId(s.id);
                    setSelectedMoment(null);
                  }}
                >
                  <Text style={styles.sportPillEmoji}>{s.icon}</Text>
                  <Text style={[styles.sportPillLabel, active && { color: s.color }]}>{s.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[styles.label, { marginTop: 16 }]}>Moment Type (optional)</Text>
          <View style={styles.momentGrid}>
            {momentTypes.map((m) => {
              const active = selectedMoment?.id === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.momentChip, active && { borderColor: m.color, backgroundColor: m.color + '22' }]}
                  onPress={() => setSelectedMoment(active ? null : m)}
                >
                  <Text style={styles.momentChipEmoji}>{m.emoji}</Text>
                  <Text style={[styles.momentChipLabel, active && { color: m.color }]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>Caption</Text>
          <TextInput
            style={styles.input}
            placeholder="What's the highlight?"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={(t) => setTitle(t.slice(0, MAX_TITLE))}
            maxLength={MAX_TITLE}
          />
          <Text style={styles.counter}>{title.length}/{MAX_TITLE}</Text>

          <Text style={[styles.label, { marginTop: 16 }]}>Comment (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="What just happened?"
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
          <PaywallGate require="premium">
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
          </PaywallGate>
        </View>
      </View>
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
  sportRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  sportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  sportPillEmoji: { fontSize: 16 },
  sportPillLabel: { fontSize: 13, color: C.text, fontWeight: '600' },
  momentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  momentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  momentChipEmoji: { fontSize: 16 },
  momentChipLabel: { fontSize: 13, color: C.text, fontWeight: '600' },
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
