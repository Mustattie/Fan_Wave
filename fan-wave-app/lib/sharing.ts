import { Share, Platform } from 'react-native';
import { trackEvent } from './analytics';

const DEEP_LINK_BASE = 'https://fanwave.app';
const APP_SCHEME = 'fanwave://';

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
 */
export async function shareClip(clip: { id: string; title: string; description?: string }): Promise<boolean> {
  const deepLink = `${DEEP_LINK_BASE}/clip/${clip.id}`;
  return shareContent(
    {
      title: clip.title,
      message: `${clip.title}${clip.description ? `\n${clip.description}` : ''}\n\nWatch on Fan Wave!`,
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
      message: `${moment.comment}\n\nCatch the action on Fan Wave!`,
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
      message: `Join me for ${party.title}${venue}${city}${date}\n\nRSVP on Fan Wave!`,
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
      message: `Join ${group.name}${members} on Fan Wave!\n\nYour crew, any city, every game.`,
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
      title: 'Fan Wave',
      message: `Join me on Fan Wave! Your crew, any city, every game.`,
      url: link,
    },
    'app_invite',
    referralCode || 'generic',
  );
}
