# World Cup Feature Export

Comprehensive extraction document for rebuilding the World Cup feature in a new sports app.
Extracted from the SkyConnect codebase (React Native / Expo / Supabase).

---

## 1. Overview

- **Tournament**: FIFA World Cup 2026, USA/Canada/Mexico, June 11 - July 19
- **Scale**: 48 teams, 104 matches, 16 venues
- **Feature scope**:
  - Match schedules with filtering (all/my teams/today/upcoming, stage filter)
  - Team following with AsyncStorage-first + Supabase sync
  - Watch parties (create, RSVP, map, moderation)
  - Fan groups (worldcup-typed chat rooms with template picker)
  - Match moments (structured fan-posted moment cards with reactions)
  - Media clips (video/image highlights grid with uploads)
  - Remote config for live data updates without app release
  - Fan group detail screen with Chat / Moments / Highlights sub-tabs

---

## 2. Architecture

**Tab**: World Cup (Trophy icon from lucide-react-native) in bottom navigation bar.

**3 sub-tabs**: Schedule, Watch Parties, Fan Groups

**State management**:
- AsyncStorage for team follows (instant load on mount)
- Supabase sync for persistence across devices
- Remote config check on mount via `world_cup_config` table (live scores override)
- City search auto-populated from user's flight destination
- Watch party enrichment with match data from static dataset

**Fan Group detail screen**: `app/fan-group/[id].tsx` with 3 sub-tabs (Chat, Moments, Highlights), team detection from group tags, real-time Supabase subscriptions for chat, media upload to `fan-media` storage bucket.

### Component Tree

```
worldcup.tsx (orchestrator)
├── WorldCupSubTabs (schedule | watchParties | fanGroups)
├── Schedule Tab
│   ├── ScheduleFilterBar (all/myTeams/today/upcoming + stage filter)
│   ├── MatchScheduleList (FlatList with date section headers)
│   │   └── MatchCard (team flags, scores, venue, stage badge)
│   └── EmptyWorldCupState (countdown timer, preview matches)
├── Watch Parties Tab
│   ├── WatchPartyCard (venue, match, RSVP status)
│   ├── WatchPartyMapModal (Leaflet.js WebView)
│   ├── WatchPartyDetailModal (RSVP buttons, attendee list, report)
│   └── CreateWatchPartyModal (3-step: venue->match->details)
├── Fan Groups Tab
│   └── FanGroupSection (create from template, join, categorized list)
│       └── WorldCupGroupTemplates (team-fans, match-watch, flight-fans, general)
└── TeamFollowModal (search, grouped by tournament group A-L)

Fan Group Detail: app/fan-group/[id].tsx
├── FanGroupHeader
├── FanGroupSubTabs (chat | moments | highlights)
├── FanGroupChat
├── MomentsFeed + MomentCard + CreateMomentModal
├── HighlightsGrid
└── VideoPlayerModal
```

---

## 3. Database Schema

### 3a. Sprint 7 Base Schema (watch_parties, watch_party_rsvps, users.favorite_teams)

Migration file: `supabase/migrations/20260217000000_sprint7_schema.sql`

```sql
-- Sprint 7: World Cup Experience Schema
-- Adds watch_parties, watch_party_rsvps tables
-- Extends users with favorite_teams, chat_rooms with worldcup group_type

-- 1. Add favorite_teams column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_teams TEXT[] DEFAULT '{}';

-- 2. Watch parties table
CREATE TABLE IF NOT EXISTS watch_parties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_name TEXT NOT NULL,
  venue_lat DOUBLE PRECISION,
  venue_lon DOUBLE PRECISION,
  venue_address TEXT,
  venue_city TEXT,
  match_id TEXT NOT NULL,
  atmosphere TEXT DEFAULT 'casual' CHECK (atmosphere IN ('casual', 'lively', 'family', 'intense', 'vip')),
  capacity INTEGER DEFAULT 50,
  rsvp_required BOOLEAN DEFAULT false,
  screening_matches TEXT[] DEFAULT '{}',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Watch party RSVPs table
CREATE TABLE IF NOT EXISTS watch_party_rsvps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  watch_party_id UUID NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'interested', 'declined')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(watch_party_id, user_id)
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_watch_parties_match_id ON watch_parties(match_id);
CREATE INDEX IF NOT EXISTS idx_watch_parties_venue_city ON watch_parties(venue_city);
CREATE INDEX IF NOT EXISTS idx_watch_parties_created_by ON watch_parties(created_by);
CREATE INDEX IF NOT EXISTS idx_watch_party_rsvps_party ON watch_party_rsvps(watch_party_id);
CREATE INDEX IF NOT EXISTS idx_watch_party_rsvps_user ON watch_party_rsvps(user_id);

-- 5. RLS policies for watch_parties
ALTER TABLE watch_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view watch parties"
  ON watch_parties FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create watch parties"
  ON watch_parties FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Creators can update their watch parties"
  ON watch_parties FOR UPDATE
  USING (created_by = (SELECT id FROM users WHERE uid = auth.uid()));

CREATE POLICY "Creators can delete their watch parties"
  ON watch_parties FOR DELETE
  USING (created_by = (SELECT id FROM users WHERE uid = auth.uid()));

-- 6. RLS policies for watch_party_rsvps
ALTER TABLE watch_party_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view RSVPs"
  ON watch_party_rsvps FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can RSVP"
  ON watch_party_rsvps FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update their own RSVPs"
  ON watch_party_rsvps FOR UPDATE
  USING (user_id = (SELECT id FROM users WHERE uid = auth.uid()));

CREATE POLICY "Users can delete their own RSVPs"
  ON watch_party_rsvps FOR DELETE
  USING (user_id = (SELECT id FROM users WHERE uid = auth.uid()));

-- 7. Updated_at trigger for watch_parties
CREATE OR REPLACE FUNCTION update_watch_parties_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_watch_parties_updated_at ON watch_parties;
CREATE TRIGGER trigger_watch_parties_updated_at
  BEFORE UPDATE ON watch_parties
  FOR EACH ROW
  EXECUTE FUNCTION update_watch_parties_updated_at();
```

### 3b. Moderation Schema (watch_party_flags, RPCs)

Migration file: `supabase/migrations/20260217200000_fix_remaining_bugs.sql`

