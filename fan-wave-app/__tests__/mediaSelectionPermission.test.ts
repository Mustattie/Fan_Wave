import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { canSelectLibraryMedia } from '../lib/mediaSelectionPermission';

jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: jest.fn() }));
const originalOS = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  jest.clearAllMocks();
});

it('allows Android system selection even without broad photo/video permission', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  expect(await canSelectLibraryMedia()).toBe(true);
  expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
});

it.each(['granted', 'denied'])('preserves iOS library consent: %s', async (status) => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ status });
  expect(await canSelectLibraryMedia()).toBe(status === 'granted');
  expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
});
