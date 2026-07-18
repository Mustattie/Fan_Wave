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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { SPORTS } from '@/constants/Sports';
import { getMomentTypesForSport, type MomentType } from '@/constants/MomentTypes';
import { KeyboardAwareScreen } from '@/components/KeyboardAwareScreen';
import { validateClip, UploadValidationError } from '@/lib/storage';
import {
  enqueueClipUpload,
  generateTempId,
  activeUploadCount,
} from '@/lib/clipUploads';

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
  // Local override of the route-param videoUri so we can clear / replace
  // the attached clip in-place (e.g. after the "Clip too large" rejection)
  // without bouncing the user back to the feed first. Falls back to the
  // route param on initial mount.
  const [activeVideoUri, setActiveVideoUri] = useState<string | undefined>(
    videoUri,
  );
  const [activeDurationMs, setActiveDurationMs] = useState<string | undefined>(
    durationMs,
  );
  // Mirrors the Post-a-Moment picker so clips get the same sport +
  // moment-type tagging. Defaults to NFL — users can change before posting.
  // Both are optional on the DB side (media_clips.sport_id / moment_type
  // are NULLable), so existing clip posts continue to work unchanged.
  const [sportId, setSportId] = useState<string>('nfl');
  const [selectedMoment, setSelectedMoment] = useState<MomentType | null>(null);
  const momentTypes = getMomentTypesForSport(sportId);

  const player = useVideoPlayer(activeVideoUri || null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // If the user landed on Create Clip without first choosing a source
  // (any entry point that doesn't pre-pick a videoUri), prompt Record
  // / Choose from library immediately instead of showing the form + a
  // dead-end "No video" alert (v9.1 UAT: "User is suppose to have
  // option to take or upload existing video not this question").
  useEffect(() => {
    if (videoUri || activeVideoUri) return;
    Alert.alert(
      'New Clip',
      'Add a highlight to the feed.',
      [
        { text: 'Record new', onPress: reRecord },
        { text: 'Choose from library', onPress: rePickFromLibrary },
        { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
      ],
      { cancelable: true, onDismiss: () => router.back() },
    );
    // Only prompt on first mount when we truly start with no source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-record / re-pick helpers. Used by the "Clip too large" recovery
  // flow so the user is never stuck with a too-big file bound to the
  // screen with only an "OK" Alert button.
  const reRecord = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera permission denied',
        'Enable camera access in Settings to record clips.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 30,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const asset = result.assets[0];
      setActiveVideoUri(asset.uri);
      setActiveDurationMs(String(asset.duration ?? ''));
    }
  };

  const rePickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Library permission denied',
        'Enable photo library access in Settings to pick a clip.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const asset = result.assets[0];
      setActiveVideoUri(asset.uri);
      setActiveDurationMs(String(asset.duration ?? ''));
    }
  };

  const handlePost = async () => {
    if (!activeVideoUri) return;
    if (!title.trim()) {
      Alert.alert('Title required', 'Please add a caption for your clip.');
      return;
    }

    // Cap simultaneous uploads from this device. During live matches users
    // post bursts of clips; without this the next clip starves the first
    // and every clip "looks stuck" while contending for the cellular link.
    if (activeUploadCount() >= 2) {
      Alert.alert(
        'Hold on',
        "You've got a couple clips still uploading. Give them a second to finish and try again.",
      );
      return;
    }

    // Client-side pre-upload validation (FW-100). Reject oversized /
    // overlong clips before any bandwidth is spent.
    try {
      const durationSec = activeDurationMs ? Number(activeDurationMs) / 1000 : undefined;
      await validateClip(activeVideoUri, { durationSec });
    } catch (e) {
      if (e instanceof UploadValidationError) {
        // Don't strand the user with a single "OK" button — they're holding
        // a clip that can't be posted. Give them a clear escape path:
        // re-record from the camera, pick a different clip, or cancel out.
        // TODO(compression): once we ship expo-video-compressor we can add
        // an "Auto-compress" button here instead of forcing a re-record.
        Alert.alert(
          'Clip too large',
          `${e.message}\n\nRe-record a shorter clip or pick a smaller one from your library.`,
          [
            { text: 'Re-record', onPress: reRecord },
            { text: 'Pick another', onPress: rePickFromLibrary },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }
      // Unknown validation error — let the server reject.
    }

    // v8.7+ P0: Expo Go's bundled native modules don't reliably handle the
    // video upload path (expo-file-system createUploadTask on Android Hermes
    // + expo-video preview state). UAT 2026-06-23 reported a hard Hermes
    // crash on the SECOND clip post that ejected the user out of the app
    // and reset onboarding state — uncatchable from JS because the SIGABRT
    // originates in libmedia / native upload code. Block the post entirely
    // in Expo Go and tell the tester to use an EAS preview build.
    const inExpoGo =
      __DEV__ &&
      (Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
        (Constants as any).appOwnership === 'expo');
    if (inExpoGo) {
      Alert.alert(
        'Video posting — coming soon',
        'Clip uploads aren\'t available in this preview yet. It\'ll work in the next App Store / Play update.',
      );
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

      const ext = (activeVideoUri.split('.').pop() || 'mp4').toLowerCase();
      const contentType = ext === 'mp4' ? 'video/mp4' : `video/${ext}`;
      const durationSeconds = activeDurationMs
        ? Math.round(Number(activeDurationMs) / 1000)
        : null;

      // Enqueue the upload + insert in the background and bounce the user
      // back immediately. The Clips feed shows the placeholder card via
      // the upload-queue subscription. Lifecycle (queued → uploading →
      // inserting → success or failed) is emitted to listeners; the feed
      // swaps the placeholder for the real row on success or marks it
      // failed with a tap-to-retry overlay.
      enqueueClipUpload({
        tempId: generateTempId(),
        localUri: activeVideoUri,
        contentType,
        subpath: `${Date.now()}.${ext}`,
        title: title.trim(),
        description: description.trim(),
        sportId: sportId ?? '',
        momentType: selectedMoment?.id ?? null,
        durationSeconds,
        userId: user.id,
        profileId,
        displayName:
          user.user_metadata?.display_name ||
          user.email?.split('@')[0] ||
          'Fan',
        createdAt: new Date().toISOString(),
      });

      // The user is done from their POV. Clips feed will render the
      // optimistic placeholder; the upload runs in the background.
      router.back();
    } catch (e: any) {
      // v9.1 UAT pivot: posting a clip is a free-tier action. Migration
      // 070 drops the has_premium_access gate on media_clips_insert, so
      // this catch only fires on genuine errors.
      Alert.alert(
        'Could not post clip',
        e?.message || 'Please check your connection and try again.'
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <KeyboardAwareScreen
      style={styles.container}
      contentContainerStyle={styles.content}
      header={
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <X size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Clip</Text>
          <View style={{ width: 44 }} />
        </View>
      }
      footer={
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
      }
    >
      {activeVideoUri ? (
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
    </KeyboardAwareScreen>
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: C.surface,
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