```sql
-- Sprint 7 Bug Fixes: SKYC-63, SKYC-68, SKYC-69
-- 1. Capacity-enforced RSVP function
-- 2. Moderation columns + policies for watch parties
-- 3. match_id validation via known prefix constraint

-- =============================================================================
-- SKYC-63: Server-side capacity enforcement on RSVPs
-- =============================================================================

CREATE OR REPLACE FUNCTION rsvp_to_watch_party(
  p_watch_party_id UUID,
  p_user_id UUID,
  p_status TEXT
) RETURNS TEXT AS $$
DECLARE
  v_capacity INTEGER;
  v_going_count INTEGER;
  v_existing_id UUID;
  v_existing_status TEXT;
BEGIN
  -- Validate status
  IF p_status NOT IN ('going', 'interested', 'declined') THEN
    RETURN 'invalid_status';
  END IF;

  -- Check if party exists and get capacity
  SELECT capacity INTO v_capacity
    FROM watch_parties
    WHERE id = p_watch_party_id AND moderation_status != 'removed';

  IF NOT FOUND THEN
    RETURN 'party_not_found';
  END IF;

  -- Check for existing RSVP
  SELECT id, status INTO v_existing_id, v_existing_status
    FROM watch_party_rsvps
    WHERE watch_party_id = p_watch_party_id AND user_id = p_user_id;

  IF v_existing_id IS NOT NULL THEN
    -- Update existing RSVP
    -- If changing TO going, check capacity
    IF p_status = 'going' AND v_existing_status != 'going' AND v_capacity IS NOT NULL THEN
      SELECT COUNT(*) INTO v_going_count
        FROM watch_party_rsvps
        WHERE watch_party_id = p_watch_party_id AND status = 'going';

      IF v_going_count >= v_capacity THEN
        RETURN 'at_capacity';
      END IF;
    END IF;

    UPDATE watch_party_rsvps SET status = p_status WHERE id = v_existing_id;
    RETURN 'updated';
  ELSE
    -- New RSVP — check capacity if going
    IF p_status = 'going' AND v_capacity IS NOT NULL THEN
      SELECT COUNT(*) INTO v_going_count
        FROM watch_party_rsvps
        WHERE watch_party_id = p_watch_party_id AND status = 'going';

      IF v_going_count >= v_capacity THEN
        RETURN 'at_capacity';
      END IF;
    END IF;

    INSERT INTO watch_party_rsvps (watch_party_id, user_id, status)
      VALUES (p_watch_party_id, p_user_id, p_status);
    RETURN 'created';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- SKYC-68: Moderation controls for watch parties
-- =============================================================================

ALTER TABLE watch_parties ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT false;
ALTER TABLE watch_parties ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'active'
  CHECK (moderation_status IN ('active', 'flagged', 'removed'));
ALTER TABLE watch_parties ADD COLUMN IF NOT EXISTS flag_count INTEGER DEFAULT 0;

-- Table to track who flagged what (prevent duplicate flags)
CREATE TABLE IF NOT EXISTS watch_party_flags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  watch_party_id UUID NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
  flagged_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('inappropriate', 'spam', 'misleading', 'offensive', 'other')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(watch_party_id, flagged_by)
);

ALTER TABLE watch_party_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own flags"
  ON watch_party_flags FOR SELECT
  USING (flagged_by = (SELECT id FROM users WHERE uid = auth.uid()));

CREATE POLICY "Authenticated users can flag"
  ON watch_party_flags FOR INSERT
  WITH CHECK (flagged_by = (SELECT id FROM users WHERE uid = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_watch_party_flags_party ON watch_party_flags(watch_party_id);

-- RPC to flag a watch party (increments count, auto-removes at 3 flags)
CREATE OR REPLACE FUNCTION flag_watch_party(
  p_watch_party_id UUID,
  p_user_id UUID,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  -- Insert flag (will fail on duplicate due to UNIQUE constraint)
  BEGIN
    INSERT INTO watch_party_flags (watch_party_id, flagged_by, reason, notes)
      VALUES (p_watch_party_id, p_user_id, p_reason, p_notes);
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_flagged';
  END;

  -- Increment flag count
  UPDATE watch_parties
    SET flag_count = flag_count + 1,
        is_flagged = true,
        moderation_status = CASE
          WHEN flag_count + 1 >= 3 THEN 'removed'
          ELSE 'flagged'
        END
    WHERE id = p_watch_party_id
    RETURNING flag_count INTO v_new_count;

  IF v_new_count >= 3 THEN
    RETURN 'auto_removed';
  END IF;

  RETURN 'flagged';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update SELECT policy to hide removed parties
DROP POLICY IF EXISTS "Anyone can view watch parties" ON watch_parties;
CREATE POLICY "Anyone can view active watch parties"
  ON watch_parties FOR SELECT
  USING (moderation_status != 'removed');

-- =============================================================================
-- SKYC-69: match_id validation via prefix constraint
-- =============================================================================
-- Valid match IDs follow patterns: gs-N, r32-N, r16-N, qf-N, sf-N, tp-1, final-1
ALTER TABLE watch_parties ADD CONSTRAINT valid_match_id_format
  CHECK (match_id ~ '^(gs|r32|r16|qf|sf|tp|final)-\d+$');
```

### 3c. World Cup Remote Config

Migration file: `supabase/migrations/20260217300000_worldcup_remote_config.sql`

```sql
-- SKYC-67: Remote data update mechanism for World Cup match data
-- This table stores updated team/match/venue data that the app fetches on launch.
-- When the FIFA draw happens or qualifiers conclude, an admin updates this table
-- and all app instances pick up the changes without a new app release.

CREATE TABLE IF NOT EXISTS world_cup_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data_version TEXT NOT NULL DEFAULT '1.0',
  teams_json JSONB,
  venues_json JSONB,
  matches_json JSONB,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Anyone can read config (no auth required for public data)
ALTER TABLE world_cup_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read world cup config"
  ON world_cup_config FOR SELECT
  USING (true);

-- Only service_role can insert/update (admin-only via Supabase dashboard or API)
-- No INSERT/UPDATE/DELETE policies for anon/authenticated = effectively admin-only
```

### 3d. Group Type Constraint (includes 'worldcup')

Migration file: `supabase/migrations/20260222000000_add_worldcup_group_type.sql`

```sql
-- Fix: Add 'worldcup' to chat_rooms.group_type CHECK constraint
-- Sprint 7 added World Cup fan groups but never updated the constraint from Sprint 4.
-- This caused all fan group creation to silently fail.

-- Drop the old constraint (named after the column by default)
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_group_type_check;

-- Re-add with 'worldcup' included
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_group_type_check
  CHECK (group_type IN ('conference','family','sports','interest','flight','destination','custom','worldcup'));
```

### 3e. Fan Group Engagement (match_moments, moment_reactions, media_clips, fan-media bucket)

Migration file: `supabase/migrations/20260308000000_fan_group_engagement.sql`

