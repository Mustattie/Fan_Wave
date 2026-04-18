export interface Sport {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface League {
  id: string;
  sport_id: string;
  name: string;
  country: string;
  icon: string;
}

export interface Team {
  id: string;
  league_id: string;
  name: string;
  code: string;
  city: string;
  logo_url: string;
  colors: Record<string, string>;
}

export interface GameEvent {
  id: string;
  league_id: string;
  name: string;
  type: 'season' | 'tournament' | 'playoff';
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface Game {
  id: string;
  event_id: string;
  home_team_id: string;
  away_team_id: string;
  home_team?: Team;
  away_team?: Team;
  venue_name: string;
  venue_lat: number;
  venue_lon: number;
  scheduled_at: string;
  status: 'scheduled' | 'live' | 'final' | 'postponed';
  home_score: number | null;
  away_score: number | null;
  stage: string | null;
  metadata: Record<string, any>;
}

export interface User {
  id: string;
  auth_id: string;
  display_name: string;
  avatar_url: string | null;
  home_city: string;
  favorite_team_ids: string[];
  push_token: string | null;
  created_at: string;
}

export interface ChatRoom {
  id: string;
  name: string;
  description: string;
  group_type: 'sports' | 'worldcup' | 'general';
  sport_id: string | null;
  event_id: string | null;
  team_id: string | null;
  city: string;
  tags: string[];
  visibility: 'public' | 'private';
  owner_id: string;
  member_count: number;
  avatar_url: string | null;
  created_at: string;
}

export interface ChatRoomMember {
  id: string;
  chat_room_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

export interface Message {
  id: string;
  chat_room_id: string;
  user_id: string;
  user?: User;
  content: string;
  type: 'text' | 'image' | 'video' | 'moment';
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface WatchParty {
  id: string;
  creator_id: string;
  creator?: User;
  game_id: string | null;
  game?: Game;
  sport_id: string;
  sport?: Sport;
  event_id: string | null;
  title: string;
  description: string;
  venue_name: string;
  venue_address: string;
  venue_lat: number;
  venue_lon: number;
  venue_city: string;
  atmosphere: 'chill' | 'moderate' | 'loud' | 'rowdy';
  capacity: number;
  rsvp_count: number;
  starts_at: string;
  created_at: string;
  moderation_status: 'active' | 'flagged' | 'removed';
}

export interface WatchPartyRsvp {
  id: string;
  watch_party_id: string;
  user_id: string;
  user?: User;
  status: 'going' | 'interested' | 'declined';
  created_at: string;
}

export interface MatchMoment {
  id: string;
  chat_room_id: string;
  game_id: string | null;
  user_id: string;
  user?: User;
  moment_type: string;
  minute: string | null;
  team_id: string | null;
  comment: string;
  media_url: string | null;
  is_pinned: boolean;
  created_at: string;
  reactions?: MomentReaction[];
}

export interface MomentReaction {
  id: string;
  moment_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface MediaClip {
  id: string;
  chat_room_id: string;
  game_id: string | null;
  user_id: string;
  user?: User;
  title: string;
  description: string;
  media_url: string;
  media_type: 'video' | 'image';
  thumbnail_url: string | null;
  duration_seconds: number | null;
  view_count: number;
  like_count: number;
  created_at: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  start_date: string | null;
  end_date: string | null;
  config: Record<string, any>;
}
