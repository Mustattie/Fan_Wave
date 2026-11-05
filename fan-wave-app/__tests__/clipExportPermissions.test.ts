import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { exportClipToGallery } from '../lib/clipExport';

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: jest.fn(async () => ({ status: 200, uri: 'file:///cache/clip.mp4' })),
}));
jest.mock('../lib/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('../lib/storage', () => ({ deleteLocalFile: jest.fn(async () => undefined) }));

const clip = { id: 'demo', title: 'Practice', mediaUrl: 'https://example.com/clip.mp4', mediaType: 'video' as const };
const originalOS = Platform.OS;

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  jest.clearAllMocks();
});

it('saves Android clips with append access without requesting audio-library reads', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  expect(await exportClipToGallery(clip)).toBe(true);
  expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true);
  expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/clip.mp4');
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('preserves the existing iOS permission mode', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  expect(await exportClipToGallery(clip)).toBe(true);
  expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(false);
});

it('still offers system sharing when gallery access is denied', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  expect(await exportClipToGallery(clip)).toBe(true);
  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/clip.mp4', expect.objectContaining({ mimeType: 'video/mp4' }));
});