```sql
-- =============================================================================
-- Fan Group Engagement: match moments, reactions, media clips
-- =============================================================================

-- 1. match_moments — structured fan-posted moment cards
CREATE TABLE IF NOT EXISTS match_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT, -- references worldCupData match id
  team_code TEXT, -- 3-letter FIFA code
  minute INTEGER, -- match minute
  moment_type TEXT NOT NULL DEFAULT 'other'
    CHECK (moment_type IN ('goal','save','penalty','foul','celebration','red_card','yellow_card','var','other')),
  comment TEXT,
  media_url TEXT,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_moments_room ON match_moments(chat_room_id, created_at DESC);
CREATE INDEX idx_match_moments_match ON match_moments(match_id) WHERE match_id IS NOT NULL;

-- 2. moment_reactions — emoji reactions on moments
CREATE TABLE IF NOT EXISTS moment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id UUID NOT NULL REFERENCES match_moments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(moment_id, user_id, emoji)
);

CREATE INDEX idx_moment_reactions_moment ON moment_reactions(moment_id);

-- 3. media_clips — video/image clips for highlights grid
CREATE TABLE IF NOT EXISTS media_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  thumbnail_url TEXT,
  media_type TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video','image')),
  duration_seconds REAL,
  caption TEXT,
  match_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_clips_room ON media_clips(chat_room_id, created_at DESC);

-- 4. Extend messages.type constraint to include 'video' and 'moment'
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text','system','image','file','video','moment'));

-- 5. RLS policies

ALTER TABLE match_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE moment_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_clips ENABLE ROW LEVEL SECURITY;

-- match_moments: authenticated can read, insert; owner can delete; admin can pin
CREATE POLICY "Authenticated users can read match moments"
  ON match_moments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert match moments"
  ON match_moments FOR INSERT TO authenticated WITH CHECK (auth.uid() IN (
    SELECT uid FROM users WHERE id = match_moments.user_id
  ));

CREATE POLICY "Owner can delete their match moments"
  ON match_moments FOR DELETE TO authenticated USING (auth.uid() IN (
    SELECT uid FROM users WHERE id = match_moments.user_id
  ));

CREATE POLICY "Admin can update match moments for pinning"
  ON match_moments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- moment_reactions: authenticated read/insert, owner delete
CREATE POLICY "Authenticated users can read moment reactions"
  ON moment_reactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert moment reactions"
  ON moment_reactions FOR INSERT TO authenticated WITH CHECK (auth.uid() IN (
    SELECT uid FROM users WHERE id = moment_reactions.user_id
  ));

CREATE POLICY "Owner can delete their reactions"
  ON moment_reactions FOR DELETE TO authenticated USING (auth.uid() IN (
    SELECT uid FROM users WHERE id = moment_reactions.user_id
  ));

-- media_clips: authenticated read/insert, owner delete
CREATE POLICY "Authenticated users can read media clips"
  ON media_clips FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert media clips"
  ON media_clips FOR INSERT TO authenticated WITH CHECK (auth.uid() IN (
    SELECT uid FROM users WHERE id = media_clips.user_id
  ));

CREATE POLICY "Owner can delete their media clips"
  ON media_clips FOR DELETE TO authenticated USING (auth.uid() IN (
    SELECT uid FROM users WHERE id = media_clips.user_id
  ));

-- 6. Storage bucket for fan media uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('fan-media', 'fan-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload fan media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fan-media');

CREATE POLICY "Anyone can read fan media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fan-media');

CREATE POLICY "Owner can delete their fan media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fan-media' AND auth.uid()::text = (storage.foldername(name))[1]::text);
```

---

## 4. Data Models (TypeScript Interfaces)

### From `data/worldCupData.ts`

```typescript
export interface WorldCupTeam {
  code: string;       // 3-letter FIFA code, e.g. 'USA'
  name: string;       // Full name, e.g. 'United States'
  group: string;      // Tournament group letter, e.g. 'A'
  flag: string;       // Emoji flag, e.g. '\ud83c\uddfa\ud83c\uddf8'
  confederation: 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC';
}

export interface WorldCupVenue {
  id: string;         // e.g. 'metlife'
  name: string;       // e.g. 'MetLife Stadium'
  city: string;       // e.g. 'East Rutherford, NJ'
  country: string;    // 'USA', 'Canada', or 'Mexico'
  capacity: number;   // e.g. 82500
  lat: number;
  lon: number;
  timezone: string;   // e.g. 'America/New_York'
}

export type MatchStage =
  | 'Group'
  | 'Round of 32'
  | 'Round of 16'
  | 'Quarter-final'
  | 'Semi-final'
  | 'Third Place'
  | 'Final';

export interface WorldCupMatch {
  id: string;            // e.g. 'gs-1', 'r32-5', 'final-1'
  matchNumber: number;   // Sequential match number (1-104)
  stage: MatchStage;
  group?: string;        // Group letter for group-stage matches
  homeTeam: string;      // 3-letter FIFA code
  awayTeam: string;      // 3-letter FIFA code
  venue: string;         // Venue id
  date: string;          // 'YYYY-MM-DD'
  time: string;          // 'HH:MM' (local venue time)
  completed: boolean;
  homeScore?: number;
  awayScore?: number;
}
```

### From `utils/worldCupApi.ts`

```typescript
export interface WatchPartyVenue {
  id: string;
  name: string;
  type: 'bar' | 'pub' | 'restaurant' | 'sports_bar' | 'cafe';
  lat: number;
  lon: number;
  distance: number;    // km from search center
  address?: string;
  openHours?: string;
  hasTV?: boolean;
  capacity?: string;
}
```

### From `components/worldcup/WatchPartyCard.tsx`

```typescript
export interface WatchPartyData {
  id: string;
  venue_name: string;
  venue_city?: string;
  match_id: string;
  atmosphere?: string;
  capacity?: number;
  rsvp_count?: number;
  distance?: number;
  created_by_name?: string;
  homeTeam?: string;
  awayTeam?: string;
  matchDate?: string;
}
```

### From `utils/fanGroupService.ts`

```typescript
export interface MatchMoment {
  id: string;
  chat_room_id: string;
  user_id: string;
  match_id?: string;
  team_code?: string;
  minute?: number;
  moment_type: string;   // 'goal' | 'save' | 'penalty' | 'foul' | 'celebration' | 'red_card' | 'yellow_card' | 'var' | 'other'
  comment?: string;
  media_url?: string;
  pinned: boolean;
  created_at: string;
  user?: { id: string; uid: string; name: string; profile_image?: string };
  reactions?: { emoji: string; count: number; user_reacted: boolean }[];
}

export interface MediaClip {
  id: string;
  chat_room_id: string;
  user_id: string;
  media_url: string;
  thumbnail_url?: string;
  media_type: 'video' | 'image';
  duration_seconds?: number;
  caption?: string;
  match_id?: string;
  created_at: string;
  user?: { id: string; uid: string; name: string; profile_image?: string };
}
```

### From `utils/worldCupDataSync.ts`

```typescript
export interface WorldCupDataBundle {
  teams: WorldCupTeam[];
  venues: WorldCupVenue[];
  matches: WorldCupMatch[];
  lastUpdated: string;
  source: 'remote' | 'cache' | 'static';
}
```

---

## 5. Static Data

The full static data (48 teams, 16 venues, 104 matches) lives in `data/worldCupData.ts`. Exported constants are `WORLD_CUP_TEAMS`, `WORLD_CUP_VENUES`, and `WORLD_CUP_MATCHES`.

### 48 Teams (12 groups of 4)

