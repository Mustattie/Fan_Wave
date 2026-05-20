import { SPORT_BY_ID } from '@/constants/Sports';
import { Colors } from '@/constants/Colors';

// ─── Sport Helpers ───────────────────────────────────────────

export function getSportEmoji(sportName?: string | null): string {
  if (!sportName) return '🏆';
  const lower = sportName.toLowerCase();
  const sport = SPORT_BY_ID[lower];
  if (sport) return sport.icon;
  // Try matching by name
  const byName: Record<string, string> = {
    football: '🏈', basketball: '🏀', baseball: '⚾',
    soccer: '⚽', hockey: '🏒', mma: '🥊',
  };
  return byName[lower] || '🏆';
}

export function getSportColor(sportName?: string | null): string {
  if (!sportName) return Colors.dark.accent;
  const lower = sportName.toLowerCase();
  return (Colors.dark as any)[lower] || Colors.dark.accent;
}

export function getSportIconBg(sportName?: string | null): string {
  const color = getSportColor(sportName);
  return color + '33';
}

// ─── Date / Time Formatting ──────────────────────────────────

export function formatGameTime(scheduledAt: string): string {
  const d = new Date(scheduledAt);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatPartyDate(startsAt: string): string {
  const d = new Date(startsAt);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (isToday) return `Tonight ${time}`;
  if (isTomorrow) return `Tomorrow ${time}`;

  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ` ${time}`;
}

export function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ─── Game Mapper ─────────────────────────────────────────────

export interface GameDisplay {
  id: string;
  homeTeam: { name: string; icon: string };
  awayTeam: { name: string; icon: string };
  time: string;
  league: string;
  sport: string;
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  period?: number | null;
  displayClock?: string | null;
  detail?: string | null;
  homeLinescore?: number[] | null;
  awayLinescore?: number[] | null;
}

export function mapGameToDisplay(row: any): GameDisplay {
  // Prefer the column we now write directly (migration 031). Fall back
  // to the deep team→league→sport lookup for rows queried without
  // sport_id selected, or seeded rows not yet backfilled.
  const sport = (row.sport_id
    || row.home_team?.league?.sport?.name
    || row.sport_name
    || '').toString().toLowerCase();
  const leagueName = row.home_team?.league?.name
    || row.league_name
    || row.event?.name
    || '';

  // ESPN sync writes 'scheduled' / 'in' / 'post' to the DB. Translate to
  // the friendlier 'scheduled' / 'live' / 'final' the UI was designed
  // for. Without this, GameCard's isLive check never matched.
  const rawStatus = row.status;
  const status =
    rawStatus === 'in' ? 'live'
    : rawStatus === 'post' ? 'final'
    : rawStatus;

  // Live-game extras stored on metadata by the ESPN function.
  const meta = row.metadata || {};

  return {
    id: row.id,
    homeTeam: {
      name: row.home_team?.name || 'TBD',
      icon: row.home_team?.code ? getSportEmoji(sport) : '🏟️',
    },
    awayTeam: {
      name: row.away_team?.name || 'TBD',
      icon: row.away_team?.code ? getSportEmoji(sport) : '🏟️',
    },
    time: row.scheduled_at ? formatGameTime(row.scheduled_at) : 'TBD',
    league: leagueName,
    sport,
    status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    period: typeof meta.period === 'number' ? meta.period : null,
    displayClock: typeof meta.display_clock === 'string' ? meta.display_clock : null,
    detail: typeof meta.detail === 'string' ? meta.detail : null,
    homeLinescore: Array.isArray(meta.home_linescore) ? meta.home_linescore : null,
    awayLinescore: Array.isArray(meta.away_linescore) ? meta.away_linescore : null,
  };
}

// ─── Watch Party Mapper ──────────────────────────────────────

export interface WatchPartyDisplay {
  id: string;
  title: string;
  venue: string;
  venueArea: string;
  sport: string;
  sportIcon: string;
  sportColor: string;
  date: string;
  startsAt: string;
  rsvpCount: number;
  capacity: number;
  atmosphere: string;
  attendees: { initials: string; color: string }[];
  city?: string;
}

export function mapWatchPartyToDisplay(row: any): WatchPartyDisplay {
  const sportName = row.sport?.name || row.sport_name || '';
  const rsvps: any[] = row.rsvps || [];

  const attendeeColors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
  const attendees = rsvps.slice(0, 4).map((r: any, i: number) => ({
    initials: (r.user?.display_name || 'U').charAt(0).toUpperCase(),
    color: attendeeColors[i % attendeeColors.length],
  }));

  return {
    id: row.id,
    title: row.title || 'Watch Party',
    venue: row.venue_name || 'Venue TBD',
    venueArea: row.venue_city || '',
    sport: sportName.toLowerCase(),
    sportIcon: getSportEmoji(sportName),
    sportColor: getSportColor(sportName),
    date: row.starts_at ? formatPartyDate(row.starts_at) : 'Date TBD',
    startsAt: row.starts_at || '',
    rsvpCount: row.rsvp_count || 0,
    capacity: row.capacity || 50,
    atmosphere: row.atmosphere || 'chill',
    attendees,
    city: row.venue_city,
  };
}

// ─── Chat Room / Group Mapper ────────────────────────────────

export interface ChatRoomDisplay {
  id: string;
  name: string;
  icon: string;
  iconBg: string;
  memberCount: number;
  onlineCount: number;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  tags: string[];
  sport: string;
}

export function mapChatRoomToDisplay(row: any): ChatRoomDisplay {
  const rawSport = (row.sport || row.sport_id || '').toLowerCase();
  const tags: string[] = row.tags || [];
  // World Cup fan groups don't always have sport='soccer' set on the row —
  // detect via tag so MomentsFeed renders soccer-relevant moment types
  // (Goal, Yellow Card, Penalty, etc.) instead of the NFL default.
  const isWorldCup = tags.some((t) => /world\s?cup/i.test(String(t)));
  const sport = isWorldCup ? 'worldcup' : rawSport;

  return {
    id: row.id,
    name: row.name || 'Fan Group',
    icon: row.icon || getSportEmoji(sport),
    iconBg: row.icon_bg || getSportIconBg(sport),
    memberCount: row.member_count || 0,
    onlineCount: row.online_count || 0,
    lastMessage: row.last_message || '',
    lastMessageTime: row.last_message_at ? formatRelativeTime(row.last_message_at) : '',
    unreadCount: row.unread_count || 0,
    tags,
    sport,
  };
}

// ─── Message Mapper ──────────────────────────────────────────

export interface ChatMessageDisplay {
  id: string;
  user: string;
  avatar: string;
  avatarBg: string;
  text: string;
  time: string;
  created_at: string;
  isMe: boolean;
}

const AVATAR_COLORS = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];

