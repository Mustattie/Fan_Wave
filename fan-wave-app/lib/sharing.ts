import { Share, Platform } from 'react-native';
import { trackEvent } from './analytics';

const DEEP_LINK_BASE = 'https://fansphere.org';
const APP_SCHEME = 'fansphere://';

interface ShareOptions {
  title: string;
  message: string;
  url?: string;
}

async function shareContent(options: ShareOptions, analyticsType: string, analyticsId: string): Promise<boolean> {
  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? { message: options.message, url: options.url }
        : { message: options.url ? `${options.message}\n${options.url}` : options.message, title: options.title },
    );

    if (result.action === Share.sharedAction) {
      trackEvent('content_shared', analyticsType, {
        id: analyticsId,
        platform: result.activityType || 'unknown',
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Share a media clip via native share sheet.
 *
 * Prefers sharing the video file (via expo-sharing) so Instagram, TikTok,
 * WhatsApp, etc. show up as targets with full video-handling support.
 * Falls back to text+URL share (Share.share) if the file can't be fetched.
 */
export async function shareClip(clip: {
  id: string;
  title: string;
  description?: string;
  mediaUrl?: string;
}): Promise<boolean> {
  const deepLink = `${DEEP_LINK_BASE}/clip/${clip.id}`;

  if (clip.mediaUrl) {
    try {
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        const FS = await import('expo-file-system/legacy');
        const localPath = `${FS.cacheDirectory}fansphere_share_${clip.id}.mp4`;
        const download = await FS.downloadAsync(clip.mediaUrl, localPath);
        if (download.status === 200) {
          await Sharing.shareAsync(download.uri, {
            mimeType: 'video/mp4',
            dialogTitle: clip.title,
            UTI: 'public.mpeg-4',
          });
          trackEvent('content_shared', 'clip', { id: clip.id, platform: 'file' });
          return true;
        }
      }
    } catch {
      // Fall through to text/URL share below.
    }
  }

  return shareContent(
    {
      title: clip.title,
      message: `${clip.title}${clip.description ? `\n${clip.description}` : ''}\n\nWatch on Fan Sphere!`,
      url: deepLink,
    },
    'clip',
    clip.id,
  );
}

/**
 * Share a match moment via native share sheet.
 */
export async function shareMoment(moment: { id: string; comment: string; momentType: string }): Promise<boolean> {
  const deepLink = `${DEEP_LINK_BASE}/moment/${moment.id}`;
  return shareContent(
    {
      title: `${moment.momentType} Moment`,
      message: `${moment.comment}\n\nCatch the action on Fan Sphere!`,
      url: deepLink,
    },
    'moment',
    moment.id,
  );
}

/**
 * Share a watch party via native share sheet.
 */
export async function shareWatchParty(party: {
  id: string;
  title: string;
  venue?: string;
  city?: string;
  date?: string;
}): Promise<boolean> {
  const deepLink = `${DEEP_LINK_BASE}/party/${party.id}`;
  const venue = party.venue ? ` at ${party.venue}` : '';
  const city = party.city ? ` in ${party.city}` : '';
  const date = party.date ? `\n${party.date}` : '';

  return shareContent(
    {
      title: party.title,
      message: `Join me for ${party.title}${venue}${city}${date}\n\nRSVP on Fan Sphere!`,
      url: deepLink,
    },
    'watch_party',
    party.id,
  );
}

/**
 * Share a fan group invite via native share sheet.
 */
export async function shareGroup(group: {
  id: string;
  name: string;
  memberCount?: number;
}): Promise<boolean> {
  const deepLink = `${DEEP_LINK_BASE}/group/${group.id}`;
  const members = group.memberCount ? ` (${group.memberCount.toLocaleString()} fans)` : '';

  return shareContent(
    {
      title: group.name,
      message: `Join ${group.name}${members} on Fan Sphere!\n\nYour crew, any city, every game.`,
      url: deepLink,
    },
    'fan_group',
    group.id,
  );
}

/**
 * Share the app itself (general invite).
 */
export async function shareAppInvite(referralCode?: string): Promise<boolean> {
  const link = referralCode
    ? `${DEEP_LINK_BASE}/invite/${referralCode}`
    : DEEP_LINK_BASE;

  return shareContent(
    {
      title: 'Fan Sphere',
      message: `Join me on Fan Sphere! Your crew, any city, every game.`,
      url: link,
    },
    'app_invite',
    referralCode || 'generic',
  );
}