| Group | Team 1 | Team 2 | Team 3 | Team 4 |
|-------|--------|--------|--------|--------|
| A | USA | Wales | Chile | Nigeria |
| B | England | Iran | Mexico | Senegal |
| C | Argentina | Poland | Saudi Arabia | Canada |
| D | France | Australia | Peru | Morocco |
| E | Brazil | Japan | Costa Rica | Cameroon |
| F | Spain | Croatia | Ecuador | South Korea |
| G | Germany | Colombia | Egypt | Jamaica |
| H | Portugal | Uruguay | Ghana | Uzbekistan |
| I | Netherlands | Switzerland | Paraguay | Cote d'Ivoire |
| J | Belgium | Denmark | Venezuela | Tunisia |
| K | Italy | Serbia | Algeria | New Zealand |
| L | Bolivia | Austria | Qatar | South Africa |

### 16 Venues

| Venue | City | Country | Capacity |
|-------|------|---------|----------|
| MetLife Stadium | East Rutherford, NJ | USA | 82,500 |
| Rose Bowl | Pasadena, CA | USA | 90,888 |
| AT&T Stadium | Arlington, TX | USA | 80,000 |
| Hard Rock Stadium | Miami Gardens, FL | USA | 64,767 |
| SoFi Stadium | Inglewood, CA | USA | 70,240 |
| Lumen Field | Seattle, WA | USA | 68,740 |
| Gillette Stadium | Foxborough, MA | USA | 65,878 |
| Lincoln Financial Field | Philadelphia, PA | USA | 69,176 |
| NRG Stadium | Houston, TX | USA | 72,220 |
| Mercedes-Benz Stadium | Atlanta, GA | USA | 71,000 |
| Arrowhead Stadium | Kansas City, MO | USA | 76,416 |
| BMO Field | Toronto, ON | Canada | 30,000 |
| BC Place | Vancouver, BC | Canada | 54,500 |
| Estadio Azteca | Mexico City | Mexico | 87,523 |
| Estadio BBVA | Monterrey | Mexico | 53,500 |
| Estadio Akron | Guadalajara | Mexico | 49,850 |

### Match Generation Logic

**Group stage**: 6 matches per group (round-robin of 4 teams), 3 match days = 72 group-stage matches total. Built via `buildGroupStageMatches()` which generates all combinations for each group and assigns venues round-robin from the venue pool.

**Knockout stage**: 16 Round of 32 + 8 Round of 16 + 4 Quarter-finals + 2 Semi-finals + 1 Third Place + 1 Final = 32 knockout matches. Built via `buildKnockoutMatches()` using placeholder team codes (e.g., "1A" = winner of Group A, "2A" = runner-up of Group A) and venue pool assignment.

**Match ID format**: `gs-{N}` for group stage, `r32-{N}` for Round of 32, `r16-{N}` for Round of 16, `qf-{N}` for Quarter-finals, `sf-{N}` for Semi-finals, `tp-1` for Third Place, `final-1` for Final. Validated by database constraint: `match_id ~ '^(gs|r32|r16|qf|sf|tp|final)-\d+$'`.

**Helper functions** exported from `worldCupData.ts`:
- `getTeamByCode(code: string): WorldCupTeam | undefined`
- `getVenueById(id: string): WorldCupVenue | undefined`
- `getMatchById(id: string): WorldCupMatch | undefined`
- `getMatchesByGroup(group: string): WorldCupMatch[]`
- `getMatchesByStage(stage: MatchStage): WorldCupMatch[]`
- `getMatchesByTeam(teamCode: string): WorldCupMatch[]`
- `getMatchesByDate(date: string): WorldCupMatch[]`
- `getUpcomingMatches(limit?: number): WorldCupMatch[]`
- `getTeamsByGroup(group: string): WorldCupTeam[]`

---

## 6. API Layer

### `utils/worldCupApi.ts`

Uses the Overpass API (OpenStreetMap) for watch party venue discovery and Nominatim for geocoding. Includes a 15-minute in-memory cache.

```typescript
import axios from 'axios';

export interface WatchPartyVenue {
  id: string;
  name: string;
  type: 'bar' | 'pub' | 'restaurant' | 'sports_bar' | 'cafe';
  lat: number;
  lon: number;
  distance: number;
  address?: string;
  openHours?: string;
  hasTV?: boolean;
  capacity?: string;
}

// 15-minute in-memory cache
const venueCache: Map<string, { data: WatchPartyVenue[]; timestamp: number }> = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Search for watch party venues (bars, pubs, sports bars) near a city
 * Uses Overpass API (OpenStreetMap) - free, no API key required
 */
export async function searchWatchPartyVenues(
  city: string,
  radiusKm: number = 5
): Promise<WatchPartyVenue[]> {
  const cacheKey = `${city}-${radiusKm}`;
  const cached = venueCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Step 1: Geocode the city name to lat/lon
  const coords = await geocodeCity(city);
  if (!coords) return [];

  // Step 2: Query Overpass for bars/pubs/restaurants near the coordinates
  const radiusMeters = radiusKm * 1000;
  const overpassQuery = `
    [out:json][timeout:15];
    (
      node["amenity"="bar"](around:${radiusMeters},${coords.lat},${coords.lon});
      node["amenity"="pub"](around:${radiusMeters},${coords.lat},${coords.lon});
      node["amenity"="restaurant"]["cuisine"~"american|burger|wings|pizza"](around:${radiusMeters},${coords.lat},${coords.lon});
      node["sport"="soccer"]["leisure"="sports_centre"](around:${radiusMeters},${coords.lat},${coords.lon});
      node["amenity"="cafe"]["internet_access"="wlan"](around:${radiusMeters},${coords.lat},${coords.lon});
    );
    out body;
  `;

  try {
    const response = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(overpassQuery)}`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );

    const venues: WatchPartyVenue[] = (response.data.elements || [])
      .filter((el: any) => el.tags?.name)
      .map((el: any) => {
        const amenity = el.tags.amenity || '';
        let type: WatchPartyVenue['type'] = 'bar';
        if (amenity === 'pub') type = 'pub';
        else if (amenity === 'restaurant') type = 'restaurant';
        else if (amenity === 'cafe') type = 'cafe';
        if (el.tags.sport === 'soccer' || el.tags.name?.toLowerCase().includes('sport'))
          type = 'sports_bar';

        const distance = getDistanceKm(coords.lat, coords.lon, el.lat, el.lon);

        return {
          id: String(el.id),
          name: el.tags.name,
          type,
          lat: el.lat,
          lon: el.lon,
          distance: Math.round(distance * 10) / 10,
          address: el.tags['addr:street']
            ? `${el.tags['addr:housenumber'] || ''} ${el.tags['addr:street']}`.trim()
            : undefined,
          openHours: el.tags.opening_hours || undefined,
          hasTV: el.tags.internet_access === 'wlan' || el.tags.sport !== undefined,
          capacity: el.tags.capacity || undefined,
        };
      })
      .sort((a: WatchPartyVenue, b: WatchPartyVenue) => a.distance - b.distance);

    venueCache.set(cacheKey, { data: venues, timestamp: Date.now() });
    return venues;
  } catch (error) {
    console.error('Error searching watch party venues:', error);
    return [];
  }
}