export function mapMessageToDisplay(row: any, currentUserId?: string): ChatMessageDisplay {
  const isMe = currentUserId ? row.user_id === currentUserId : false;
  const userName = row.user?.display_name || row.user_name || 'Unknown';
  const initial = userName.charAt(0).toUpperCase();
  // Deterministic color from user_id
  const colorIndex = row.user_id
    ? row.user_id.charCodeAt(0) % AVATAR_COLORS.length
    : 0;

  return {
    id: row.id,
    user: isMe ? 'You' : userName,
    avatar: initial,
    avatarBg: isMe ? Colors.dark.accent : (row.avatar_bg || AVATAR_COLORS[colorIndex]),
    text: row.content || '',
    time: row.created_at
      ? new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '',
    created_at: row.created_at || new Date().toISOString(),
    isMe,
  };
}

// ─── Clip Mapper ─────────────────────────────────────────────

export interface ClipDisplay {
  id: string;
  title: string;
  poster: string;
  group: string;
  time: string;
  sport: string;
  sportIcon: string;
  likes: number;
  like_count: number;
  view_count: number;
  comments: number;
  comment_count: number;
  shares: number;
  bgColors: string[];
  videoUrl: string;
  userId: string;
  mediaType: 'video' | 'image';
}

export function mapClipToDisplay(row: any): ClipDisplay {
  const sportName = row.sport || '';
  return {
    id: row.id,
    title: row.title || 'Untitled Clip',
    poster: row.user?.display_name ? `@${row.user.display_name}` : (row.poster || '@unknown'),
    group: row.chat_room?.name || row.group_name || 'Fan Wave',
    time: row.created_at ? formatRelativeTime(row.created_at) : 'recently',
    sport: sportName.toLowerCase(),
    sportIcon: getSportEmoji(sportName),
    likes: row.like_count || 0,
    like_count: row.like_count || 0,
    view_count: row.view_count || 0,
    comments: row.comment_count || 0,
    comment_count: row.comment_count || 0,
    shares: row.share_count || 0,
    bgColors: row.bg_colors || ['#1a3a5c', '#2a4a7c'],
    videoUrl: row.media_url || row.video_url || '',
    userId: row.user_id || '',
    mediaType: row.media_type || 'video',
  };
}
