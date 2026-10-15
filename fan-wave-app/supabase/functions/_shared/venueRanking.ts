type RankedVenue = { address: string; distanceMeters: number };
const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** An explicit city/state query outranks distance from a different home city. */
export function venueRanker(query: string): (a: RankedVenue, b: RankedVenue) => number {
  const match = /^(.*?)[,\s]+([a-z]{2})$/i.exec(query.trim());
  const state = match?.[2].toUpperCase();
  const city = match ? normalize(match[1].replace(/^(?:sports\s+bars?|bars?|restaurants?|pubs?|cafes?)\s+(?:in|near)\s+/i, '')) : '';
  const inSearchedCity = (venue: RankedVenue) => {
    if (!city || !state || !STATES.has(state)) return false;
    const parts = venue.address.split(',').map(normalize);
    return parts.includes(city) && parts.some(part => new RegExp('^' + state.toLowerCase() + '(?: |[0-9]|$)').test(part));
  };
  return (a, b) => Number(inSearchedCity(b)) - Number(inSearchedCity(a)) || a.distanceMeters - b.distanceMeters;
}