/**
 * Geocode a city name to lat/lon using Nominatim (OpenStreetMap)
 */
export async function geocodeCity(
  city: string
): Promise<{ lat: number; lon: number } | null> {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: city, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'SkyConnect/1.0' },
      timeout: 10000,
    });

    if (response.data.length > 0) {
      return {
        lat: parseFloat(response.data[0].lat),
        lon: parseFloat(response.data[0].lon),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Haversine distance in km */
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
```

### `utils/worldCupDataSync.ts` (Remote Config Sync)

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  WORLD_CUP_TEAMS,
  WORLD_CUP_VENUES,
  WORLD_CUP_MATCHES,
  WorldCupTeam,
  WorldCupVenue,
  WorldCupMatch,
} from '@/data/worldCupData';

const CACHE_KEY = '@skyconnect_wc_data_cache';
const CACHE_VERSION_KEY = '@skyconnect_wc_data_version';

export interface WorldCupDataBundle {
  teams: WorldCupTeam[];
  venues: WorldCupVenue[];
  matches: WorldCupMatch[];
  lastUpdated: string;
  source: 'remote' | 'cache' | 'static';
}

/**
 * Get the latest World Cup data.
 * Priority: remote Supabase > local AsyncStorage cache > static file
 */
export async function getWorldCupData(): Promise<WorldCupDataBundle> {
  // Try remote first
  try {
    const { data, error } = await supabase
      .from('world_cup_config')
      .select('data_version, teams_json, venues_json, matches_json, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data?.teams_json) {
      const cachedVersion = await AsyncStorage.getItem(CACHE_VERSION_KEY);
      const remoteVersion = data.data_version || data.updated_at;

      if (cachedVersion !== remoteVersion) {
        const bundle: WorldCupDataBundle = {
          teams: data.teams_json,
          venues: data.venues_json || WORLD_CUP_VENUES,
          matches: data.matches_json || WORLD_CUP_MATCHES,
          lastUpdated: data.updated_at,
          source: 'remote',
        };

        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(bundle));
        await AsyncStorage.setItem(CACHE_VERSION_KEY, remoteVersion);

        return bundle;
      }
    }
  } catch {
    // Remote fetch failed -- try cache
  }

  // Try local cache
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) {
      const bundle = JSON.parse(cached) as WorldCupDataBundle;
      return { ...bundle, source: 'cache' };
    }
  } catch {
    // Cache read failed -- use static
  }

  // Fall back to static data
  return {
    teams: WORLD_CUP_TEAMS,
    venues: WORLD_CUP_VENUES,
    matches: WORLD_CUP_MATCHES,
    lastUpdated: '2026-02-14',
    source: 'static',
  };
}

/**
 * Force refresh from remote (useful for pull-to-refresh scenarios)
 */
export async function refreshWorldCupData(): Promise<WorldCupDataBundle> {
  await AsyncStorage.removeItem(CACHE_VERSION_KEY);
  return getWorldCupData();
}
```

---

## 7. Components Inventory

### `components/worldcup/` directory (13 files)

| # | Component | File | Purpose |
|---|-----------|------|---------|
| 1 | `WorldCupSubTabs` | `WorldCupSubTabs.tsx` | 3-pill tab bar switching between schedule, watchParties, fanGroups |
| 2 | `ScheduleFilterBar` | `ScheduleFilterBar.tsx` | Filter chips (all / myTeams / today / upcoming) + horizontal scrollable stage filter (Group / Round of 32 / Round of 16 / QF / SF / Final) |
| 3 | `MatchCard` | `MatchCard.tsx` | Single match display: team emoji flags, team codes, scores (or "vs"), venue name, stage badge, date/time |
| 4 | `MatchScheduleList` | `MatchScheduleList.tsx` | FlatList with date-based section headers, renders MatchCard items, pull-to-refresh |
| 5 | `TeamFollowModal` | `TeamFollowModal.tsx` | Full-screen modal to search and follow/unfollow 48 teams, grouped by tournament group (A-L), star icons for followed state |
| 6 | `EmptyWorldCupState` | `EmptyWorldCupState.tsx` | Shown when no matches yet: countdown timer to kickoff, CTA to follow teams, opening match preview, host venue highlights |
| 7 | `WatchPartyCard` | `WatchPartyCard.tsx` | Card showing venue name, city, match (home vs away), RSVP count, atmosphere badge (casual/lively/family/intense/vip), distance |
| 8 | `CreateWatchPartyModal` | `CreateWatchPartyModal.tsx` | 3-step wizard: Step 1 = select venue (from Overpass API search), Step 2 = select match, Step 3 = set details (atmosphere, capacity, description) |
| 9 | `WatchPartyDetailModal` | `WatchPartyDetailModal.tsx` | Full party details view: venue info, match info, RSVP buttons (Going / Interested / Decline) via ActionSheet, attendee list with avatars, report/flag button |
| 10 | `WatchPartyMapModal` | `WatchPartyMapModal.tsx` | Leaflet.js map in react-native-webview showing venue pins. Uses `data:text/html;charset=utf-8,${encodeURIComponent(html)}` URI approach for Android WebView compatibility (NOT `source={{ html }}` which fails to load CDN resources) |
| 11 | `VenueInfoCard` | `VenueInfoCard.tsx` | Stadium info card: venue name, city, capacity, number of matches hosted |
| 12 | `WorldCupGroupTemplates` | `WorldCupGroupTemplates.tsx` | Template picker for creating fan groups: team-fans (e.g., "USA Fans"), match-watch (e.g., "USA vs Wales Watch"), flight-fans (fans on same flight), general |
| 13 | `FanGroupSection` | `FanGroupSection.tsx` | Main fan groups tab content: create group button, join existing groups, categorized list (team groups, match groups, general) |

### `components/fan-group/` directory (8 files)

| # | Component | File | Purpose |
|---|-----------|------|---------|
| 1 | `FanGroupHeader` | `FanGroupHeader.tsx` | Group header with team flag/name context, next upcoming match info, member count |
| 2 | `FanGroupSubTabs` | `FanGroupSubTabs.tsx` | 3-tab switcher (Chat / Moments / Highlights) |
| 3 | `FanGroupChat` | `FanGroupChat.tsx` | Chat interface reusing the existing messaging system, real-time Supabase subscriptions |
| 4 | `MomentsFeed` | `MomentsFeed.tsx` | Scrollable feed of match moments sorted by created_at, pull-to-refresh, pinned moments at top |
| 5 | `MomentCard` | `MomentCard.tsx` | Single moment display: moment type icon/badge, match minute, team code, comment, media thumbnail, emoji reaction row |
| 6 | `CreateMomentModal` | `CreateMomentModal.tsx` | Form to create a match moment: select moment type, match, team, minute, add comment, optional media upload |
| 7 | `HighlightsGrid` | `HighlightsGrid.tsx` | Grid layout of media clips (video thumbnails with play icon overlay, images), tap to open VideoPlayerModal |
| 8 | `VideoPlayerModal` | `VideoPlayerModal.tsx` | Full-screen video player modal with playback controls |

### Other related files

| File | Purpose |
|------|---------|
| `utils/fanGroupService.ts` | Database functions: getMatchMoments, createMatchMoment, toggleMomentReaction, pinMoment, getMediaClips, uploadMediaClip. Also exports `REACTION_EMOJIS` constant. |
| `app/fan-group/[id].tsx` | Fan group detail screen (dynamic route). Orchestrates FanGroupHeader + FanGroupSubTabs + FanGroupChat/MomentsFeed/HighlightsGrid. |
| `components/GroupTemplatePickerModal.tsx` | Extended with `'worldcup'` group type and associated template |
| `components/BrowseGroupsModal.tsx` | Extended with `'World Cup'` in `GROUP_TYPE_FILTERS` |

---

## 8. Database Functions

### From `utils/database.ts` -- World Cup Functions

```typescript
// --- Sprint 7: World Cup functions ---

export const updateFavoriteTeams = async (userUid: string, teams: string[]): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ favorite_teams: teams })
      .eq('uid', userUid);

    if (error) {
      console.error('Error updating favorite teams:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error in updateFavoriteTeams:', error);
    return false;
  }
};

export const getFollowedTeams = async (userUid: string): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('favorite_teams')
      .eq('uid', userUid)
      .maybeSingle();

    if (error || !data) return [];
    return data.favorite_teams || [];
  } catch (error) {
    console.error('Error in getFollowedTeams:', error);
    return [];
  }
};

export const createWatchParty = async (
  userUid: string,
  partyData: {
    venue_name: string;
    venue_lat?: number;
    venue_lon?: number;
    venue_address?: string;
    venue_city?: string;
    match_id: string;
    atmosphere?: string;
    capacity?: number;
    rsvp_required?: boolean;
    description?: string;
  }
) => {
  try {
    const { data: userData } = await supabase
      .from('users').select('id').eq('uid', userUid).maybeSingle();
    if (!userData) return null;

    const { data, error } = await supabase
      .from('watch_parties')
      .insert([{
        created_by: userData.id,
        venue_name: partyData.venue_name,
        venue_lat: partyData.venue_lat || null,
        venue_lon: partyData.venue_lon || null,
        venue_address: partyData.venue_address || null,
        venue_city: partyData.venue_city || null,
        match_id: partyData.match_id,
        atmosphere: partyData.atmosphere || 'casual',
        capacity: partyData.capacity || 50,
        rsvp_required: partyData.rsvp_required || false,
        description: partyData.description || null,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating watch party:', error);
      return null;
    }

    // Auto-RSVP creator as going
    if (data) {
      await supabase.from('watch_party_rsvps').insert([{
        watch_party_id: data.id,
        user_id: userData.id,
        status: 'going',
      }]);
    }

    return data;
  } catch (error) {
    console.error('Error in createWatchParty:', error);
    return null;
  }
};

export const getWatchParties = async (city?: string, matchId?: string) => {
  try {
    let query = supabase
      .from('watch_parties')
      .select(`
        id, venue_name, venue_lat, venue_lon, venue_address, venue_city,
        match_id, atmosphere, capacity, rsvp_required, description, created_at,
        created_by_user:users!watch_parties_created_by_fkey(name),
        watch_party_rsvps(status)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (city) query = query.eq('venue_city', city);
    if (matchId) query = query.eq('match_id', matchId);

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching watch parties:', error);
      return [];
    }

    // Count RSVPs from the joined data instead of N+1 queries
    const enriched = (data || []).map((party: any) => {
      const rsvps = party.watch_party_rsvps || [];
      const goingCount = rsvps.filter((r: any) => r.status === 'going').length;

      return {
        ...party,
        rsvp_count: goingCount,
        created_by_name: Array.isArray(party.created_by_user)
          ? party.created_by_user[0]?.name
          : party.created_by_user?.name,
        watch_party_rsvps: undefined,
      };
    });

    return enriched;
  } catch (error) {
    console.error('Error in getWatchParties:', error);
    return [];
  }
};

