import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

// Tracks the on-screen keyboard's height. Returns 0 when the keyboard is
// hidden. Use the returned value as marginBottom on a screen-level container
// to lift content above the keyboard. This is more reliable than
// KeyboardAvoidingView on Android — RN's Modal doesn't honor adjustResize,
// and KAV with behavior=undefined is a no-op.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
