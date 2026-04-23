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
    const localUri = `${cacheDirectory}fanwave_${clip.id}.${ext}`;

    const download = await downloadAsync(clip.mediaUrl, localUri);
    if (download.status !== 200) {
      Alert.alert('Export Failed', 'Could not download the clip. Please try again.');
      return false;
    }

    // Try direct camera-roll save. On Android in Expo Go this fails because
    // Google restricted WRITE_EXTERNAL_STORAGE; fall back to the system share
    // sheet so the user can still save via Photos or share elsewhere.
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') throw new Error('permission-denied');

      const asset = await MediaLibrary.createAssetAsync(download.uri);
      let album = await MediaLibrary.getAlbumAsync('Fan Wave');
      if (!album) {
        await MediaLibrary.createAlbumAsync('Fan Wave', asset, false);
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      }

      trackEvent('clip_exported', 'clips', {
        clip_id: clip.id,
        type: clip.mediaType,
        method: 'media_library',
      });
      Alert.alert('Saved!', `${clip.title} saved to your Fan Wave album.`);
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