export const getWatchPartyById = async (partyId: string) => {
  try {
    const { data, error } = await supabase
      .from('watch_parties')
      .select('*')
      .eq('id', partyId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching watch party:', error);
      return null;
    }
    return data;
  } catch (error) {
    console.error('Error in getWatchPartyById:', error);
    return null;
  }
};

export const rsvpToWatchParty = async (
  userUid: string,
  watchPartyId: string,
  status: 'going' | 'interested' | 'declined'
): Promise<{ success: boolean; reason?: string }> => {
  try {
    const { data: userData } = await supabase
      .from('users').select('id').eq('uid', userUid).maybeSingle();
    if (!userData) return { success: false, reason: 'user_not_found' };

    const { data, error } = await supabase.rpc('rsvp_to_watch_party', {
      p_watch_party_id: watchPartyId,
      p_user_id: userData.id,
      p_status: status,
    });

    if (error) {
      console.error('Error in rsvpToWatchParty RPC:', error);
      return { success: false, reason: 'rpc_error' };
    }

    const result = data as string;
    if (result === 'at_capacity') {
      return { success: false, reason: 'at_capacity' };
    }
    if (result === 'party_not_found') {
      return { success: false, reason: 'party_not_found' };
    }

    return { success: true, reason: result };
  } catch (error) {
    console.error('Error in rsvpToWatchParty:', error);
    return { success: false, reason: 'unknown' };
  }
};

export const getWatchPartyRsvps = async (watchPartyId: string) => {
  try {
    const { data, error } = await supabase
      .from('watch_party_rsvps')
      .select(`
        id, status, created_at,
        user:users!watch_party_rsvps_user_id_fkey(uid, name, profile_image)
      `)
      .eq('watch_party_id', watchPartyId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching RSVPs:', error);
      return [];
    }

    return (data || []).map((r: any) => ({
      ...r,
      user: Array.isArray(r.user) ? r.user[0] : r.user,
    }));
  } catch (error) {
    console.error('Error in getWatchPartyRsvps:', error);
    return [];
  }
};

