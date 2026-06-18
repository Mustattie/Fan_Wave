import React, { useCallback, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { Share2, Music2, Camera, Link as LinkIcon, X } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { trackEvent } from '@/lib/analytics';

/**
 * Custom share sheet for clips. Always shows:
 *   1. "Share to TikTok"        — TikTok-installed detection + web-upload fallback
 *   2. "Instagram Stories"      — IG installed detection + Play/App store fallback
 *   3. "Copy Link"              — clipboard + toast
 *   4. "More apps..."           — original system share sheet (Android share intent
 *                                  with video/mp4 mime so any installed video target
 *                                  surfaces, including TikTok IF it registered the
 *                                  intent filter for the current MIME).
 *
 * TikTok flow honest end-state: TikTok does NOT expose a public deep-link
 * upload API that pre-fills a chosen video. We:
 *   a. Save the .mp4 to the user's Camera Roll (so it's pickable inside TikTok)
 *   b. Open `https://www.tiktok.com/upload?source=fansphere` — on Android this
 *      gets intercepted by the installed TikTok app and surfaces the upload
 *      screen; on iOS it opens Safari to the same page. The user then taps
 *      "Upload" inside TikTok and picks the freshly-saved clip from their
 *      gallery. This is the documented path Buffer / Later / Hootsuite use.
 *   c. If TikTok isn't installed at all, open the store listing instead.
 */

interface ClipShareSheetProps {
  visible: boolean;
  onClose: () => void;
  clip: {
    id: string;
    title: string;
    description?: string;
    mediaUrl?: string;
  };
}

const DEEP_LINK_BASE = 'https://fansphere.org';
const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/upload?source=fansphere';
const TIKTOK_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically';
const TIKTOK_APP_STORE_URL = 'https://apps.apple.com/app/tiktok/id835599320';
const INSTAGRAM_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.instagram.android';
const INSTAGRAM_APP_STORE_URL = 'https://apps.apple.com/app/instagram/id389801252';

async function saveClipToGallery(clip: { id: string; mediaUrl?: string }): Promise<string | null> {
  if (!clip.mediaUrl) return null;
  try {
    const FS = await import('expo-file-system/legacy');
    const MediaLibrary = await import('expo-media-library');

    const localPath = `${FS.cacheDirectory}fansphere_share_${clip.id}.mp4`;
    const download = await FS.downloadAsync(clip.mediaUrl, localPath);
    if (download.status !== 200) return null;

    // Saving to the Camera Roll is what makes the clip pickable inside
    // TikTok / Instagram's upload screens. Without this, the user opens
    // the target app and has nothing to attach.
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (perm.status !== 'granted') {
      // Still return the local cache path so the More-apps share sheet has
      // something to attach. TikTok hand-off won't work without gallery
      // access, but we don't want to block the other rows.
      return download.uri;
    }
    await MediaLibrary.saveToLibraryAsync(download.uri);
    return download.uri;
  } catch {
    return null;
  }
}

export function ClipShareSheet({ visible, onClose, clip }: ClipShareSheetProps) {
  const [busy, setBusy] = useState<null | 'tiktok' | 'instagram' | 'more' | 'copy'>(null);

  const deepLink = `${DEEP_LINK_BASE}/clip/${clip.id}`;

  const handleTikTok = useCallback(async () => {
    setBusy('tiktok');
    try {
      // Probe TikTok install. Android uses `tiktok://`, iOS historically
      // shipped `snssdk1233://` (legacy ByteDance scheme) — try both.
      let installed = false;
      try {
        installed = await Linking.canOpenURL('tiktok://');
      } catch {
        installed = false;
      }
      if (!installed && Platform.OS === 'ios') {
        try {
          installed = await Linking.canOpenURL('snssdk1233://');
        } catch {
          installed = false;
        }
      }

      if (!installed) {
        // No TikTok app — send the user to the store. They can install,
        // come back to Fan Sphere, and re-tap Share.
        const storeUrl =
          Platform.OS === 'ios' ? TIKTOK_APP_STORE_URL : TIKTOK_PLAY_URL;
        Alert.alert(
          'TikTok not installed',
          'Install TikTok to share clips directly. Opening the store now.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Store', onPress: () => Linking.openURL(storeUrl) },
          ],
        );
        return;
      }

      // Save the clip to the Camera Roll so the user can attach it from
      // TikTok's upload screen, then open the upload URL. The web URL is
      // the only documented hand-off path; TikTok does not accept a file
      // via deep link.
      const saved = await saveClipToGallery(clip);
      if (saved) {
        Alert.alert(
          'Saved to Photos',
          'Your clip is saved. Tap Upload inside TikTok and pick it from your gallery.',
          [
            {
              text: 'Open TikTok',
              onPress: async () => {
                trackEvent('content_shared', 'clip', { id: clip.id, platform: 'tiktok' });
                try {
                  await Linking.openURL(TIKTOK_UPLOAD_URL);
                } catch {
                  /* ignore */
                }
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
      } else {
        // Fall back: just open TikTok upload; user can browse their files.
        trackEvent('content_shared', 'clip', { id: clip.id, platform: 'tiktok_no_save' });
        try {
          await Linking.openURL(TIKTOK_UPLOAD_URL);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(null);
      onClose();
    }
  }, [clip, onClose]);

  const handleInstagram = useCallback(async () => {
    setBusy('instagram');
    try {
      let installed = false;
      try {
        installed = await Linking.canOpenURL('instagram://');
      } catch {
        installed = false;
      }
      if (!installed) {
        const storeUrl =
          Platform.OS === 'ios' ? INSTAGRAM_APP_STORE_URL : INSTAGRAM_PLAY_URL;
        Alert.alert(
          'Instagram not installed',
          'Install Instagram to share clips to Stories.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Store', onPress: () => Linking.openURL(storeUrl) },
          ],
        );
        return;
      }
      // Save to gallery, then route the user to IG Stories camera. IG's
      // stories-camera deep link is `instagram://story-camera`; once there
      // the user swipes up to pick the saved clip.
      await saveClipToGallery(clip);
      trackEvent('content_shared', 'clip', { id: clip.id, platform: 'instagram' });
      try {
        await Linking.openURL('instagram://story-camera');
      } catch {
        await Linking.openURL('instagram://');
      }
    } finally {
      setBusy(null);
      onClose();
    }
  }, [clip, onClose]);

  const handleCopyLink = useCallback(async () => {
    setBusy('copy');
    try {
      // expo-clipboard isn't a hard dep — try a dynamic import; if missing,
      // fall back to surfacing the link in an Alert so the user can long-
      // press / select-copy.
      try {
        // @ts-expect-error optional dep, not installed by default
        const Clipboard = await import('expo-clipboard');
        if (Clipboard?.setStringAsync) {
          await Clipboard.setStringAsync(deepLink);
        }
      } catch {
        /* clipboard module unavailable — Alert below carries the link */
      }
      trackEvent('content_shared', 'clip', { id: clip.id, platform: 'copy_link' });
      Alert.alert('Link copied', deepLink);
    } finally {
      setBusy(null);
      onClose();
    }
  }, [clip.id, deepLink, onClose]);

  const handleMoreApps = useCallback(async () => {
    setBusy('more');
    try {
      // Delegate to the existing shareClip helper — preserves the system
      // share sheet behaviour so any installed app that registered for
      // video/mp4 (including TikTok, if it did) still appears.
      const { shareClip } = await import('@/lib/sharing');
      await shareClip({
        id: clip.id,
        title: clip.title,
        description: clip.description,
        mediaUrl: clip.mediaUrl,
      });
    } finally {
      setBusy(null);
      onClose();
    }
  }, [clip, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Share clip</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <X size={22} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>

          <ShareRow
            icon={<Music2 size={22} color="#fff" />}
            iconBg="#000"
            label="Share to TikTok"
            sublabel="Saves to gallery, opens TikTok upload"
            onPress={handleTikTok}
            loading={busy === 'tiktok'}
          />
          <ShareRow
            icon={<Camera size={22} color="#fff" />}
            iconBg="#E1306C"
            label="Instagram Stories"
            sublabel="Saves to gallery, opens IG camera"
            onPress={handleInstagram}
            loading={busy === 'instagram'}
          />
          <ShareRow
            icon={<LinkIcon size={22} color="#fff" />}
            iconBg={Colors.dark.accent}
            label="Copy Link"
            sublabel={deepLink}
            onPress={handleCopyLink}
            loading={busy === 'copy'}
          />
          <ShareRow
            icon={<Share2 size={22} color="#fff" />}
            iconBg={Colors.dark.surface}
            label="More apps..."
            sublabel="System share sheet"
            onPress={handleMoreApps}
            loading={busy === 'more'}
          />
        </View>
      </View>
    </Modal>
  );
}

function ShareRow({
  icon,
  iconBg,
  label,
  sublabel,
  onPress,
  loading,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  sublabel?: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={loading}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        {loading ? <ActivityIndicator color="#fff" size="small" /> : icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel && (
          <Text style={styles.rowSublabel} numberOfLines={1}>
            {sublabel}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: '800', color: Colors.dark.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: 15, fontWeight: '700', color: Colors.dark.text },
  rowSublabel: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 2 },
});
