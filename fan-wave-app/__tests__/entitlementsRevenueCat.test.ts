// Stability fix 4: configure idempotency and the offerings cache.

process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_testkey';
process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_testkey';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone', appOwnership: null },
  ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone', Bare: 'bare' },
}));

const mockPurchases = {
  configure: jest.fn(async () => {}),
  logIn: jest.fn(async () => ({})),
  isConfigured: jest.fn(async () => false),
  getOfferings: jest.fn(),
};
jest.mock('react-native-purchases', () => ({ __esModule: true, default: mockPurchases }));

jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  reportMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/realtime', () => ({ subscribeToTable: jest.fn(() => () => {}) }));

import {
  configureRevenueCat,
  getTierPrice,
  invalidateOfferingsCache,
  _resetRevenueCatStateForTests,
} from '../lib/entitlements';

function offeringsWith(prices: Record<string, string>) {
  return {
    current: {
      availablePackages: Object.entries(prices).map(([identifier, priceString]) => ({
        identifier,
        product: { identifier, priceString },
      })),
    },
  };
}

describe('configureRevenueCat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRevenueCatStateForTests();
    mockPurchases.isConfigured.mockResolvedValue(false);
  });

  it('configures once across mount + SIGNED_IN, and logs in once per user', async () => {
    await configureRevenueCat(); // root mount, no user
    await configureRevenueCat('user-1'); // SIGNED_IN
    await configureRevenueCat('user-1'); // INITIAL_SESSION / repeat
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledWith('user-1');
  });

  it('serialises overlapping callers so configure still runs once', async () => {
    await Promise.all([configureRevenueCat(), configureRevenueCat('user-1')]);
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
  });

  it('logs in a different user without reconfiguring', async () => {
    await configureRevenueCat('user-1');
    await configureRevenueCat('user-2');
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenNthCalledWith(1, 'user-1');
    expect(mockPurchases.logIn).toHaveBeenNthCalledWith(2, 'user-2');
  });

  it('skips configure when the native SDK reports it is already configured', async () => {
    mockPurchases.isConfigured.mockResolvedValue(true);
    await configureRevenueCat('user-1');
    expect(mockPurchases.configure).not.toHaveBeenCalled();
    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
  });
});

describe('offerings cache via getTierPrice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRevenueCatStateForTests();
    mockPurchases.getOfferings.mockResolvedValue(
      offeringsWith({ home_team_monthly: '$4.99', home_team_annual: '$34.99' }),
    );
  });

  it('a paywall asking for two prices concurrently triggers one getOfferings', async () => {
    const [monthly, annual] = await Promise.all([
      getTierPrice('home_team', 'monthly'),
      getTierPrice('home_team', 'annual'),
    ]);
    expect(monthly).toEqual({ available: true, priceString: '$4.99' });
    expect(annual).toEqual({ available: true, priceString: '$34.99' });
    expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(1);
  });

  it('serves a second paywall open from cache within the TTL', async () => {
    await getTierPrice('home_team', 'monthly');
    await getTierPrice('mvp', 'monthly');
    expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache is invalidated (user change)', async () => {
    await getTierPrice('home_team', 'monthly');
    invalidateOfferingsCache();
    await getTierPrice('home_team', 'monthly');
    expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(2);
  });

  it('refetches after the 5-minute TTL', async () => {
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      await getTierPrice('home_team', 'monthly');
      now += 5 * 60 * 1000 + 1;
      await getTierPrice('home_team', 'monthly');
      expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('does not cache a failure or an empty offering', async () => {
    mockPurchases.getOfferings.mockRejectedValueOnce(new Error('offline'));
    expect(await getTierPrice('home_team', 'monthly')).toEqual({ available: false });
    mockPurchases.getOfferings.mockResolvedValueOnce({ current: null });
    expect(await getTierPrice('home_team', 'monthly')).toEqual({ available: false });
    expect(await getTierPrice('home_team', 'monthly')).toEqual({ available: true, priceString: '$4.99' });
    expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(3);
  });

  it('still fails closed for a tier with no package', async () => {
    expect(await getTierPrice('mvp', 'annual')).toEqual({ available: false });
  });
});
