import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

// Tracks how much of the screen the on-screen keyboard is covering.
// Returns 0 when the keyboard is hidden. Use the returned value as
// marginBottom on a screen-level container to lift content above the
// keyboard. This is more reliable than KeyboardAvoidingView on Android —
// RN's Modal doesn't honor adjustResize, and KAV with behavior=undefined
// is a no-op — and on iOS, where KAV derives its lift from its own
// measured frame (SKYC-129: the lift it computed left a sticky bar under
// the keyboard's predictive row).
//
// iOS listens for keyboardWillChangeFrame rather than keyboardWillShow,
// because the keyboard also moves while it is already up: the predictive
// row appearing or being switched off, a keyboard-type change, a hardware
// keyboard attaching. willShow does not fire for any of those, and a bar
// positioned from a stale height is the original defect again. The height
// is derived as the overlap with the screen rather than read from
// endCoordinates.height, so an off-screen frame reads as 0 instead of as
// a full-height keyboard.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const subs =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', (e) => {
              const screenHeight = Dimensions.get('screen').height;
              const endY = e?.endCoordinates?.screenY ?? screenHeight;
              setHeight(Math.max(0, screenHeight - endY));
            }),
            Keyboard.addListener('keyboardWillHide', () => setHeight(0)),
          ]
        : [
            // Android resizes the window itself; the height is only read
            // by callers that need to know the keyboard is up at all.
            Keyboard.addListener('keyboardDidShow', (e) =>
              setHeight(e?.endCoordinates?.height ?? 0),
            ),
            Keyboard.addListener('keyboardDidHide', () => setHeight(0)),
          ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return height;
}
