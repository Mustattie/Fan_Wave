// v9.4.0 UAT Round 3 fix: iOS `.mov` captures were being tagged with
// Content-Type `video/mov`, which is not a registered MIME type. Supabase
// Storage stores that literal string and the CDN echoes it back on GET.
// iOS AVPlayer (used by expo-video internally) treats the Content-Type
// header as authoritative for track detection and stays in `.unknown`
// state indefinitely on an unrecognized type — that's the "spinner
// forever" symptom on Clips (#19) and the "video vanishes after send"
// on chat (#16). Android's ExoPlayer sniffs the container from magic
// bytes when the Content-Type is unfamiliar, so it worked fine there.
//
// Correct MIME for QuickTime container is `video/quicktime`. Both iOS
// AVPlayer and web browsers accept it, so switching heals iOS without
// breaking anything Android was already tolerating.

export function getVideoContentType(uri: string): string {
  const ext = (uri.split('.').pop() || 'mp4').toLowerCase();
  switch (ext) {
    case 'mov':  return 'video/quicktime';
    case 'm4v':  return 'video/x-m4v';
    case 'webm': return 'video/webm';
    case 'mp4':
    default:     return 'video/mp4';
  }
}

export function getImageContentType(uri: string): string {
  const ext = (uri.split('.').pop() || 'jpg').toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png':  return 'image/png';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    case 'webp': return 'image/webp';
    case 'gif':  return 'image/gif';
    default:     return 'image/jpeg';
  }
}
