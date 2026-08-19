import { cityFromAddress } from '../lib/addressCity';

describe('cityFromAddress', () => {
  it('parses the Google Places shape from the UAT report', () => {
    // The exact string behind "Uncork'd Bar & Grill · Dallas" being wrong.
    expect(cityFromAddress('301 N Custer Rd #180, McKinney, TX 75071, USA'))
      .toBe('McKinney');
  });

  it('parses without a trailing country', () => {
    expect(cityFromAddress('301 N Custer Rd #180, McKinney, TX 75071'))
      .toBe('McKinney');
  });

  it('parses the Nominatim manual-entry shape (spelled-out state)', () => {
    expect(cityFromAddress('301 N Custer Rd, McKinney, Texas, 75071'))
      .toBe('McKinney');
  });

  it('keeps multi-word city names intact', () => {
    expect(cityFromAddress('100 Main St, Fort Worth, TX 76102, USA'))
      .toBe('Fort Worth');
    expect(cityFromAddress('1 Rocket Rd, Los Angeles, California 90250'))
      .toBe('Los Angeles');
  });

  it('handles Canadian postal codes', () => {
    expect(cityFromAddress('290 Bremner Blvd, Toronto, ON M5V 3L9, Canada'))
      .toBe('Toronto');
  });

  it('returns null rather than guessing when there is no street line', () => {
    expect(cityFromAddress('McKinney, TX 75071, USA')).toBeNull();
    expect(cityFromAddress('McKinney')).toBeNull();
    expect(cityFromAddress('')).toBeNull();
    expect(cityFromAddress(null)).toBeNull();
    expect(cityFromAddress(undefined)).toBeNull();
  });

  it('reads a trailing locality that has no state or postcode after it', () => {
    expect(cityFromAddress("Uncork'd Bar & Grill, McKinney")).toBe('McKinney');
  });

  it('never returns a numeric-only segment', () => {
    expect(cityFromAddress('123 Main St, 75071')).toBeNull();
  });
});
