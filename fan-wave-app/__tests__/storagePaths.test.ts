import { clipPathFromPublicUrl } from '../lib/storage';

const BASE = 'https://fwlfiejvxmslkpoojggs.supabase.co/storage/v1/object/public/clips/';
const UID = '11111111-2222-3333-4444-555555555555';

describe('clipPathFromPublicUrl', () => {
  it('recovers the in-bucket path from a public URL', () => {
    expect(clipPathFromPublicUrl(`${BASE}${UID}/1755600000000.mp4`))
      .toBe(`${UID}/1755600000000.mp4`);
  });

  it('recovers the thumbnail path', () => {
    expect(clipPathFromPublicUrl(`${BASE}${UID}/1755600000000.thumb.jpg`))
      .toBe(`${UID}/1755600000000.thumb.jpg`);
  });

  it('strips a query string (cache-busting / transform params)', () => {
    expect(clipPathFromPublicUrl(`${BASE}${UID}/clip.mp4?t=123`))
      .toBe(`${UID}/clip.mp4`);
  });

  it('decodes percent-encoded segments', () => {
    expect(clipPathFromPublicUrl(`${BASE}${UID}/my%20clip.mp4`))
      .toBe(`${UID}/my clip.mp4`);
  });

  it('refuses anything that is not a clips-bucket URL', () => {
    // A wrong path here would issue a delete against an unrelated object.
    expect(clipPathFromPublicUrl(null)).toBeNull();
    expect(clipPathFromPublicUrl(undefined)).toBeNull();
    expect(clipPathFromPublicUrl('')).toBeNull();
    expect(clipPathFromPublicUrl('file:///var/tmp/local.mp4')).toBeNull();
    expect(clipPathFromPublicUrl('https://res.cloudinary.com/x/video/upload/a.mp4')).toBeNull();
    expect(
      clipPathFromPublicUrl(
        'https://fwlfiejvxmslkpoojggs.supabase.co/storage/v1/object/public/avatars/a.jpg',
      ),
    ).toBeNull();
  });

  it('returns null when the path after the bucket is empty', () => {
    expect(clipPathFromPublicUrl(BASE)).toBeNull();
  });
});
