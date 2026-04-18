import { Alert, Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
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
    // Request permission
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Allow Fan Wave to save to your camera roll in Settings.',
      );
      return false;
    }

    // Download the file
    const ext = clip.mediaType === 'video' ? 'mp4' : 'jpg';
    const localUri = `${cacheDirectory}fanwave_${clip.id}.${ext}`;

    const download = await downloadAsync(clip.mediaUrl, localUri);
    if (download.status !== 200) {
      Alert.alert('Export Failed', 'Could not download the clip. Please try again.');
      return false;
    }

    // Save to camera roll
    const asset = await MediaLibrary.createAssetAsync(download.uri);

    // Create a Fan Wave album if it doesn't exist
    let album = await MediaLibrary.getAlbumAsync('Fan Wave');
    if (!album) {
      await MediaLibrary.createAlbumAsync('Fan Wave', asset, false);
    } else {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    }

    trackEvent('clip_exported', 'clips', { clip_id: clip.id, type: clip.mediaType });

    Alert.alert('Saved!', `${clip.title} saved to your Fan Wave album.`);
    return true;
  } catch {
    Alert.alert('Export Failed', 'Something went wrong. Please try again.');
    return false;
  }
}
