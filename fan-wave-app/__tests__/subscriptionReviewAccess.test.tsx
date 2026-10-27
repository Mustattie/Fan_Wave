import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

let mockState: any;
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/lib/entitlements', () => ({
  useSubscriptionState: () => ({ data: mockState }),
  getTierPrice: jest.fn(async () => ({ available: true, priceString: '$4.99' })),
  restorePurchases: jest.fn(),
}));
jest.mock('@/components/paywall/PremiumPaywall', () => ({
  PremiumPaywall: ({ visible, tier }: any) => {
    const { Text } = require('react-native');
    return visible ? <Text>{`purchase-sheet:${tier}`}</Text> : null;
  },
}));
import SubscriptionScreen from '../app/subscription';
import { WCPassPaywall } from '../components/paywall/WCPassPaywall';

test('reviewer with full MVP access can open both purchase sheets', async () => {
  mockState = { tier: 'mvp', status: 'none', hasPremiumAccess: true, isReviewer: true };
  const screen = render(<SubscriptionScreen />);
  await waitFor(() => expect(screen.getByText('See Home Team ›')).toBeTruthy());
  fireEvent.press(screen.getByText('See Home Team ›'));
  expect(screen.getByText('purchase-sheet:home_team')).toBeTruthy();
  fireEvent.press(screen.getByText('See MVP ›'));
  expect(screen.getByText('purchase-sheet:mvp')).toBeTruthy();
});

test('ordinary active MVP subscriber is not offered duplicate subscriptions', async () => {
  mockState = { tier: 'mvp', status: 'active', hasPremiumAccess: true };
  const screen = render(<SubscriptionScreen />);
  await waitFor(() => expect(screen.getByText('Fan Sphere MVP')).toBeTruthy());
  expect(screen.queryByText('See Home Team ›')).toBeNull();
  expect(screen.queryByText('See MVP ›')).toBeNull();
});

test('free account can still discover both tiers', async () => {
  mockState = { tier: 'free', status: 'none', hasPremiumAccess: false };
  const screen = render(<SubscriptionScreen />);
  await waitFor(() => expect(screen.getByText('See Home Team ›')).toBeTruthy());
  expect(screen.getByText('See MVP ›')).toBeTruthy();
});

test('historical event gate can be dismissed and offers no retired purchase', () => {
  const close = jest.fn();
  const screen = render(<WCPassPaywall visible onClose={close} />);
  expect(screen.getByText('This event has ended')).toBeTruthy();
  expect(screen.queryByText(/Buy.*Pass/)).toBeNull();
  fireEvent.press(screen.getByText('Close'));
  expect(close).toHaveBeenCalledTimes(1);
});