export const getUserWatchPartyRsvps = async (userUid: string) => {
  try {
    const { data: userData } = await supabase
      .from('users').select('id').eq('uid', userUid).maybeSingle();
    if (!userData) return [];

    const { data, error } = await supabase
      .from('watch_party_rsvps')
      .select('watch_party_id, status')
      .eq('user_id', userData.id);

    if (error) {
      console.error('Error fetching user RSVPs:', error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error('Error in getUserWatchPartyRsvps:', error);
    return [];
  }
};

export const createWorldCupGroup = async (
  name: string,
  description: string,
  userUid: string,
  tags: string[] = [],
  flightNumber?: string
) => {
  return createGroupChatWithTemplate(name, description, [], userUid, {
    groupType: 'worldcup',
    visibility: 'public',
    tags: ['worldcup', ...tags],
    flightNumber,
    maxMembers: 100,
  });
};

export const browseWorldCupGroups = async (search?: string) => {
  return browsePublicGroups(search, 'worldcup');
};

// SKYC-68: Flag a watch party for moderation
export const flagWatchParty = async (
  userUid: string,
  watchPartyId: string,
  reason: 'inappropriate' | 'spam' | 'misleading' | 'offensive' | 'other',
  notes?: string
): Promise<{ success: boolean; result?: string }> => {
  try {
    const { data: userData } = await supabase
      .from('users').select('id').eq('uid', userUid).maybeSingle();
    if (!userData) return { success: false };

    const { data, error } = await supabase.rpc('flag_watch_party', {
      p_watch_party_id: watchPartyId,
      p_user_id: userData.id,
      p_reason: reason,
      p_notes: notes || null,
    });

    if (error) {
      console.error('Error flagging watch party:', error);
      return { success: false };
    }

    return { success: true, result: data as string };
  } catch (error) {
    console.error('Error in flagWatchParty:', error);
    return { success: false };
  }
};

// SKYC-67: Fetch remote World Cup config for live score/data updates
export const getWorldCupRemoteConfig = async (): Promise<{
  dataVersion: string;
  matches?: any[];
  teams?: any[];
  venues?: any[];
} | null> => {
  try {
    const { data, error } = await supabase
      .from('world_cup_config')
      .select('data_version, teams_json, venues_json, matches_json')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    return {
      dataVersion: data.data_version,
      matches: data.matches_json || undefined,
      teams: data.teams_json || undefined,
      venues: data.venues_json || undefined,
    };
  } catch (error) {
    console.error('Error fetching world cup remote config:', error);
    return null;
  }
};
```

### From `utils/fanGroupService.ts` -- Fan Group Engagement Functions

```typescript
import { supabase } from './supabase';
import { MatchMoment, MediaClip } from './fanGroupService'; // self-reference for types

export const REACTION_EMOJIS = ['🔥', '⚽', '❤️', '😂', '😮', '👏', '🏆', '🇺🇸'];

// Get match moments for a fan group
export const getMatchMoments = async (
  chatRoomId: string,
  matchId?: string,
  limit: number = 50
): Promise<MatchMoment[]> => {
  try {
    let query = supabase
      .from('match_moments')
      .select(`
        id, chat_room_id, user_id, match_id, team_code, minute,
        moment_type, comment, media_url, pinned, created_at,
        user:users!match_moments_user_id_fkey(id, uid, name, profile_image)
      `)
      .eq('chat_room_id', chatRoomId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (matchId) query = query.eq('match_id', matchId);

    const { data, error } = await query;
    if (error) { console.error('Error fetching moments:', error); return []; }

    // Fetch reactions for all moments
    const momentIds = (data || []).map((m: any) => m.id);
    const { data: reactions } = await supabase
      .from('moment_reactions')
      .select('moment_id, emoji, user_id')
      .in('moment_id', momentIds);

    // Group reactions by moment
    return (data || []).map((m: any) => {
      const momentReactions = (reactions || []).filter((r: any) => r.moment_id === m.id);
      const emojiCounts: Record<string, { count: number; users: string[] }> = {};
      momentReactions.forEach((r: any) => {
        if (!emojiCounts[r.emoji]) emojiCounts[r.emoji] = { count: 0, users: [] };
        emojiCounts[r.emoji].count++;
        emojiCounts[r.emoji].users.push(r.user_id);
      });

      return {
        ...m,
        user: Array.isArray(m.user) ? m.user[0] : m.user,
        reactions: Object.entries(emojiCounts).map(([emoji, data]) => ({
          emoji,
          count: data.count,
          user_reacted: false, // caller sets this based on current user
        })),
      };
    });
  } catch (error) {
    console.error('Error in getMatchMoments:', error);
    return [];
  }
};

// Create a match moment
export const createMatchMoment = async (
  chatRoomId: string,
  userId: string,
  moment: {
    match_id?: string;
    team_code?: string;
    minute?: number;
    moment_type: string;
    comment?: string;
    media_url?: string;
  }
): Promise<MatchMoment | null> => {
  try {
    const { data: userData } = await supabase
      .from('users').select('id').eq('uid', userId).maybeSingle();
    if (!userData) return null;

    const { data, error } = await supabase
      .from('match_moments')
      .insert([{
        chat_room_id: chatRoomId,
        user_id: userData.id,
        ...moment,
      }])
      .select()
      .single();

    if (error) { console.error('Error creating moment:', error); return null; }
    return data;
  } catch (error) {
    console.error('Error in createMatchMoment:', error);
    return null;
  }
};

// Toggle emoji reaction on a moment
export const toggleMomentReaction = async (
  momentId: string,
  userUid: string,
  emoji: string
): Promise<boolean> => {
  try {
    const { data: userData } = await supabase
      .from('users').select('id').eq('uid', userUid).maybeSingle();
    if (!userData) return false;

    // Check if reaction exists
    const { data: existing } = await supabase
      .from('moment_reactions')
      .select('id')
      .eq('moment_id', momentId)
      .eq('user_id', userData.id)
      .eq('emoji', emoji)
      .maybeSingle();

    if (existing) {
      // Remove reaction
      await supabase.from('moment_reactions').delete().eq('id', existing.id);
    } else {
      // Add reaction
      await supabase.from('moment_reactions').insert([{
        moment_id: momentId,
        user_id: userData.id,
        emoji,
      }]);
    }
    return true;
  } catch (error) {
    console.error('Error in toggleMomentReaction:', error);
    return false;
  }
};

// Pin/unpin a moment (admin action)
export const pinMoment = async (momentId: string, pinned: boolean): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('match_moments')
      .update({ pinned })
      .eq('id', momentId);
    if (error) { console.error('Error pinning moment:', error); return false; }
    return true;
  } catch (error) {
    console.error('Error in pinMoment:', error);
    return false;
  }
};

// Get media clips for a fan group
export const getMediaClips = async (
  chatRoomId: string,
  limit: number = 50
): Promise<MediaClip[]> => {
  try {
    const { data, error } = await supabase
      .from('media_clips')
      .select(`
        id, chat_room_id, user_id, media_url, thumbnail_url,
        media_type, duration_seconds, caption, match_id, created_at,
        user:users!media_clips_user_id_fkey(id, uid, name, profile_image)
      `)
      .eq('chat_room_id', chatRoomId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) { console.error('Error fetching clips:', error); return []; }

    return (data || []).map((c: any) => ({
      ...c,
      user: Array.isArray(c.user) ? c.user[0] : c.user,
    }));
  } catch (error) {
    console.error('Error in getMediaClips:', error);
    return [];
  }
};

// Upload a media clip
export const uploadMediaClip = async (
  chatRoomId: string,
  userUid: string,
  clip: {
    media_url: string;
    thumbnail_url?: string;
    media_type: 'video' | 'image';
    duration_seconds?: number;
    caption?: string;
    match_id?: string;
  }
): Promise<MediaClip | null> => {
  try {
    const { data: userData } = await supabase
      .from('users').select('id').eq('uid', userUid).maybeSingle();
    if (!userData) return null;

    const { data, error } = await supabase
      .from('media_clips')
      .insert([{
        chat_room_id: chatRoomId,
        user_id: userData.id,
        ...clip,
      }])
      .select()
      .single();

    if (error) { console.error('Error uploading clip:', error); return null; }
    return data;
  } catch (error) {
    console.error('Error in uploadMediaClip:', error);
    return null;
  }
};
```

---

## 9. Screen Logic

### `worldcup.tsx` Orchestrator -- Key Patterns

1. **AsyncStorage-first team following**: On mount, load followed teams from `AsyncStorage.getItem('@skyconnect_followed_teams')` for instant display, then sync from Supabase `getFollowedTeams(userUid)` in background. On follow/unfollow, write to both AsyncStorage and Supabase via `updateFavoriteTeams()`.

2. **Remote config check on mount**: Call `getWorldCupData()` from `worldCupDataSync.ts` which checks `world_cup_config` table for updated match data (live scores). Falls back to cached data, then static data.

3. **City search auto-populated**: The Watch Parties tab pre-fills the city search from the user's flight destination (if available from their uploaded boarding pass / flight data).

4. **Watch party enrichment**: After fetching watch parties from Supabase, each party's `match_id` is resolved against the static `WORLD_CUP_MATCHES` data to populate `homeTeam`, `awayTeam`, `matchDate` fields on the `WatchPartyData` interface.

5. **RSVP via ActionSheet** (SKYC-70): Tapping RSVP opens a native ActionSheet with options: "Going", "Interested", "Can't Make It", "Cancel". Calls `rsvpToWatchParty()` RPC which enforces capacity server-side.

6. **Report/flag flow** (SKYC-68): Long-press or ellipsis menu on a watch party opens a report modal with reason picker (inappropriate, spam, misleading, offensive, other) + optional notes. Calls `flagWatchParty()` RPC. Auto-removes party at 3 flags.

### `app/fan-group/[id].tsx` -- Fan Group Detail

1. **3 sub-tabs**: Chat, Moments, Highlights. Managed via `FanGroupSubTabs` component with local state.

2. **Team detection**: Parses group `tags` array for team codes (3-letter FIFA codes) to display team context in the header and filter moments by relevant team.

3. **Real-time Supabase subscriptions**: Chat tab subscribes to `supabase.channel('room-{id}').on('postgres_changes', ...)` for live message updates. Moments tab can subscribe similarly for live moment cards during matches.

4. **Media upload**: Uses `fan-media` Supabase storage bucket. Upload path pattern: `{userUid}/{timestamp}-{filename}`. Storage policies enforce owner-only delete via `storage.foldername(name)[1]` matching `auth.uid()`.

---

## 10. Jira Stories

### Sprint 7 -- World Cup Experience (18 story points)

| Story | Title | Points |
|-------|-------|--------|
| SKYC-55 | Match Schedule & Team Following | 5 |
| SKYC-56 | Watch Parties | 8 |
| SKYC-57 | Fan Groups | 5 |

### Related Bug Fixes

| Issue | Title |
|-------|-------|
| SKYC-63 | Watch party capacity enforcement (server-side RSVP RPC) |
| SKYC-66 | Schedule preview in empty state |
| SKYC-67 | Remote config for live data updates |
| SKYC-68 | Watch party moderation (flag/report, auto-remove at 3 flags) |
| SKYC-69 | match_id format validation constraint |
| SKYC-70 | RSVP UX via ActionSheet |
| SKYC-71 | Team picker improvements |

### Fan Group Engagement (Sprint 7.5)

- Match Moments (structured moment cards with type, minute, team)
- Moment Reactions (emoji toggle reactions)
- Media Clips (video/image uploads to highlights grid)
- Fan Group Detail Screen with Chat / Moments / Highlights sub-tabs

---

## 11. Dependencies

| Package | Purpose |
|---------|---------|
| `axios` | HTTP client for Overpass API and Nominatim geocoding |
| `expo-linear-gradient` | Green gradient header on World Cup tab |
| `react-native-webview` | Leaflet.js map rendering in WatchPartyMapModal |
| `@react-native-async-storage/async-storage` | Team follows cache, World Cup data cache |
| `lucide-react-native` | Icons: Trophy, Star, Map, Search, Tv, Calendar, MapPin, Users, Plus, Flag, ChevronRight, Play, Camera, etc. |
| `react-native-safe-area-context` | SafeAreaView in modals |
| `expo-router` | Navigation (tab routing, dynamic `fan-group/[id]` route) |
| `@supabase/supabase-js` | Database client, real-time subscriptions, storage uploads |

---

## 12. Integration Points (for Rebuilding)

These are the touch points where the World Cup feature connects to the broader app. When rebuilding in a new sports app, these are the interfaces you need to implement or replace:

1. **`users.favorite_teams` column** -- TEXT[] on the users table for followed teams. Your user model needs this field.

2. **`chat_rooms.group_type = 'worldcup'`** -- Fan groups are worldcup-typed chat rooms. The existing group chat system (rooms, members, messages) is reused. Your chat/group system needs a type discriminator.

3. **`createGroupChatWithTemplate()`** -- Reused for creating worldcup groups. Handles room creation, member addition, system message. You need a group creation function.

4. **`browsePublicGroups(search, 'worldcup')`** -- Filters public groups by type. You need a group discovery/browse function.

5. **Supabase Realtime** -- Chat subscriptions via `supabase.channel().on('postgres_changes', ...)`. Replace with your real-time system (WebSocket, Firebase, etc.).

6. **`fan-media` storage bucket** -- Supabase Storage for user media uploads (moments, highlights). Replace with your file storage (S3, Firebase Storage, etc.).

7. **Auth pattern** -- All database functions take `userUid` (Supabase Auth UID) and look up the internal `users.id` via `supabase.from('users').select('id').eq('uid', userUid)`. Adapt to your auth system.

8. **Navigation** -- Expo Router tab layout (`app/(tabs)/worldcup.tsx`) and dynamic route (`app/fan-group/[id].tsx`). Adapt to your navigation framework.

9. **Bottom tab bar** -- World Cup tab sits between Airport and Profile tabs with a Trophy icon. Add to your tab navigator.

10. **Free APIs used** (no API keys required):
    - **Overpass API** (`overpass-api.de/api/interpreter`) -- OpenStreetMap venue search
    - **Nominatim** (`nominatim.openstreetmap.org/search`) -- Geocoding city names
    - **Leaflet.js CDN** -- Map rendering in WebView
    - Rate limits: Be respectful of OSM usage policy (1 req/sec for Nominatim, reasonable use for Overpass)
