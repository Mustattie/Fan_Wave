// SKYC-129: the hook the Create Watch Party action bar is positioned
// from. The bar is only ever as correct as this number, so the events it
// subscribes to are the thing worth pinning — a height that goes stale
// while the keyboard is still up is the original defect (a sticky button
// under the predictive row) coming back.
//
// Runs under both platform presets: iOS tracks keyboardWillChangeFrame
// and derives the overlap from the screen bounds; Android reads
// keyboardDidShow, because the window resize is what moves content there.
import React from 'react';
import { Dimensions, Keyboard, Platform, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

const SCREEN = Dimensions.get('screen').height;

function Probe() {
  const height = useKeyboardHeight();
  return <Text testID="height">{String(height)}</Text>;
}

const read = (utils: ReturnType<typeof render>) =>
  Number(utils.getByTestId('height').props.children);

// The hook's subscriptions, captured as it registers them. Driving the
// real listeners is the point: the assertions below are about which
// events the hook listens to and what it computes from them, not about
// a mocked return value.
const listeners = new Map<string, (payload: any) => void>();

beforeEach(() => {
  listeners.clear();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: any) => {
    listeners.set(event, cb);
    return { remove: () => listeners.delete(event) };
  }) as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Delivers a keyboard event to the hook the way the native module would. */
function emit(event: string, payload: any) {
  const cb = listeners.get(event);
  if (!cb) throw new Error(`hook never subscribed to ${event}`);
  act(() => cb(payload));
}

const frame = (height: number) => ({
  endCoordinates: { screenY: SCREEN - height, height, width: 390, screenX: 0 },
});

describe('useKeyboardHeight', () => {
  it('starts at zero', () => {
    expect(read(render(<Probe />))).toBe(0);
  });

  if (Platform.OS === 'ios') {
    it('follows the keyboard frame while it is already up', () => {
      const utils = render(<Probe />);

      emit('keyboardWillChangeFrame', frame(291));
      expect(read(utils)).toBe(291);

      // The predictive row appears: same keyboard, taller frame, and no
      // keyboardWillShow for it. This is the event the old hook missed.
      emit('keyboardWillChangeFrame', frame(336));
      expect(read(utils)).toBe(336);
    });

    it('reads an off-screen frame as hidden, not as a full-height keyboard', () => {
      const utils = render(<Probe />);
      emit('keyboardWillChangeFrame', frame(336));
      expect(read(utils)).toBe(336);

      // Interactive dismissal ends with the frame below the screen. Taken
      // from endCoordinates.height this would read 336 with the keyboard
      // gone; as an overlap it is 0.
      emit('keyboardWillChangeFrame', {
        endCoordinates: { screenY: SCREEN, height: 336, width: 390, screenX: 0 },
      });
      expect(read(utils)).toBe(0);
    });

    it('returns to zero when the keyboard hides', () => {
      const utils = render(<Probe />);
      emit('keyboardWillChangeFrame', frame(336));
      emit('keyboardWillHide', {});
      expect(read(utils)).toBe(0);
    });
  } else {
    it('reads the keyboard height from didShow and clears it on didHide', () => {
      const utils = render(<Probe />);
      emit('keyboardDidShow', frame(312));
      expect(read(utils)).toBe(312);
      emit('keyboardDidHide', {});
      expect(read(utils)).toBe(0);
    });
  }

  it("subscribes to this platform's events and removes them on unmount", () => {
    const utils = render(<Probe />);
    expect([...listeners.keys()].sort()).toEqual(
      Platform.OS === 'ios'
        ? ['keyboardWillChangeFrame', 'keyboardWillHide']
        : ['keyboardDidHide', 'keyboardDidShow'],
    );
    utils.unmount();
    expect(listeners.size).toBe(0);
  });
});
