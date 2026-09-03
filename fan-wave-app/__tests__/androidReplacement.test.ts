import { baseProductId, chooseAndroidReplacement } from '../lib/androidReplacement';

// Play reports active subscriptions with the base-plan suffix; the App Store
// sends bare IDs. Both shapes show up in customerInfo.activeSubscriptions.
const HT_MONTHLY = 'home_team_monthly_499:monthly';
const HT_ANNUAL = 'home_team_annual_3499:annual';
const MVP_MONTHLY = 'mvp_monthly_1499:monthly';
const MVP_ANNUAL = 'mvp_annual_9999:annual';

describe('baseProductId', () => {
  it('strips the Play base-plan suffix', () => {
    expect(baseProductId(HT_MONTHLY)).toBe('home_team_monthly_499');
  });

  it('leaves a bare App Store identifier alone', () => {
    expect(baseProductId('home_team_monthly_499')).toBe('home_team_monthly_499');
  });
});

describe('chooseAndroidReplacement', () => {
  it('returns null for a first-time subscriber', () => {
    // Declaring a replacement when nothing is active makes Play reject the
    // purchase outright.
    expect(chooseAndroidReplacement([], 'home_team_monthly_499')).toBeNull();
  });

  it('returns null when already on the target product', () => {
    expect(chooseAndroidReplacement([HT_MONTHLY], 'home_team_monthly_499')).toBeNull();
  });

  it('treats Home Team -> MVP as an upgrade', () => {
    // The bug this module exists for: without a replacement, this leaves the
    // Home Team subscription live and bills both.
    expect(chooseAndroidReplacement([HT_MONTHLY], 'mvp_monthly_1499')).toEqual({
      oldProductIdentifier: HT_MONTHLY,
      isUpgrade: true,
    });
  });

  it('treats MVP -> Home Team as a downgrade', () => {
    expect(chooseAndroidReplacement([MVP_ANNUAL], 'home_team_monthly_499')).toEqual({
      oldProductIdentifier: MVP_ANNUAL,
      isUpgrade: false,
    });
  });

  it('treats monthly -> annual within a tier as an upgrade', () => {
    expect(chooseAndroidReplacement([HT_MONTHLY], 'home_team_annual_3499')).toEqual({
      oldProductIdentifier: HT_MONTHLY,
      isUpgrade: true,
    });
  });

  it('treats annual -> monthly within a tier as a downgrade', () => {
    expect(chooseAndroidReplacement([HT_ANNUAL], 'home_team_monthly_499')).toEqual({
      oldProductIdentifier: HT_ANNUAL,
      isUpgrade: false,
    });
  });

  it('ranks a grandfathered premium_* holder as MVP, not as free', () => {
    // The webhook grandfathers premium_* up to tier mvp. If this ranked lower,
    // a grandfathered subscriber moving to mvp_monthly would read as an upgrade
    // and pay for a tier they already hold.
    expect(chooseAndroidReplacement(['premium_annual_10788'], 'mvp_monthly_1499')).toEqual({
      oldProductIdentifier: 'premium_annual_10788',
      isUpgrade: false,
    });
  });

  it('replaces the most valuable subscription when several are active', () => {
    // An account that already hit the double-bill bug. Replacing the cheaper
    // one would leave the expensive one billing.
    expect(chooseAndroidReplacement([HT_MONTHLY, MVP_ANNUAL], 'mvp_monthly_1499')).toEqual({
      oldProductIdentifier: MVP_ANNUAL,
      isUpgrade: false,
    });
  });

  it('treats an unrecognised active product as replaceable immediately', () => {
    // Deferring against an unknown product risks two live subscriptions;
    // an immediate switch cannot.
    expect(chooseAndroidReplacement(['some_retired_sku:monthly'], 'home_team_monthly_499')).toEqual({
      oldProductIdentifier: 'some_retired_sku:monthly',
      isUpgrade: true,
    });
  });
});
