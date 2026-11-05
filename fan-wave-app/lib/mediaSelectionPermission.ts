import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/** Android's system picker grants access to the selected items without broad library access. */
export async function canSelectLibraryMedia(): Promise<boolean> {
  if (Platform.OS === 'android') return true;
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted';
}
