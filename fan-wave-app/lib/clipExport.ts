import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import { trackEvent } from './analytics';

/**
 * Download and save a clip to the device's camera roll.
 * On iOS, also prompts the share sheet after saving.
 */
export async function exportClipToGallery(clip: {
  id: string;
  title: string;
  mediaUrl: string;
  mediaType: 'video' | 'image';
}): Promise<boolean> {
  try {
    // Download the file first — works regardless of media-library permissions.
    const ext = clip.mediaType === 'video' ? 'mp4' : 'jpg';
    const localUri = `${cacheDirectory}fansphere_${clip.id}.${ext}`;

    const download = await downloadAsync(clip.mediaUrl, localUri);
    if (download.status !== 200) {
      Alert.alert('Export Failed', 'Could not download the clip. Please try again.');
      return false;
    }

    // Try direct camera-roll save. On Android in Expo Go this fails because
    // Google restricted WRITE_EXTERNAL_STORAGE; fall back to the system share
    // sheet so the user can still save via Photos or share elsewhere.
    // v9.2.6 UAT 2026-07-28: prior flow called createAssetAsync +
    // addAssetsToAlbumAsync to bucket every clip into a "Fan Sphere"
    // album. On Android 11+ each addAssets call triggers a
    // MediaStore.createWriteRequest() consent dialog ("Allow Fan Sphere
    // to modify this video?") -- users report that popup shows on top
    // of the actual Save alert and reads like a scary permission grant.
    // saveToLibraryAsync uses a single append-only insert with no
    // modify request, at the cost of skipping the album step. The clip
    // still lands in Photos where users expect it.
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') throw new Error('permission-denied');

      await MediaLibrary.saveToLibraryAsync(download.uri);

      trackEvent('clip_exported', 'clips', {
        clip_id: clip.id,
        type: clip.mediaType,
        method: 'media_library',
      });
      Alert.alert('Saved!', `${clip.title} saved to your Photos.`);
      return true;
    } catch {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          'Export Failed',
          'Saving to your camera roll is not available on this device.',
        );
        return false;
      }

      await Sharing.shareAsync(download.uri, {
        mimeType: clip.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
        dialogTitle: `Save ${clip.title}`,
        UTI: clip.mediaType === 'video' ? 'public.mpeg-4' : 'public.jpeg',
      });

      trackEvent('clip_exported', 'clips', {
        clip_id: clip.id,
        type: clip.mediaType,
        method: 'share_sheet',
      });
      return true;
    }
  } catch {
    Alert.alert('Export Failed', 'Something went wrong. Please try again.');
    return false;
  }
}
