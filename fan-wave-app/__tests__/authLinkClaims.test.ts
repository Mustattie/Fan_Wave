import { claimAuthLink, _resetAuthLinkClaimsForTests } from '../lib/authLinkClaims';

describe('claimAuthLink (fix 8: one consumer per auth link)', () => {
  beforeEach(() => _resetAuthLinkClaimsForTests());

  it('lets the first caller claim a token and refuses the second', () => {
    expect(claimAuthLink('eyJ.access.token.A')).toBe(true);
    expect(claimAuthLink('eyJ.access.token.A')).toBe(false);
  });

  it('treats different tokens independently', () => {
    expect(claimAuthLink('token-A')).toBe(true);
    expect(claimAuthLink('token-B')).toBe(true);
  });

  it('forgets a claim after a minute so a later link with the same token can be used again', () => {
    let now = 1_000_000;
    const clock = () => now;
    expect(claimAuthLink('token-A', clock)).toBe(true);
    now += 30_000;
    expect(claimAuthLink('token-A', clock)).toBe(false);
    now += 31_000;
    expect(claimAuthLink('token-A', clock)).toBe(true);
  });
});
