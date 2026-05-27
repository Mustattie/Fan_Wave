# Fan Sphere - Jira Stories

> Project Key: **FW**
> Total Story Points: **198**
> Sprints: 9 (2-week sprints)
> Timeline: Phase 1 (MVP) → Phase 2 (Growth) → Phase 3 (World Cup Mode)

---

## EPIC: FW-E1 — Project Foundation & Auth
**Sprint 1 (Weeks 1-2) · 24 Points**

---

### FW-1: Project Scaffolding & Expo Setup
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Initialize a new Expo React Native project with Expo Router for navigation. Set up the project structure, folder conventions, and base configuration.

**Acceptance Criteria:**
- [ ] New Expo project created with TypeScript template
- [ ] Expo Router configured with file-based routing
- [ ] Bottom tab navigator set up with 5 tabs (Home, Discover, Clips, Groups, Profile)
- [ ] Tab bar matches design: dark theme (#0f0f1a background, #16162a tab bar, #6c5ce7 active accent)
- [ ] Placeholder screens render for each tab
- [ ] App runs on both iOS simulator and Android emulator
- [ ] ESLint and Prettier configured

---

### FW-2: Supabase Project Setup & Auth
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Create a new Supabase project and implement the authentication flow (sign up, sign in, password reset). Set up Supabase client configuration in the app.

**Acceptance Criteria:**
- [ ] Supabase project created with auth enabled (email/password + Google OAuth)
- [ ] `supabaseClient.ts` utility configured with project URL and anon key
- [ ] Sign Up screen: email, password, display name fields → creates user
- [ ] Sign In screen: email + password → authenticates and redirects to Home
- [ ] Password reset flow via email
- [ ] Auth state persisted with AsyncStorage (user stays logged in)
- [ ] Protected routes: unauthenticated users redirected to Sign In
- [ ] `users` table created with columns: `id`, `auth_id`, `display_name`, `avatar_url`, `home_city`, `favorite_team_ids UUID[]`, `created_at`
- [ ] Row Level Security (RLS) enabled on `users` table

---

### FW-3: Base Database Schema — Sports, Leagues, Teams
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Create the foundational sport-agnostic database tables that all features build upon. Seed with initial data for major US sports leagues and teams.

**Acceptance Criteria:**
- [ ] `sports` table created: `id UUID`, `name TEXT`, `icon TEXT`, `color TEXT`
- [ ] `leagues` table created: `id UUID`, `sport_id UUID REFERENCES sports`, `name TEXT`, `country TEXT`, `icon TEXT`
- [ ] `teams` table created: `id UUID`, `league_id UUID REFERENCES leagues`, `name TEXT`, `code TEXT`, `city TEXT`, `logo_url TEXT`, `colors JSONB`
- [ ] `events` table created: `id UUID`, `league_id UUID`, `name TEXT`, `type TEXT CHECK ('season','tournament','playoff')`, `start_date DATE`, `end_date DATE`, `is_active BOOLEAN`
- [ ] `games` table created: `id UUID`, `event_id UUID`, `home_team_id UUID`, `away_team_id UUID`, `venue_name TEXT`, `venue_lat FLOAT`, `venue_lon FLOAT`, `scheduled_at TIMESTAMPTZ`, `status TEXT`, `home_score INT`, `away_score INT`, `stage TEXT`, `metadata JSONB`
- [ ] RLS policies: public read access on all base tables, admin-only writes
- [ ] Seed data: NFL (32 teams), NBA (30 teams), MLS (29 teams), MLB (30 teams), NHL (32 teams)
- [ ] Seed current season events for NFL, NBA, MLS

---

### FW-4: Feature Flags System
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Backend Dev

**Description:**
Create a feature flags table and client-side utility for enabling/disabling seasonal features like World Cup Mode.

**Acceptance Criteria:**
- [ ] `feature_flags` table created: `id UUID`, `key TEXT UNIQUE`, `enabled BOOLEAN`, `start_date TIMESTAMPTZ`, `end_date TIMESTAMPTZ`, `config JSONB`
- [ ] `isFeatureActive(key)` TypeScript utility function
- [ ] Checks enabled flag AND current date within start/end window
- [ ] Results cached in AsyncStorage with 1-hour TTL
- [ ] Seed row: `world_cup_mode`, enabled=true, start=2026-06-11, end=2026-07-19
- [ ] RLS: public read, admin-only writes

---

### FW-5: Sports Data Sync — Edge Function
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Backend Dev

**Description:**
Build a Supabase Edge Function that syncs game schedules from ESPN's API into the `games` table. Runs on a nightly cron.

**Acceptance Criteria:**
- [ ] `SportsDataProvider` TypeScript interface defined: `getUpcomingGames()`, `getLiveScores()`, `getTeams()`
- [ ] ESPN adapter implemented (uses `site.api.espn.com` endpoints)
- [ ] Edge Function `sync-game-schedules` fetches next 7 days of games for NFL, NBA, MLS
- [ ] Upserts into `games` table (no duplicates)
- [ ] Maps ESPN team IDs to internal `teams.id` UUIDs
- [ ] Cron schedule: runs daily at 4:00 AM UTC
- [ ] Manual trigger endpoint for on-demand refresh
- [ ] Error logging and retry on failure

---

### FW-6: Onboarding Flow — Pick Sports
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Build the first onboarding screen where new users select the sports they follow. Grid layout with sport options.

**Acceptance Criteria:**
- [ ] Grid layout with sport options: NFL, NBA, MLB, Soccer, NHL, College FB, College BB, MLS, UFC/Boxing
- [ ] Each option shows emoji icon and label
- [ ] Tapping toggles selection (highlighted border + background)
- [ ] At least 1 sport must be selected to proceed
- [ ] "Continue" button navigates to Team Follow screen
- [ ] Selected sports stored in local state for next step
- [ ] Matches mockup design (dark theme, 3-column grid)

---

## EPIC: FW-E2 — Fan Groups & Chat
**Sprint 2 (Weeks 3-4) · 26 Points**

---

### FW-7: Onboarding Flow — Follow Teams
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Build the team following screen in onboarding. Users search and follow teams from their selected sports.

**Acceptance Criteria:**
- [ ] Search bar at top to filter teams by name
- [ ] Sport filter pills based on user's selected sports
- [ ] Team list: logo emoji, team name, league info, Follow/Following toggle button
- [ ] Fetches teams from `teams` table filtered by selected sports
- [ ] Follow/unfollow updates `users.favorite_team_ids` array
- [ ] "Continue" button navigates to Set City screen
- [ ] Minimum 1 team required to proceed

---

### FW-8: Onboarding Flow — Set City
**Type:** Story · **Points:** 2 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Build the city selection screen. Auto-detect location and allow manual city search.

**Acceptance Criteria:**
- [ ] Location permission request to auto-detect city
- [ ] Search input for manual city search (Nominatim geocoding API)
- [ ] City suggestions list with pin icons
- [ ] Detected city shown with "Detected from location" label
- [ ] Selection updates `users.home_city` in Supabase
- [ ] "Let's Go!" button completes onboarding, navigates to Home
- [ ] Onboarding completion flag stored so it doesn't repeat

---

### FW-9: Chat Rooms & Messages Database Schema
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Create the chat rooms and messages tables that power fan group conversations.

**Acceptance Criteria:**
- [ ] `chat_rooms` table: `id UUID`, `name TEXT`, `description TEXT`, `group_type TEXT CHECK ('sports','worldcup','general')`, `sport_id UUID REFERENCES sports`, `event_id UUID REFERENCES events`, `team_id UUID REFERENCES teams`, `city TEXT`, `tags TEXT[]`, `visibility TEXT CHECK ('public','private')`, `owner_id UUID REFERENCES users`, `member_count INT DEFAULT 0`, `avatar_url TEXT`, `created_at TIMESTAMPTZ`
- [ ] `chat_room_members` table: `id UUID`, `chat_room_id UUID`, `user_id UUID`, `role TEXT CHECK ('owner','admin','member')`, `joined_at TIMESTAMPTZ`
- [ ] `messages` table: `id UUID`, `chat_room_id UUID REFERENCES chat_rooms`, `user_id UUID REFERENCES users`, `content TEXT`, `type TEXT CHECK ('text','image','video','moment')`, `metadata JSONB`, `created_at TIMESTAMPTZ`
- [ ] RLS: members can read messages in their rooms, authenticated users can send messages to rooms they belong to
- [ ] RLS: public rooms visible to all authenticated users, private rooms only to members
- [ ] Index on `messages(chat_room_id, created_at)` for efficient pagination
- [ ] Trigger to auto-increment `chat_rooms.member_count` on member join/leave

---

### FW-10: Fan Group Creation Flow
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the modal/screen for creating a new fan group. Users set group name, sport, team, city, and visibility.

**Acceptance Criteria:**
- [ ] Modal slides up from bottom (matches mockup design)
- [ ] Fields: Group Name (text input), Sport (pill selector), Team (search input → dropdown from `teams` table), City (pre-filled from user's home city), Visibility (Public/Private toggle)
- [ ] "Create Group" inserts into `chat_rooms` table with `group_type = 'sports'`
- [ ] Creator auto-added to `chat_room_members` with `role = 'owner'`
- [ ] Validation: name required (3-50 chars), sport required, city required
- [ ] Success navigates to the new group's detail screen
- [ ] FAB (+) button on Groups tab opens this modal

---

### FW-11: Fan Group Browse & Discovery
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the group listing and discovery features. Users can browse public groups filtered by city and sport.

**Acceptance Criteria:**
- [ ] Groups tab shows "My Groups" section: groups the user has joined, sorted by most recent activity
- [ ] Unread message badge (count) on groups with new messages since last visit
- [ ] Last message preview shown on each group card
- [ ] "Suggested Groups" section: public groups matching user's sports/teams/city that they haven't joined
- [ ] Join button on suggested groups → inserts into `chat_room_members`
- [ ] Search bar to filter groups by name
- [ ] Discover tab shows "Trending Groups in [City]" section
- [ ] Sport filter pills on Discover screen filter group results
- [ ] `browsePublicGroups(city, sportId, search)` database function

---

### FW-12: Real-Time Group Chat
**Type:** Story · **Points:** 6 · **Priority:** Highest
**Assignee:** Full Stack

**Description:**
Build the real-time chat interface inside a fan group using Supabase Realtime.

**Acceptance Criteria:**
- [ ] Fan Group Detail screen with header: group name, member count, online count, team icon
- [ ] "Next game" banner showing the next upcoming game for the group's team
- [ ] 3 sub-tabs: Chat, Moments, Highlights (Moments and Highlights are placeholder for Sprint 5)
- [ ] Chat tab shows message list with avatar, username, message text, timestamp
- [ ] Messages load paginated (most recent 50 first, load more on scroll up)
- [ ] Text input bar at bottom with send button
- [ ] Sending a message inserts into `messages` table
- [ ] Supabase Realtime subscription on `messages` table filtered by `chat_room_id`
- [ ] New messages appear instantly without refresh
- [ ] Scroll to bottom on new message
- [ ] Back button returns to Groups list
- [ ] "Online now" count based on active Realtime presence

---

## EPIC: FW-E3 — Watch Parties
**Sprint 3 (Weeks 5-6) · 26 Points**

---

### FW-13: Watch Party Database Schema
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Create the watch party tables, RSVP system, and moderation tables. Generalized from the SkyConnect WC export with `game_id` instead of `match_id`.

**Acceptance Criteria:**
- [ ] `watch_parties` table: `id UUID`, `creator_id UUID REFERENCES users`, `game_id UUID REFERENCES games` (nullable), `sport_id UUID REFERENCES sports`, `event_id UUID REFERENCES events` (nullable), `title TEXT`, `description TEXT`, `venue_name TEXT`, `venue_address TEXT`, `venue_lat FLOAT`, `venue_lon FLOAT`, `venue_city TEXT`, `atmosphere TEXT CHECK ('chill','moderate','loud','rowdy')`, `capacity INT`, `rsvp_count INT DEFAULT 0`, `starts_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `moderation_status TEXT DEFAULT 'active' CHECK ('active','flagged','removed')`
- [ ] `watch_party_rsvps` table: `id UUID`, `watch_party_id UUID`, `user_id UUID`, `status TEXT CHECK ('going','interested','declined')`, `created_at TIMESTAMPTZ`, UNIQUE(watch_party_id, user_id)
- [ ] `watch_party_flags` table: `id UUID`, `watch_party_id UUID`, `flagger_id UUID`, `reason TEXT CHECK ('spam','inappropriate','misleading','safety','other')`, `details TEXT`, `created_at TIMESTAMPTZ`, UNIQUE(watch_party_id, flagger_id)
- [ ] `rsvp_to_watch_party(party_id, user_id, status)` RPC: enforces capacity (only for 'going'), upserts RSVP, updates `rsvp_count`
- [ ] `flag_watch_party(party_id, user_id, reason, details)` RPC: inserts flag, auto-sets `moderation_status = 'removed'` at 3+ flags
- [ ] RLS: public read on active parties, authenticated users can create, only creator can update/delete
- [ ] RLS hides `moderation_status = 'removed'` parties from queries

---

### FW-14: Venue Search API (Overpass/Nominatim)
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Port the venue search functionality from the SkyConnect WC export. Uses Overpass API to find bars/restaurants near a location and Nominatim for geocoding.

**Acceptance Criteria:**
- [ ] `venueSearchApi.ts` utility ported from `worldCupApi.ts` (rename User-Agent to "FanSphere")
- [ ] `searchVenues(lat, lon, radius)` → queries Overpass for amenity=bar/pub/restaurant with sport-related tags
- [ ] `geocodeCity(cityName)` → uses Nominatim to convert city name to lat/lon
- [ ] `calculateDistance(lat1, lon1, lat2, lon2)` → Haversine formula for distance display
- [ ] 15-minute in-memory cache to avoid redundant API calls
- [ ] Results return: name, address, lat, lon, type (bar/pub/restaurant), distance
- [ ] Error handling for API failures with user-friendly messages
- [ ] Respects Nominatim usage policy (1 req/sec)

---

### FW-15: Create Watch Party Flow (3-Step Wizard)
**Type:** Story · **Points:** 8 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the 3-step watch party creation wizard. Users search for a venue, pick a game, and set details.

**Acceptance Criteria:**
- [ ] Modal slides up from FAB (+) button
- [ ] Step indicator (3 dots) showing current progress
- [ ] **Step 1 — Find Venue:** Search input queries `venueSearchApi.ts`. Results show venue name, address, distance. Tap to select.
- [ ] **Step 2 — Pick Game:** Sport filter pills. Lists upcoming games from `games` table for selected sport. Game cards show teams, time, league. Tap to select. "No specific game" option for general watch parties.
- [ ] **Step 3 — Set Details:** Title (auto-generated from game, editable), Description (text area), Atmosphere picker (Chill/Moderate/Loud/Rowdy pills), Capacity (number input), Start time (date/time picker)
- [ ] "Create Watch Party" button inserts into `watch_parties` table
- [ ] Creator auto-RSVP'd as 'going'
- [ ] Success shows the new watch party detail screen
- [ ] Validation: venue required, title required, start time required

---

### FW-16: Watch Party List & Cards
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Build the watch party card component and list views used on Home and Discover screens.

**Acceptance Criteria:**
- [ ] `WatchPartyCard` component: sport badge (color-coded by sport), title, venue name + distance, date/time, RSVP count / capacity, attendee avatar row, RSVP button
- [ ] Home screen "Watch Parties Near You" section: queries parties by user's city, sorted by `starts_at`
- [ ] Discover screen "Watch Parties This Week" section: same query with broader date range
- [ ] Sport filter pills filter the list
- [ ] RSVP button calls `rsvp_to_watch_party` RPC with status 'going'
- [ ] Card tap navigates to Watch Party Detail screen
- [ ] `getWatchParties(city, sportId, dateRange)` database function
- [ ] Empty state when no watch parties found: "Be the first to create a watch party!"

---

### FW-17: Watch Party Detail Screen
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the full watch party detail screen with map, RSVP actions, attendee list, and moderation.

**Acceptance Criteria:**
- [ ] Map view at top showing venue location (Leaflet.js in WebView, ported from SkyConnect `WatchPartyMapModal`)
- [ ] Party info: title, venue name + address, date/time, atmosphere tag, capacity
- [ ] RSVP bar: 3 buttons — Going (primary), Interested (outline), Can't Go (muted)
- [ ] Tapping an RSVP button calls `rsvp_to_watch_party` RPC, updates UI
- [ ] About section: description text
- [ ] Hosted By section: creator name + avatar
- [ ] Attendee list: avatar, name, RSVP status badge (Going = purple, Interested = yellow)
- [ ] "View all X attendees" link for long lists
- [ ] Action buttons: Chat (opens group chat if linked), Share (native share sheet), Report (calls `flag_watch_party` RPC)
- [ ] Report flow: reason picker (spam, inappropriate, misleading, safety, other) → optional details → submit
- [ ] Back button returns to previous screen

---

## EPIC: FW-E4 — Home Screen & Discovery
**Sprint 4 (Weeks 7-8) · 22 Points**

---

### FW-18: Home Screen
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Build the main Home screen with personalized content sections.

**Acceptance Criteria:**
- [ ] Header: "Fan Sphere" logo, city indicator with change link, notification bell icon
- [ ] "Today's Games" horizontal carousel: game cards for user's followed teams playing today, from `games` table
- [ ] Game card: team emojis/logos, team names, game time, league label
- [ ] "Watch Parties Near You" section: 2-3 nearest upcoming parties (reuses `WatchPartyCard`)
- [ ] "Your Groups" section: user's groups with latest message preview (reuses group card component)
- [ ] Each section has "See All →" link navigating to the relevant tab
- [ ] Pull-to-refresh reloads all sections
- [ ] Empty states for each section when no data

---

### FW-19: Discover Screen
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Build the Discover screen for city-based browsing of groups, watch parties, and clips.

**Acceptance Criteria:**
- [ ] City selector at top showing current city
- [ ] "I'm visiting..." link opens city search (for temporary city override)
- [ ] Search bar for searching across groups, watch parties, and venues
- [ ] Sport filter pills (All, NFL, NBA, Soccer, MLB, NHL)
- [ ] "Trending Groups in [City]" section with group cards
- [ ] "Watch Parties This Week" section with "Map View" toggle
- [ ] "Popular Clips" section (placeholder until Phase 2)
- [ ] Tapping "Map View" shows watch parties on a Leaflet map (reuse `WatchPartyMapModal` component)
- [ ] All sections respect the active sport filter

---

### FW-20: City Switching & "I'm Visiting" Mode
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Allow users to temporarily set a different city for discovery without changing their home city.

**Acceptance Criteria:**
- [ ] "I'm visiting..." option on Discover screen opens city search
- [ ] City search uses Nominatim geocoding
- [ ] Selected visiting city stored in local state (not persisted to Supabase)
- [ ] All Discover queries use visiting city (if set) instead of home city
- [ ] Banner on Discover: "Showing results for [Visiting City]" with "X" to clear
- [ ] Clearing returns to home city
- [ ] Profile menu also has "I'm Visiting..." option

---

### FW-21: Push Notifications Setup
**Type:** Story · **Points:** 5 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Set up push notifications with Expo Notifications for watch party reminders and group activity.

**Acceptance Criteria:**
- [ ] Expo Notifications configured with push token registration
- [ ] Push token stored in `users.push_token` column
- [ ] Watch party reminder: 1 hour before `starts_at` for RSVP'd users (going + interested)
- [ ] New message notification: when a new message is posted in a group the user belongs to (throttled to 1 per group per 5 minutes)
- [ ] Notification tap deep-links to the relevant screen (watch party detail or group chat)
- [ ] Notification settings screen: toggle on/off per category (watch parties, group messages)
- [ ] Supabase Edge Function to send notifications via Expo Push API

---

### FW-22: Profile Screen
**Type:** Story · **Points:** 4 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Build the user profile screen with stats, followed teams, and settings.

**Acceptance Criteria:**
- [ ] Profile header: avatar, display name, handle, stats (Groups count, Parties attended, Clips posted)
- [ ] Followed teams badges row
- [ ] Menu items: My Teams (→ team follow screen), RSVP History, My Clips (placeholder), Home City, I'm Visiting, Notifications, Settings, Sign Out
- [ ] My Teams navigates to the team follow screen (reuse from onboarding, FW-7)
- [ ] RSVP History shows past watch parties user RSVP'd to, sorted by date
- [ ] Sign Out clears auth state and navigates to welcome screen
- [ ] Settings screen: edit display name, change password, delete account

---

## EPIC: FW-E5 — Sports Clips & Moments
**Sprint 5 (Weeks 9-10) · 24 Points**

---

### FW-23: Moments & Clips Database Schema
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Create the moments, reactions, and media clips tables. Port from SkyConnect export with generalized `game_id`.

**Acceptance Criteria:**
- [ ] `match_moments` table: `id UUID`, `chat_room_id UUID REFERENCES chat_rooms`, `game_id UUID REFERENCES games` (nullable), `user_id UUID REFERENCES users`, `moment_type TEXT`, `minute TEXT`, `team_id UUID REFERENCES teams` (nullable), `comment TEXT`, `media_url TEXT`, `is_pinned BOOLEAN DEFAULT false`, `created_at TIMESTAMPTZ`
- [ ] `moment_type` values: 'goal', 'touchdown', 'three_pointer', 'home_run', 'dunk', 'interception', 'save', 'penalty', 'foul', 'red_card', 'yellow_card', 'var', 'reaction', 'discussion' (validated at app layer per sport)
- [ ] `moment_reactions` table: `id UUID`, `moment_id UUID`, `user_id UUID`, `emoji TEXT`, `created_at TIMESTAMPTZ`, UNIQUE(moment_id, user_id, emoji)
- [ ] `media_clips` table: `id UUID`, `chat_room_id UUID`, `game_id UUID` (nullable), `user_id UUID`, `title TEXT`, `description TEXT`, `media_url TEXT`, `media_type TEXT CHECK ('video','image')`, `thumbnail_url TEXT`, `duration_seconds INT`, `view_count INT DEFAULT 0`, `created_at TIMESTAMPTZ`
- [ ] `fan-media` Supabase Storage bucket created with public read, authenticated write policies
- [ ] RLS: members of a chat room can read/write moments and clips in that room
- [ ] `toggleMomentReaction(moment_id, user_id, emoji)` RPC: inserts or deletes

---

### FW-24: Moments Feed in Fan Groups
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the Moments sub-tab inside Fan Group Detail. Users can post and react to game moments.

**Acceptance Criteria:**
- [ ] Moments tab shows scrollable feed of moment cards, sorted by most recent
- [ ] Moment card: type badge (color-coded), username, game/time context, comment text, media (if attached), reaction row
- [ ] "Post a Moment" button at top opens creation modal
- [ ] Create Moment modal: moment type picker (sport-specific types), game selector (optional), comment text, attach media (optional), submit
- [ ] Reactions row: existing emoji counts, "+" button to add a reaction
- [ ] Tapping "+" shows emoji picker (predefined sport emojis + standard)
- [ ] Tapping an existing reaction toggles your reaction (calls `toggleMomentReaction` RPC)
- [ ] `getMatchMoments(chatRoomId)` database function with reaction aggregation
- [ ] `createMatchMoment(...)` database function
- [ ] Real-time updates via Supabase subscription

---

### FW-25: Highlights Grid in Fan Groups
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the Highlights sub-tab inside Fan Group Detail. Users can upload and view video/image clips.

**Acceptance Criteria:**
- [ ] Highlights tab shows 2-column grid of media thumbnails
- [ ] Each thumbnail: preview image, play icon overlay (for video), duration badge
- [ ] "Post a Highlight" button at top opens upload flow
- [ ] Upload flow: pick from camera roll (Expo ImagePicker), add title, optional description, submit
- [ ] Media uploaded to `fan-media` Supabase Storage bucket
- [ ] `media_clips` row inserted with `media_url` pointing to storage
- [ ] Tapping a thumbnail opens full-screen viewer
- [ ] Video player: full-screen with play/pause, scrub bar (Expo AV)
- [ ] Image viewer: full-screen with pinch-to-zoom
- [ ] `getMediaClips(chatRoomId)` and `uploadMediaClip(...)` database functions
- [ ] File size limit: 50MB per clip

---

### FW-26: Comments on Clips
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Add commenting functionality to media clips, allowing fans to discuss highlights.

**Acceptance Criteria:**
- [ ] `clip_comments` table: `id UUID`, `clip_id UUID REFERENCES media_clips`, `user_id UUID`, `content TEXT`, `created_at TIMESTAMPTZ`
- [ ] RLS: authenticated users can read/write comments on clips in rooms they belong to
- [ ] Comment section below clip in full-screen viewer
- [ ] Shows comment count on clip thumbnail in grid
- [ ] Comment input at bottom of viewer
- [ ] Real-time comment updates via Supabase subscription
- [ ] Comment limit: 500 characters

---

### FW-27: Sport-Specific Moment Types
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Configure moment type pickers per sport so users see relevant moment types.

**Acceptance Criteria:**
- [ ] NFL moments: Touchdown, Interception, Fumble, Sack, Field Goal, Big Play, Reaction
- [ ] NBA moments: Three Pointer, Dunk, Block, Steal, Alley-Oop, Buzzer Beater, Reaction
- [ ] Soccer moments: Goal, Save, Penalty, Foul, Red Card, Yellow Card, VAR, Reaction
- [ ] MLB moments: Home Run, Strikeout, Double Play, Diving Catch, Walk-Off, Reaction
- [ ] Generic fallback: Big Play, Highlight, Reaction, Discussion
- [ ] Moment type picker in Create Moment modal dynamically loads types based on group's `sport_id`
- [ ] Each type has a unique color and emoji icon
- [ ] Config stored in a `momentTypes.ts` constants file (not in DB)

---

### FW-28: Moment Reactions — Emoji System
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Build the emoji reaction system for moments with sport-themed emojis.

**Acceptance Criteria:**
- [ ] Predefined sport emoji set: 🔥 ❤️ 💪 😤 🏆 👏 😱 💀 🐐 + standard emojis
- [ ] Reaction bar below each moment shows aggregated counts per emoji
- [ ] User's own reactions highlighted
- [ ] Tap existing reaction to toggle (add/remove)
- [ ] "+" button opens emoji picker grid
- [ ] Optimistic UI: reaction count updates immediately, rolls back on error
- [ ] Animations: reaction pop/bounce on add

---

## EPIC: FW-E6 — Clips Feed & Sharing
**Sprint 6 (Weeks 11-12) · 20 Points**

---

### FW-29: Standalone Clips Feed Tab
**Type:** Story · **Points:** 8 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the dedicated Clips tab with a vertical scrollable feed of sports highlights across all groups.

**Acceptance Criteria:**
- [ ] Clips tab shows a vertical scrollable feed (like TikTok/Reels style but in card format, not full-screen)
- [ ] Each clip card: media preview (auto-play video on visible), title, poster name + group name, timestamp, view count
- [ ] Action buttons: heart (like), comment count, share, repost
- [ ] Filter pills: For You (algorithm), Following (from joined groups), Trending (most liked), sport filters
- [ ] "For You" algorithm: clips from groups user belongs to + popular clips from user's sport preferences
- [ ] Infinite scroll pagination (20 clips per page)
- [ ] Pull-to-refresh loads newest clips
- [ ] `getTrendingClips(sportId, limit, offset)` database function

---

### FW-30: Clip Sharing with Branding
**Type:** Story · **Points:** 5 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Allow users to share clips outside the app with Fan Sphere branding.

**Acceptance Criteria:**
- [ ] Share button on clip cards opens native share sheet
- [ ] Shared content includes: clip title, "Posted on Fan Sphere" tagline, deep link URL
- [ ] For image clips: branded watermark overlay ("Fan Sphere" + wave emoji, bottom corner)
- [ ] Deep link format: `fansphere.app/clip/{id}` (falls back to app store if app not installed)
- [ ] Expo Linking configured for deep link handling
- [ ] Shared clip opens directly in app if installed
- [ ] Track share count on `media_clips.share_count` column

---

### FW-31: Clip Likes System
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Add a like/heart system for clips in the feed.

**Acceptance Criteria:**
- [ ] `clip_likes` table: `id UUID`, `clip_id UUID`, `user_id UUID`, `created_at TIMESTAMPTZ`, UNIQUE(clip_id, user_id)
- [ ] Heart button toggles like/unlike
- [ ] Like count displayed on clip card
- [ ] Optimistic UI updates
- [ ] Double-tap on clip media to like (with heart animation)
- [ ] `media_clips.like_count` column maintained by trigger

---

### FW-32: Profile — My Clips & RSVP History
**Type:** Story · **Points:** 4 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Build the "My Clips" and "RSVP History" profile sub-screens.

**Acceptance Criteria:**
- [ ] My Clips: grid view of user's posted clips (same layout as highlights grid)
- [ ] Tap to view with full stats (views, likes, comments, shares)
- [ ] Delete option on own clips
- [ ] RSVP History: list of watch parties user has RSVP'd to
- [ ] Sorted by date (upcoming first, then past)
- [ ] Status badge (Going, Interested, Declined)
- [ ] Tap navigates to watch party detail

---

## EPIC: FW-E7 — Engagement & Moderation
**Sprint 7 (Weeks 13-14) · 20 Points**

---

### FW-33: Push Notification Strategy
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Implement the full push notification system for engagement and retention.

**Acceptance Criteria:**
- [ ] "X fans near you watching tonight" — sent 2 hours before games matching user's teams, if watch parties exist in user's city
- [ ] Game reminder — sent 30 min before kickoff for followed teams
- [ ] Watch party reminder — sent 1 hour before party start for RSVP'd users
- [ ] Group activity — "New messages in [Group Name]" (throttled to max 3/day per group)
- [ ] New follower of clip — "[User] liked your clip"
- [ ] Edge Function `send-notifications` handles all notification logic
- [ ] Notification preferences in settings (per-type toggle)
- [ ] Batch sending for efficiency (not one Edge Function call per user)

---

### FW-34: Content Moderation System
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Backend Dev

**Description:**
Extend the watch party flagging system to cover all content types with a consistent moderation approach.

**Acceptance Criteria:**
- [ ] `content_flags` generic table: `id UUID`, `content_type TEXT CHECK ('watch_party','chat_room','media_clip','moment','message')`, `content_id UUID`, `flagger_id UUID`, `reason TEXT CHECK ('spam','inappropriate','harassment','misleading','safety','other')`, `details TEXT`, `created_at TIMESTAMPTZ`, UNIQUE(content_type, content_id, flagger_id)
- [ ] Auto-moderation: content with 3+ flags set to `removed` status
- [ ] `flag_content(type, id, reason, details)` RPC with duplicate prevention
- [ ] Report button available on: watch parties, clips, moments, messages, groups
- [ ] Flagged content hidden from feeds but preserved in DB
- [ ] `moderation_log` table for audit trail
- [ ] Shadowban: users with 5+ flagged items across types get `users.is_shadowbanned = true` — their content is only visible to themselves

---

### FW-35: Group Moderation — Admin Tools
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Give group owners and admins moderation capabilities within their groups.

**Acceptance Criteria:**
- [ ] Group owner can promote members to admin role
- [ ] Owner and admins can: delete messages, remove moments, remove clips within their group
- [ ] Owner can: remove members, ban members (prevents rejoin)
- [ ] `banned_members` table: `chat_room_id UUID`, `user_id UUID`, `banned_by UUID`, `reason TEXT`, `created_at TIMESTAMPTZ`
- [ ] Banned users cannot rejoin or view group content
- [ ] Admin actions logged in `moderation_log`
- [ ] Pin moment: owner/admin can pin a moment to top of the Moments feed (`is_pinned = true`)

---

### FW-36: User Blocking
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Allow users to block other users. Blocked users' content is hidden.

**Acceptance Criteria:**
- [ ] `user_blocks` table: `id UUID`, `blocker_id UUID`, `blocked_id UUID`, `created_at TIMESTAMPTZ`, UNIQUE(blocker_id, blocked_id)
- [ ] Block option on user profile and in chat (long-press message → Block User)
- [ ] Blocked users' messages, moments, and clips hidden from blocker's view
- [ ] Blocked users cannot send direct messages (future feature prep)
- [ ] Block list viewable in Settings
- [ ] Unblock option available

---

### FW-37: Analytics Instrumentation
**Type:** Story · **Points:** 4 · **Priority:** Medium
**Assignee:** Full Stack

**Description:**
Add event tracking throughout the app for product analytics.

**Acceptance Criteria:**
- [ ] Analytics provider set up (Mixpanel free tier or Supabase custom events table)
- [ ] Events tracked: `app_open`, `sign_up`, `sign_in`, `onboarding_complete`, `group_created`, `group_joined`, `watch_party_created`, `watch_party_rsvp`, `message_sent`, `moment_created`, `clip_uploaded`, `clip_liked`, `clip_shared`, `screen_viewed`
- [ ] Each event includes: `user_id`, `timestamp`, `screen`, `metadata` (relevant IDs)
- [ ] User properties synced: `city`, `sports_count`, `teams_count`, `groups_count`
- [ ] No PII in analytics (no email, real name)

---

## EPIC: FW-E8 — World Cup Mode
**Sprint 8 (Weeks 15-16) · 20 Points**

---

### FW-38: World Cup Static Data & Remote Config
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Port the World Cup data from SkyConnect export and set up remote config for live updates.

**Acceptance Criteria:**
- [ ] `worldCupData.ts` static file with 48 teams (12 groups A-L), 16 venues, 104 match schedule
- [ ] Team data: code, name, group, flag emoji, confederation
- [ ] Venue data: name, city, country, capacity, coordinates, timezone
- [ ] Match data: generated from group stage (72) + knockout (32) formula
- [ ] `worldCupDataSync.ts` ported: priority chain remote → AsyncStorage cache → static file
- [ ] Remote config via `world_cup_config` row in `feature_flags` table (config JSONB stores teams/venues/matches for live updates)
- [ ] `getWorldCupData()` function returns `WorldCupDataBundle` with source indicator
- [ ] `refreshWorldCupData()` for pull-to-refresh
- [ ] Version tracking for cache invalidation
- [ ] WC teams also seeded into `teams` table (with `league_id` pointing to a "FIFA World Cup 2026" league) and WC matches into `games` table

---

### FW-39: World Cup Tab — Conditional Navigation
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Add the World Cup tab to the bottom navigation that only appears when World Cup Mode is active.

**Acceptance Criteria:**
- [ ] App checks `isFeatureActive('world_cup_mode')` on launch
- [ ] When active: 6th tab appears in tab bar — Trophy icon, "World Cup" label, green accent (#00c853)
- [ ] When inactive: tab is completely hidden, 5-tab layout as normal
- [ ] Green gradient header on WC tab: "World Cup 2026", "USA · Canada · Mexico · June 11 - July 19"
- [ ] 3 sub-tabs within WC tab: Schedule, Watch Parties, Fan Groups
- [ ] Notification dot on WC tab when there are live matches
- [ ] Feature flag check cached, rechecked every app launch

---

### FW-40: World Cup Schedule Screen
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Port the match schedule components from SkyConnect export. Filter and browse all 104 WC matches.

**Acceptance Criteria:**
- [ ] `ScheduleFilterBar`: filter pills — All Matches, My Teams, Today, Upcoming
- [ ] Stage selector: Group Stage, Round of 32, Round of 16, Quarter-Finals, Semi-Finals, Final
- [ ] `MatchCard`: flag emojis, team names, "VS", venue name, date/time with timezone
- [ ] `MatchScheduleList`: FlatList with date section headers (e.g., "June 11, 2026 · Opening Day")
- [ ] "My Teams" filter shows only matches for teams the user follows (from `users.favorite_team_ids`)
- [ ] "Today" filter shows matches for current date
- [ ] Live match indicator (pulsing dot) when a match is in progress
- [ ] Score display for completed/live matches
- [ ] Pull-to-refresh calls `refreshWorldCupData()`
- [ ] `EmptyWorldCupState`: shown before tournament starts with countdown timer + "Follow your teams" CTA

---

### FW-41: World Cup Team Following
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Port the WC team follow modal. Users select which World Cup teams to follow.

**Acceptance Criteria:**
- [ ] `TeamFollowModal` for World Cup: teams organized by Group (A-L)
- [ ] Each team: flag emoji, team name, confederation badge
- [ ] Search bar to filter teams
- [ ] Toggle follow/unfollow (updates `users.favorite_team_ids`)
- [ ] AsyncStorage-first for instant display, syncs to Supabase
- [ ] Accessible from WC Schedule screen header (star icon) and from "Follow your teams" CTA
- [ ] Count badge: "Following X teams"

---

### FW-42: World Cup Green Theme Overlay
**Type:** Story · **Points:** 4 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
When World Cup Mode is active, apply subtle green accent theming throughout the app.

**Acceptance Criteria:**
- [ ] WC tab uses green (#00c853) as primary accent instead of purple (#6c5ce7)
- [ ] Green gradient header on WC tab screens
- [ ] Home screen: "World Cup" banner at top promoting the WC tab when mode is active
- [ ] WC watch parties and groups on Home/Discover get green sport badges
- [ ] Theme context provider with `isWorldCupMode` flag that components can consume
- [ ] Subtle, not overwhelming — only WC-specific elements get green, rest of app stays purple

---

## EPIC: FW-E9 — World Cup Watch Parties & Fan Groups
**Sprint 9 (Weeks 17-18) · 16 Points**

---

### FW-43: World Cup Watch Parties Sub-Tab
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the Watch Parties sub-tab within the World Cup tab. Search, browse, create, and RSVP to WC-specific watch parties.

**Acceptance Criteria:**
- [ ] Search bar to search WC watch parties by city or venue
- [ ] City filter pills (All Cities, Near Me, + host cities: New York, LA, Chicago, Dallas, Houston, Miami, etc.)
- [ ] Green "+" button to create a WC watch party (reuses Create Watch Party modal, pre-filtered to WC games)
- [ ] Scrollable list of WC watch parties with green sport badges
- [ ] Each card: title, venue + city + distance, date/time, RSVP count/capacity, atmosphere, attendee avatars, RSVP button
- [ ] Queries `watch_parties` where `event_id` matches WC event
- [ ] RSVP reuses existing `rsvp_to_watch_party` RPC
- [ ] Card tap opens standard Watch Party Detail screen

---

### FW-44: World Cup Fan Groups Sub-Tab
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Build the Fan Groups sub-tab within the World Cup tab. Public WC groups with join, chat, highlights, and moments.

**Acceptance Criteria:**
- [ ] Search bar to search WC fan groups
- [ ] Filter pills: All Groups, By Country, By City, Travel Fans
- [ ] Scrollable list of public WC fan groups
- [ ] Each group card: country flag icon, group name, member count + online count, "Public" label, description preview, tags (World Cup + country + city), **Join button**
- [ ] Join button calls insert on `chat_room_members`, button changes to "Joined"
- [ ] After joining, tapping the group navigates to Fan Group Detail screen (reuses FW-12) with Chat, Moments, Highlights tabs
- [ ] Queries `chat_rooms` where `group_type = 'worldcup'`
- [ ] `WorldCupGroupTemplates`: when creating a new WC group, offer templates — Team Fans, Match Watch, Travel Fans, City Hub
- [ ] Each template pre-fills group name pattern and tags

---

### FW-45: World Cup Moment Types
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Add World Cup-specific moment types to the moment creation flow in WC fan groups.

**Acceptance Criteria:**
- [ ] WC-specific moment types: Goal, Save, Penalty, Foul, Red Card, Yellow Card, VAR, Substitution, Offside, Free Kick, Corner, Half-Time, Full-Time, Reaction
- [ ] When creating a moment in a WC group (`group_type = 'worldcup'`), show soccer moment types
- [ ] Moment card shows match context: "USA vs Wales · 23'" (minute)
- [ ] Pin moment for group admins (sticky at top of Moments feed)
- [ ] Live match integration: if a WC match is in progress, auto-suggest the current match and minute

---

### FW-46: Integration Testing & QA
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** QA / Full Team

**Description:**
End-to-end testing of the complete World Cup Mode flow and regression testing of core features.

**Acceptance Criteria:**
- [ ] Feature flag toggle: verify WC tab appears/disappears correctly
- [ ] Full WC user journey: browse schedule → follow teams → find watch party → RSVP → join fan group → chat → post moment → upload highlight
- [ ] Verify WC data loads correctly (remote → cache → static fallback chain)
- [ ] Verify RSVP capacity enforcement on WC watch parties
- [ ] Verify moderation: flag a WC watch party → auto-removal at 3 flags
- [ ] Verify real-time chat in WC fan groups (2+ simultaneous users)
- [ ] Performance: smooth scrolling with 100+ matches in schedule list
- [ ] Test on iOS and Android devices
- [ ] Test offline behavior: cached data displays, graceful error messages
- [ ] Regression: all core features (non-WC groups, watch parties, clips) still work correctly

---

## EPIC: FW-E10 — Personalized Follow Tiers
**Sprint 10 (Weeks 19-20) · 26 Points**

> **Problem:** All fans currently get the same experience when they follow a team — full group chat, every clip, every watch party, every notification. This creates noise for casual fans and drives churn. Fans have different engagement levels and need a way to control what they see without losing access.

> **Solution:** Per-team follow tiers — Lite (scores & news), Social (fan zone), All In (superfan). The tier controls what surfaces in the user's feed and what notifications they receive. It does NOT restrict access — a Lite follower can still manually visit a group.

---

### FW-47: User Team Follows Schema Migration
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Replace the `users.favorite_team_ids UUID[]` array with a proper `user_team_follows` join table that supports per-team follow tiers. Migrate existing data.

**Acceptance Criteria:**
- [ ] `user_team_follows` table created: `id UUID PK`, `user_id UUID NOT NULL`, `team_id UUID NOT NULL REFERENCES teams(id)`, `tier TEXT NOT NULL DEFAULT 'social' CHECK (tier IN ('lite','social','all_in'))`, `followed_at TIMESTAMPTZ DEFAULT now()`, `UNIQUE(user_id, team_id)`
- [ ] Index on `user_team_follows(user_id)` for fast "my teams" lookup
- [ ] Index on `user_team_follows(team_id, tier)` for fan count by tier
- [ ] RLS: users can SELECT/INSERT/UPDATE/DELETE their own follows only
- [ ] Migration function: for each user with `favorite_team_ids`, INSERT rows into `user_team_follows` with tier='social' (preserving existing follows)
- [ ] `get_user_teams(p_user_id UUID)` RPC returns teams with tier info (joins `user_team_follows` with `teams`)
- [ ] `follow_team(p_user_id UUID, p_team_id UUID, p_tier TEXT DEFAULT 'social')` RPC with upsert logic
- [ ] `unfollow_team(p_user_id UUID, p_team_id UUID)` RPC with DELETE

---

### FW-48: Follow Tier Constants & Types
**Type:** Story · **Points:** 2 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Create the TypeScript constants and types for the follow tier system. Define what content each tier includes.

**Acceptance Criteria:**
- [ ] `constants/FollowTiers.ts` created with tier definitions:
  - `lite`: label "Scores & News", icon "📊", description "Game scores, results, and top highlights", color "#0096ff"
  - `social`: label "Fan Zone", icon "👥", description "Scores + group chat, watch parties, clips in your feed", color "#6c5ce7"
  - `all_in`: label "Superfan", icon "🔥", description "Everything — moments, live alerts, all clips, priority discovery", color "#ff4444"
- [ ] `FollowTier` type exported: `'lite' | 'social' | 'all_in'`
- [ ] `UserTeamFollow` interface: `{ id, user_id, team_id, tier, followed_at, team?: Team }`
- [ ] `TIER_CONTENT_MAP` constant defining what content types each tier includes:
  - `lite`: `['scores', 'results', 'top_highlights']`
  - `social`: `['scores', 'results', 'top_highlights', 'group_chat', 'watch_parties', 'clips']`
  - `all_in`: `['scores', 'results', 'top_highlights', 'group_chat', 'watch_parties', 'clips', 'moments', 'live_alerts', 'all_clips']`
- [ ] `tierIncludesContent(tier, contentType)` utility function
- [ ] `TIER_ORDER` constant for sorting: `{ lite: 0, social: 1, all_in: 2 }`

---

### FW-49: Tier Picker Component
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Build a reusable tier picker component that appears when following a team. Shows the 3 tiers as selectable cards with progressive disclosure.

**Acceptance Criteria:**
- [ ] `TierPicker` component with props: `selectedTier: FollowTier`, `onSelect: (tier: FollowTier) => void`, `compact?: boolean`
- [ ] Full mode (default): 3 vertical cards, each showing icon, label, description, checkmark when selected
- [ ] Compact mode: 3 horizontal pills showing just icon + label (for inline use)
- [ ] Selected tier highlighted with accent border and background tint
- [ ] Smooth transition animation between selections
- [ ] Dark theme styling matching app design
- [ ] "Social" (middle tier) pre-selected by default
- [ ] Each card shows a brief list of what's included (e.g., "✓ Scores ✓ Groups ✓ Watch Parties")

---

### FW-50: Onboarding Follow Teams — Tier Integration
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack

**Description:**
Update the onboarding Follow Teams screen to include tier selection per team. When a user taps "Follow", the tier picker appears inline.

**Acceptance Criteria:**
- [ ] Follow button tap expands the team row to show compact TierPicker below the team info
- [ ] Default tier is "Social" (pre-selected)
- [ ] User can change tier with one tap before moving on
- [ ] Tapping "Following" again collapses the tier picker and unfollows
- [ ] "Continue" button saves all follows with their tiers to AsyncStorage (key: 'followed_teams_with_tiers')
- [ ] On onboarding completion, batch-insert into `user_team_follows` via Supabase (with tier per team)
- [ ] If Supabase unavailable, store in AsyncStorage for later sync
- [ ] Visual: followed teams show their tier icon badge (📊/👥/🔥) next to the "Following" button
- [ ] Existing `MOCK_TEAMS` data still works (graceful fallback)
- [ ] Count text updates: "3 teams followed" → "3 teams followed (1 Lite, 1 Social, 1 Superfan)"

---

### FW-51: Profile — My Teams with Tier Management
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Create a My Teams screen accessible from the Profile menu where users can view and change their follow tiers post-onboarding.

**Acceptance Criteria:**
- [ ] New screen `app/my-teams.tsx` registered in root layout
- [ ] Profile menu "My Teams" navigates to this screen (replace onboarding-teams navigation)
- [ ] Lists all followed teams with: team logo/emoji, name, city, league, current tier badge
- [ ] Tapping a team row expands to show full TierPicker (not compact)
- [ ] Changing tier calls `follow_team` RPC to update (with optimistic UI)
- [ ] Swipe left to unfollow (or long-press → "Unfollow" option)
- [ ] "Follow More Teams" button at bottom navigates to a team search flow
- [ ] Fetch teams from `get_user_teams` RPC, fallback to AsyncStorage
- [ ] Shows tier distribution summary at top: "Following 4 teams: 1 📊 · 2 👥 · 1 🔥"

---

### FW-52: Home Feed — Tier-Based Filtering
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Full Stack

**Description:**
Update the Home screen to respect follow tiers when showing content. Each section should only show content appropriate to the user's tier for that team.

**Acceptance Criteria:**
- [ ] Fetch user's team follows with tiers on mount (from `user_team_follows`)
- [ ] **Today's Games** section: shows for ALL tiers (lite, social, all_in) — no change needed
- [ ] **Watch Parties Near You** section: only shows watch parties linked to teams the user follows at `social` or `all_in` tier
- [ ] **Your Groups** section: only shows groups for teams followed at `social` or `all_in` tier
- [ ] **Moments Feed** (if visible): only shows for `all_in` tier teams
- [ ] If a user follows Bears at "lite" and Bulls at "social":
  - They see Bears AND Bulls game cards
  - They see Bulls watch parties but NOT Bears watch parties
  - They see Bulls group but NOT Bears group
- [ ] Fallback: if no tier data available (Supabase offline), show everything (current behavior)
- [ ] Helper function: `getTeamsForContentType(follows, contentType)` returns team IDs that should see that content

---

### FW-53: Notifications — Tier-Based Filtering
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Backend Dev

**Description:**
Update the notification system to respect follow tiers. Users only receive notifications appropriate to their tier.

**Acceptance Criteria:**
- [ ] `send-notifications` edge function reads `user_team_follows.tier` before sending
- [ ] **Lite tier** receives: game score updates, final scores, weekly highlights digest
- [ ] **Social tier** receives: everything in Lite + "X fans watching tonight" prompts, watch party reminders, new group messages (throttled)
- [ ] **All In tier** receives: everything in Social + live moment alerts, every new clip, real-time game updates
- [ ] `notification_preferences` table extended with `tier_override` column (optional per-type overrides)
- [ ] Edge function query: `SELECT DISTINCT user_id, tier FROM user_team_follows WHERE team_id = $1` to determine who gets what

---

### FW-54: Tier Upsell Prompts
**Type:** Story · **Points:** 2 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Show contextual prompts encouraging users to upgrade their follow tier when they engage with content above their current tier.

**Acceptance Criteria:**
- [ ] When a Lite user taps a watch party card: show a bottom sheet — "Upgrade to Fan Zone to see watch parties for [Team] in your feed. Upgrade / Not Now"
- [ ] When a Lite user visits a group chat: show inline banner — "You're browsing as a Lite follower. Upgrade to join the conversation."
- [ ] When a Social user taps a moment: show subtle prompt — "Go All In to get live moment alerts for [Team]"
- [ ] Prompts are dismissable and don't block access (content is still viewable)
- [ ] Track prompt impressions and conversions via analytics: `tier_upsell_shown`, `tier_upsell_accepted`
- [ ] Don't show the same prompt more than once per session per team
- [ ] AsyncStorage tracks dismissed prompts: `tier_prompts_dismissed_${teamId}`

---

## Summary

| Phase | Epic | Sprint | Points | Key Deliverable |
|-------|------|--------|--------|----------------|
| Phase 1 | FW-E1 Foundation | Sprint 1 | 24 | Project setup, auth, base schema, data sync |
| Phase 1 | FW-E2 Groups & Chat | Sprint 2 | 26 | Fan groups, real-time chat, onboarding |
| Phase 1 | FW-E3 Watch Parties | Sprint 3 | 26 | Watch party CRUD, venue search, RSVP |
| Phase 1 | FW-E4 Discovery | Sprint 4 | 22 | Home screen, discover, push notifications |
| Phase 2 | FW-E5 Clips & Moments | Sprint 5 | 24 | Moments feed, highlights grid, reactions |
| Phase 2 | FW-E6 Clips Feed | Sprint 6 | 20 | Standalone clips tab, sharing, likes |
| Phase 2 | FW-E7 Engagement | Sprint 7 | 20 | Notifications, moderation, analytics |
| Phase 3 | FW-E8 WC Mode | Sprint 8 | 20 | WC data, schedule, team following, theme |
| Phase 3 | FW-E9 WC Features | Sprint 9 | 16 | WC watch parties, fan groups, QA |
| Phase 4 | FW-E10 Follow Tiers | Sprint 10 | 26 | Per-team follow tiers, filtered feeds, upsell |
| **Total** | **10 Epics** | **10 Sprints** | **224** | |

| Phase | Epic | Sprint | Points | Key Deliverable |
|-------|------|--------|--------|----------------|
| Phase 1 | FW-E1 Foundation | Sprint 1 | 24 | Project setup, auth, base schema, data sync |
| Phase 1 | FW-E2 Groups & Chat | Sprint 2 | 26 | Fan groups, real-time chat, onboarding |
| Phase 1 | FW-E3 Watch Parties | Sprint 3 | 26 | Watch party CRUD, venue search, RSVP |
| Phase 1 | FW-E4 Discovery | Sprint 4 | 22 | Home screen, discover, push notifications |
| Phase 2 | FW-E5 Clips & Moments | Sprint 5 | 24 | Moments feed, highlights grid, reactions |
| Phase 2 | FW-E6 Clips Feed | Sprint 6 | 20 | Standalone clips tab, sharing, likes |
| Phase 2 | FW-E7 Engagement | Sprint 7 | 20 | Notifications, moderation, analytics |
| Phase 3 | FW-E8 WC Mode | Sprint 8 | 20 | WC data, schedule, team following, theme |
| Phase 3 | FW-E9 WC Features | Sprint 9 | 16 | WC watch parties, fan groups, QA |
| **Total** | **9 Epics** | **9 Sprints** | **198** | |

---
---

# Phase 5: Production Hardening (Sprints 11-12)

> Added post-audit. These stories address critical findings from the full-team production review (Security Architect, Database Engineer, Software Engineer, UX/UI Expert, Sports Fan, Sports Influencer, Brand/Marketing Director, Devil's Advocate).

---

## EPIC: FW-E11 — Seed Data & Cold Start Solution
**Sprint 11 (Weeks 21-22) · 21 Points**

---

### FW-55: Seed Database with Demo Content
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Solve the cold start problem. New users must see a populated app from day one. Create comprehensive seed data for all content types across all major cities.

**Acceptance Criteria:**
- [ ] 50+ fan groups seeded across NFL, NBA, MLB, MLS, NHL (by team + by city)
- [ ] 20+ watch parties seeded in 10 major US cities with realistic venue names, dates, capacities
- [ ] 30+ sample moments seeded across multiple sports with reactions
- [ ] 20+ sample highlights/clips with realistic metadata (views, likes, durations)
- [ ] All seeded chat rooms have realistic member_count values (50-5000 range)
- [ ] All seeded watch parties have realistic rsvp_count values
- [ ] Seed data uses dedicated system user UUID for `owner_id`/`creator_id`
- [ ] Seed script is idempotent (safe to re-run with `ON CONFLICT DO NOTHING`)
- [ ] Run seed after all migrations complete without errors

---

### FW-56: Push Notifications — Expo Setup & Token Registration
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Full Stack Dev

**Description:**
Set up the Expo push notification infrastructure. Register push tokens on login, store them in the users table, and handle notification permissions gracefully.

**Acceptance Criteria:**
- [ ] Install `expo-notifications` and `expo-device`
- [ ] Add `push_token TEXT` column to `users` table (migration)
- [ ] On app launch (after auth), request notification permission
- [ ] On permission granted, register Expo push token and save to `users.push_token`
- [ ] Token refreshes on each app launch (handles token rotation)
- [ ] Handle permission denied gracefully (no blocking, show settings prompt later)
- [ ] Add `notification_preferences JSONB` column to `users` table with defaults: `{"score_updates": true, "game_reminders": true, "watch_party_reminders": true, "group_activity": true, "moment_alerts": false, "clip_posted": false}`
- [ ] Token cleared on sign out

---

### FW-57: Push Notifications — Game Reminders & Score Updates
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Backend Dev

**Description:**
Trigger push notifications for game-day events. Game reminders 30 min before kickoff, score updates on goals/touchdowns, and final score notifications.

**Acceptance Criteria:**
- [ ] Supabase cron job triggers `send-notifications` edge function for games starting in 30 min
- [ ] Notification sent to all users following home/away team at eligible tiers
- [ ] Score update notifications triggered when `games.status` changes to 'in' or scores update
- [ ] Final score notification when `games.status` changes to 'post'
- [ ] Notifications respect user's `notification_preferences` settings
- [ ] Notification payload includes deep link to game/watch-party screen
- [ ] Rate limit: max 1 score notification per game per 5 minutes per user

---

### FW-58: Push Notifications — Watch Party & Group Activity
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Backend Dev

**Description:**
Notify users about watch party reminders and group activity they've opted into.

**Acceptance Criteria:**
- [ ] Watch party reminder 1 hour before `starts_at` for all users with `status = 'going'`
- [ ] New message in group → notify members who haven't opened the group in 10+ minutes
- [ ] New moment posted → notify `all_in` tier followers of that team
- [ ] Notification tapping opens the correct screen (deep link via Expo Router)
- [ ] Batch notifications: if 5+ messages in a group within 5 min, send single "X new messages" notification
- [ ] Respect user mute settings per group (future: group-level mute toggle)

---

### FW-59: Notification Settings Screen
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Add a notification preferences screen accessible from Profile, allowing users to toggle each notification type.

**Acceptance Criteria:**
- [ ] New screen `app/notification-settings.tsx` with toggle switches for each notification type
- [ ] Toggle categories: Score Updates, Game Reminders, Watch Party Reminders, Group Activity, Moment Alerts, Clip Notifications
- [ ] Toggles persist to `users.notification_preferences` in Supabase
- [ ] Optimistic UI — toggle updates immediately, syncs in background
- [ ] Add "Notifications" menu item back to Profile screen, linking to this screen
- [ ] If push permission not granted, show "Enable in Settings" prompt at top

---

## EPIC: FW-E12 — Social Sharing & Creator Tools
**Sprint 12 (Weeks 23-24) · 24 Points**

---

### FW-60: Social Sharing — Clips & Moments
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Enable sharing clips and moments to external platforms (Instagram, TikTok, Twitter/X, WhatsApp). Use Expo's Share API for native share sheets.

**Acceptance Criteria:**
- [ ] Share button on every clip card opens native share sheet
- [ ] Share payload includes: clip title, description, deep link URL (`fansphere://clip/{id}`)
- [ ] Share button on moments opens native share sheet with moment text + deep link
- [ ] Watch party cards have share button → shares party details + deep link
- [ ] Fan group cards have invite share → "Join [Group Name] on Fan Sphere!" + deep link
- [ ] Track share events in analytics: `content_shared` with type, id, platform
- [ ] Share sheet includes "Copy Link" option
- [ ] Deep links resolve correctly when app is installed (Expo Linking config)

---

### FW-61: Social Sharing — Branded Clip Export
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Export clips as video files with Fan Sphere branding overlay for sharing to TikTok/Instagram Reels. Make every shared clip a marketing vehicle.

**Acceptance Criteria:**
- [ ] "Export Clip" button on clip detail/viewer
- [ ] Exported video includes Fan Sphere watermark (bottom-right corner, semi-transparent)
- [ ] Exported video includes caption overlay: clip title + "@FanSphere" handle
- [ ] Export respects platform aspect ratios: 9:16 for TikTok/Reels, 1:1 for feed
- [ ] Export saves to device camera roll via `expo-media-library`
- [ ] Loading indicator during export processing
- [ ] Track exports in analytics: `clip_exported`

---

### FW-62: Creator Profile & Follow System
**Type:** Story · **Points:** 8 · **Priority:** Highest
**Assignee:** Full Stack Dev

**Description:**
Enable users to follow other users (not just teams). Build the foundation for creator/influencer features. Users who post great clips and moments should be discoverable and followable.

**Acceptance Criteria:**
- [ ] New `user_follows` table: `id UUID`, `follower_id UUID`, `following_id UUID`, `created_at TIMESTAMPTZ`, `UNIQUE(follower_id, following_id)`
- [ ] RLS: users can read all follows, insert/delete own follows only
- [ ] Follow/Unfollow button on user profiles and next to usernames in clips/moments
- [ ] `users` table gets new columns: `follower_count INT DEFAULT 0`, `following_count INT DEFAULT 0`
- [ ] Triggers to increment/decrement follower/following counts
- [ ] Profile screen shows follower + following counts
- [ ] Tapping follower/following count opens list of users
- [ ] "Following" feed in clips tab filters to clips from followed users
- [ ] User search in Discover tab — search by display name
- [ ] Optimistic UI for follow/unfollow with revert on failure

---

### FW-63: Creator Analytics Dashboard
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Give content creators basic analytics on their posts. Show views, likes, shares, and follower growth on a dedicated screen.

**Acceptance Criteria:**
- [ ] New screen `app/creator-stats.tsx` accessible from Profile
- [ ] Summary cards: Total Views, Total Likes, Total Shares, Followers
- [ ] List of user's clips sorted by engagement (likes + views)
- [ ] List of user's moments sorted by reaction count
- [ ] Time period filter: Last 7 days, Last 30 days, All Time
- [ ] Data fetched from Supabase aggregations on `media_clips`, `clip_likes`, `analytics_events`
- [ ] Add "My Stats" menu item to Profile screen

---

### FW-64: Edit Profile Screen
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Complete the Edit Profile flow. Allow users to update display name, avatar, home city, and bio.

**Acceptance Criteria:**
- [ ] New screen `app/edit-profile.tsx` accessible from Profile
- [ ] Editable fields: Display Name, Bio (new `bio TEXT` column, max 160 chars), Home City
- [ ] Avatar picker using `expo-image-picker` — select from camera or gallery
- [ ] Avatar uploaded to Supabase Storage bucket `avatars/`
- [ ] `users.avatar_url` updated with storage URL
- [ ] Avatar displayed as actual image throughout app (replace emoji placeholder)
- [ ] Form validation: display name required (2-30 chars), bio optional
- [ ] Save button with loading state, success confirmation
- [ ] Re-enable "Edit Profile" button on Profile screen

---

# Phase 6: Growth & Polish (Sprints 13-15)

---

## EPIC: FW-E13 — Gamification & Engagement
**Sprint 13 (Weeks 25-26) · 21 Points**

---

### FW-65: Achievement Badges System
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack Dev

**Description:**
Add gamification to drive engagement. Award badges for key actions (first group join, first watch party, first clip, etc.). Display badges on user profiles.

**Acceptance Criteria:**
- [ ] New `badges` table: `id UUID`, `key TEXT UNIQUE`, `name TEXT`, `description TEXT`, `icon TEXT`, `category TEXT`
- [ ] New `user_badges` table: `id UUID`, `user_id UUID`, `badge_id UUID`, `earned_at TIMESTAMPTZ`, `UNIQUE(user_id, badge_id)`
- [ ] Seed 15+ badges: First Group, First Watch Party, First Clip, First Moment, 10 Groups, 5 Watch Parties, World Cup Fan, City Explorer (3+ cities), Super Host (created 5+ parties), Trending Clip (100+ likes), Game Day Regular (10+ RSVPs), Early Adopter, Social Butterfly (50+ followers), All-In Fan (3+ all_in tier teams), Sports Nut (follow 5+ sports)
- [ ] Badge earned triggers: Supabase trigger functions that check conditions after relevant inserts
- [ ] Profile screen shows earned badges as a horizontal scroll row
- [ ] Badge earned notification (in-app toast, not push)
- [ ] Badge detail modal showing description and date earned

---

### FW-66: Activity Streaks
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Full Stack Dev

**Description:**
Track daily active streaks to encourage daily app usage. Show streak count on profile and home screen.

**Acceptance Criteria:**
- [ ] New `user_streaks` table: `user_id UUID PRIMARY KEY`, `current_streak INT DEFAULT 0`, `longest_streak INT DEFAULT 0`, `last_active_date DATE`
- [ ] On each app open (after auth), call RPC `record_daily_activity` that increments streak if new day, resets if gap > 1 day
- [ ] Home screen header shows streak badge: "🔥 5-day streak"
- [ ] Profile screen shows current + longest streak
- [ ] Streak milestone badges at 7, 30, 100 days
- [ ] Streak survives 1 "grace day" (miss one day, streak preserved once per 30 days)

---

### FW-67: Trending Content & Recommendations
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack Dev

**Description:**
Add algorithmic content discovery. Surface trending clips, hot groups, and popular watch parties based on engagement signals.

**Acceptance Criteria:**
- [ ] Supabase materialized view `trending_clips`: top clips by `(like_count * 3 + view_count) / age_hours` over last 7 days
- [ ] Supabase materialized view `trending_groups`: top groups by `member_count + (message_count_7d * 2)`
- [ ] Supabase materialized view `hot_watch_parties`: parties with highest RSVP velocity in last 24h
- [ ] Materialized views refreshed every 15 minutes via Supabase cron
- [ ] Home screen "Trending" section showing top 5 clips horizontally
- [ ] Discover screen "Hot Groups" section
- [ ] Discover screen "Popular This Week" watch parties section
- [ ] "For You" tab in clips feed uses trending algorithm + followed teams weighting

---

### FW-68: Reusable UI Components Library
**Type:** Story · **Points:** 5 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Extract duplicated UI patterns into shared reusable components. Reduce code duplication and ensure visual consistency.

**Acceptance Criteria:**
- [ ] `<SearchBar />` component extracted — used in WCFanGroups, WCWatchParties, Discover, Groups (replaces 5+ inline implementations)
- [ ] `<FilterPillRow />` component extracted — used in WCSchedule, WCFanGroups, WCWatchParties, Clips (replaces 5+ inline implementations)
- [ ] `<EmptyState />` component with icon, title, subtitle, CTA button props — replaces 15+ inline empty states
- [ ] `<CardContainer />` base card with consistent borderRadius, padding, background, border
- [ ] `<LoadingSpinner />` full-screen and inline variants
- [ ] `<Toast />` component for success/error feedback (uses react-native-reanimated slide-in)
- [ ] All existing screens updated to use new shared components
- [ ] No visual regressions — screens look identical after refactor

---

### FW-69: Error Boundaries & Consistent Error Handling
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Add error boundaries around major screen groups and implement consistent error handling patterns. No more silent failures.

**Acceptance Criteria:**
- [ ] `<ErrorBoundary />` component wrapping each tab navigator child
- [ ] Error boundary shows friendly "Something went wrong" screen with retry button
- [ ] All Supabase queries wrapped in try-catch with user-facing feedback
- [ ] Failed API calls show inline error message (not just empty state)
- [ ] Network connectivity detection — show "No connection" banner when offline
- [ ] Retry logic: auto-retry once after 3 seconds on network failure
- [ ] Error tracking stub ready for Sentry integration (log errors to `console.error` in dev, analytics in prod)

---

## EPIC: FW-E14 — Accessibility & Localization
**Sprint 14 (Weeks 27-28) · 18 Points**

---

### FW-70: Accessibility — Labels, Roles & Touch Targets
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Make Fan Sphere accessible to users with disabilities. Add proper accessibility labels, roles, and ensure minimum touch target sizes throughout the app.

**Acceptance Criteria:**
- [ ] All `TouchableOpacity` components have `accessibilityLabel` describing the action
- [ ] All `TextInput` fields have `accessibilityLabel` and `accessibilityHint`
- [ ] All images/icons have `accessibilityLabel` or `accessibilityElementsHidden`
- [ ] Tab bar items have proper accessibility labels
- [ ] Minimum touch target size 44x44pt on all interactive elements
- [ ] Screen reader tested on iOS VoiceOver and Android TalkBack
- [ ] Modal components trap focus and announce on open
- [ ] Form validation errors announced to screen reader
- [ ] Dynamic content changes (new messages, score updates) announced via `accessibilityLiveRegion`

---

### FW-71: Color Contrast & Visual Accessibility
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Audit and fix color contrast ratios throughout the dark theme. Ensure WCAG 2.1 AA compliance for all text.

**Acceptance Criteria:**
- [ ] All text meets WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text)
- [ ] Audit `Colors.ts` — replace low-contrast pairs (e.g., `textMuted` on `background`)
- [ ] Replace hardcoded grays (`#aaa`, `#999`, `#888`) with accessible color constants
- [ ] Interactive elements have visible focus indicators
- [ ] Color is not the only means of conveying information (add icons/patterns alongside color)
- [ ] Test with grayscale mode enabled on both platforms

---

### FW-72: Localization Setup — i18n Infrastructure
**Type:** Story · **Points:** 5 · **Priority:** Medium
**Assignee:** Frontend Dev

**Description:**
Set up internationalization infrastructure using `expo-localization` and `i18n-js`. Extract all user-facing strings to translation files. Initial languages: English (default) + Spanish.

**Acceptance Criteria:**
- [ ] Install `expo-localization` and `i18n-js`
- [ ] Create `i18n/` directory with `en.json` and `es.json` translation files
- [ ] Extract ALL user-facing strings from screens and components to translation keys
- [ ] `useTranslation()` hook or `t()` function available in all components
- [ ] App detects device language on first launch and sets accordingly
- [ ] Language picker in Settings (future screen)
- [ ] Date/time formatting respects locale
- [ ] Number formatting (member counts, RSVP counts) respects locale
- [ ] RTL layout support prepared (don't break, but don't fully implement)
- [ ] Spanish translations complete for all auth, onboarding, home, and World Cup screens

---

### FW-73: Offline Mode & Caching
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack Dev

**Description:**
Implement basic offline support so the app doesn't go blank when connectivity drops. Cache key data locally and show stale data with "offline" indicator.

**Acceptance Criteria:**
- [ ] Network connectivity listener using `@react-native-community/netinfo`
- [ ] Global "Offline" banner component shown when no connection
- [ ] Home screen data cached in AsyncStorage after each successful fetch
- [ ] On launch with no network, load cached data instead of showing empty/error
- [ ] User's followed teams, groups, and RSVP history cached locally
- [ ] Cache TTL: 1 hour for game data, 24 hours for group/team data
- [ ] Cache invalidated on successful refresh
- [ ] Offline actions queued (RSVP, message, follow) and synced when back online
- [ ] "Last updated X minutes ago" timestamp shown when serving cached data

---

## EPIC: FW-E15 — Brand Identity & Growth Hooks
**Sprint 15 (Weeks 29-30) · 20 Points**

---

### FW-74: Onboarding Welcome & Value Proposition Screen
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Add a welcome screen before sign-up that communicates the Fan Sphere value proposition. Hook users in the first 5 seconds.

**Acceptance Criteria:**
- [ ] New screen `app/(auth)/welcome.tsx` — first screen before sign-in/sign-up
- [ ] 3 swipeable panels with illustrations/animations:
  - Panel 1: "Your crew, any city, every game" — show groups + chat imagery
  - Panel 2: "Watch parties everywhere" — show map pins + party cards
  - Panel 3: "Capture the moment" — show clips + reactions
- [ ] "Get Started" CTA → navigates to sign-up
- [ ] "Already have an account?" → navigates to sign-in
- [ ] Social proof line: "Join thousands of sports fans" (or actual count from DB)
- [ ] Shown only on first launch (AsyncStorage flag `has_seen_welcome`)
- [ ] Smooth page indicator dots and swipe transitions

---

### FW-75: Invite Friends & Referral Flow
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full Stack Dev

**Description:**
Make it easy for users to invite friends. Every user should be a growth channel. Implement invite sharing with tracking.

**Acceptance Criteria:**
- [ ] "Invite Friends" button on Profile screen and empty states
- [ ] Share message: "Join me on Fan Sphere! Your crew, any city, every game. [deep link]"
- [ ] Referral tracking: `users.referred_by UUID` column + `referral_code TEXT UNIQUE`
- [ ] Each user gets a unique referral code on sign-up
- [ ] Deep link includes referral code: `fansphere://invite/{code}`
- [ ] On sign-up via referral link, `referred_by` set to referrer's user ID
- [ ] "Recruiter" badge earned after 3 successful referrals
- [ ] Profile shows "X friends invited" count

---

### FW-76: In-App Group Invite & Deep Links
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Enable group admins and members to invite others directly into a specific fan group or watch party via shareable deep links.

**Acceptance Criteria:**
- [ ] "Invite to Group" button in fan group detail header
- [ ] Generates shareable link: `fansphere://group/{id}` with group name in share text
- [ ] "Share Party" button on watch party detail screen
- [ ] Generates shareable link: `fansphere://party/{id}` with party details in share text
- [ ] Deep links open correct screen when app is installed
- [ ] If app not installed, deep link redirects to App Store / Play Store (Expo Linking)
- [ ] Invite tracking in analytics: `invite_shared`, `invite_opened`

---

### FW-77: Brand Voice & Micro-Copy Polish
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev / Copywriter

**Description:**
Final pass on all user-facing copy. Replace generic language with energetic, brand-aligned sports voice. Make the app feel alive.

**Acceptance Criteria:**
- [ ] All button labels reviewed: use action verbs ("Rally the Crew", "Drop a Clip", "Lock In")
- [ ] All section headers reviewed: use engaging language ("Game Day Lineup", "Your Crew", "Hot Takes")
- [ ] Loading states use fun messages: "Warming up...", "Getting game-ready..."
- [ ] Error states use supportive messages: "Fumble! Let's try that again."
- [ ] Tier descriptions rewritten to be aspirational:
  - Lite → "Stay in the Loop" — "Scores and top plays, no noise"
  - Social → "Join the Tribe" — "Chat, parties, and your crew's best clips"
  - All-In → "Live the Game" — "Every alert, every moment, nothing missed"
- [ ] All copy documented in a single `i18n/en.json` file (overlaps with FW-72)

---

### FW-78: Haptics & Micro-Interactions
**Type:** Story · **Points:** 3 · **Priority:** Low
**Assignee:** Frontend Dev

**Description:**
Add subtle haptic feedback and micro-interactions to make the app feel polished and responsive. Sports fans love visceral feedback.

**Acceptance Criteria:**
- [ ] Haptic feedback on: RSVP toggle, follow/unfollow, like, send message, tier change
- [ ] Use `expo-haptics` — `impactAsync(ImpactFeedbackStyle.Light)` for taps, `Medium` for confirms
- [ ] Animated heart on double-tap like (already exists in clips — ensure consistent)
- [ ] Pull-to-refresh has spring animation (already via RefreshControl)
- [ ] Tab bar icon bounce on active tab change
- [ ] RSVP button state transition animation (color fade, checkmark appear)
- [ ] Score update in game card — brief highlight flash animation

---

### FW-79: App Store Preparation & Metadata
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Product Owner

**Description:**
Prepare all assets and metadata needed for App Store and Google Play Store submission.

**Acceptance Criteria:**
- [ ] App icon (1024x1024 + all required sizes) — Fan Sphere branding
- [ ] Splash screen with Fan Sphere logo and tagline
- [ ] 6 App Store screenshots (iPhone 15 Pro Max + iPhone SE sizes)
- [ ] 6 Google Play Store screenshots (phone + tablet)
- [ ] App Store description (short + long) with keywords
- [ ] Privacy Policy URL
- [ ] Terms of Service URL
- [ ] App Store categories selected: Sports, Social Networking
- [ ] Age rating: 12+ (user-generated content)
- [ ] `app.json` updated with production bundle identifiers, version, and build numbers
- [ ] EAS Build configured for production builds

---

### FW-80: Invite watch-party guests from phone contacts
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Frontend Dev
**Epic:** FW-E3 Watch Parties

**Description:**
On the create-private-watch-party flow, replace the manual "Name + phone number" entry as the primary path with a picker that pulls invitees directly from the user's phone contacts (iOS Contacts / Android Contacts). Keep manual entry as a secondary option for friends not in the address book.

**Acceptance Criteria:**
- [ ] When visibility is set to "Private", an "Add from Contacts" button appears above the manual form
- [ ] Tapping it requests OS contacts permission once; on deny, user sees a clear message and the manual form remains usable
- [ ] Permission-granted path opens a modal listing contacts with phone numbers, sorted alphabetically, with a search bar
- [ ] Tapping a contact with one phone number adds it to the invite list immediately
- [ ] Tapping a contact with multiple phone numbers prompts to pick one via an action sheet
- [ ] "Enter manually" toggle reveals the existing name+phone form
- [ ] Duplicate-phone entries are silently deduped
- [ ] Selected contacts save to `watch_party_invites` with `{name, phone}` (unchanged schema)
- [ ] `NSContactsUsageDescription` (iOS) and `READ_CONTACTS` (Android) configured in `app.json`
- [ ] Works in Expo Go — no dev-build required

**Technical Notes:**
- Uses `expo-contacts` (installed for this story) — reads directly from the device address book; no Expo-owned directory
- Fetches with `fields: [Name, PhoneNumbers]` to minimize permission surface
- No backend migration — `watch_party_invites` shape is preserved

---

### FW-81: Persist onboarding completion server-side
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Full-stack
**Epic:** FW-E1 Foundation & Auth

**Description:**
The `onboarding_complete` flag currently lives only in device AsyncStorage. Any wipe (uninstall/reinstall, device switch, Expo Go cache clear) resets it and forces the user back through onboarding. Move the truth to the `users` table so completion survives device state changes.

**Acceptance Criteria:**
- [ ] `users.onboarded_at TIMESTAMPTZ` column added via migration
- [ ] Migration back-fills `onboarded_at` for any user who has rows in `user_team_follows` using the earliest follow timestamp
- [ ] `onboarding-city.tsx` writes `home_city` and `onboarded_at` to `users` at flow completion (currently only AsyncStorage)
- [ ] `_layout.tsx` NavigationGuard treats a user as onboarded if any of: AsyncStorage cache flag, `users.onboarded_at` set, or any row in `user_team_follows` for that user
- [ ] AsyncStorage cache is still written on success so first-paint after relaunch is zero-flash
- [ ] Routing survives a `pm clear` / fresh install of Expo Go without re-onboarding

**Technical Notes:**
- Client falls back to the `user_team_follows` count check when the new column isn't yet deployed, so the client fix is useful on its own.
- Migration `020_onboarded_at.sql` is idempotent (uses `ADD COLUMN IF NOT EXISTS`).

---

### FW-82: Edit team preferences from profile without re-onboarding
**Type:** Story · **Points:** 2 · **Priority:** Medium
**Assignee:** Frontend Dev
**Epic:** FW-E3 Watch Parties (preferences adjacent to teams)

**Description:**
Users who want to change the teams/sports they follow currently have no clean path — re-onboarding is the only way. Profile already has a "My Teams" entry with a "+ Follow More Teams" button, but the flow after saving forces the user through city selection again. Add an `edit` mode that short-circuits the post-save routing.

**Acceptance Criteria:**
- [ ] Profile → "My Teams" screen has a working "+ Follow More Teams" entry point (already exists)
- [ ] When entered with `mode=edit`, `onboarding-teams.tsx` returns to the previous screen (My Teams) on save instead of pushing to `onboarding-city`
- [ ] Long-press on a team in My Teams unfollows it (already exists)
- [ ] Sport filter pills at the top of `onboarding-teams.tsx` work in edit mode so users can browse beyond their original sport picks

**Out of scope (follow-up):**
- Dedicated "My Sports" editor — sports are not persisted server-side today (they're just a filter for onboarding-teams). Revisit when/if `users.favorite_sport_ids` is added.

---

### FW-83: Post a clip from the Clips tab
**Type:** Story · **Points:** 5 · **Priority:** High
**Assignee:** Full-stack
**Epic:** FW-E6 Clips Feed

**Description:**
The Clips tab had no affordance for uploading a clip — users could read but not contribute. Add an upload FAB with camera/library picker, a caption-first create screen, and a Supabase storage bucket to hold the videos.

**Acceptance Criteria:**
- [ ] Floating "+" FAB on Clips tab (bottom-right, above the tab bar)
- [ ] Tap opens action sheet: Record new / Choose from library / Cancel
- [ ] Camera path requests `Camera` permission, opens the OS video recorder, caps at 60s
- [ ] Library path requests media library permission, opens the OS video picker
- [ ] After capture/pick, routes to `create-clip.tsx` with the video URI + duration
- [ ] Create-clip screen shows: looping muted preview, required caption (≤80 chars), optional description (≤300 chars), Post button
- [ ] Post uploads the video blob to the `clips` Supabase Storage bucket under `<user_profile_id>/<timestamp>.<ext>`
- [ ] Inserts a row into `media_clips` with `title`, `description`, `media_url`, `media_type='video'`, `duration_seconds`
- [ ] On success: router.back() returns to the feed
- [ ] Error states: network failure shows an alert; user can retry without losing input
- [ ] Horizontal pill row above the feed scrolls properly (bug fix for SportPill — was using `overflow: 'scroll'` on a `View` which has no effect on native)

**Technical Notes:**
- Migration `021_clips_storage_bucket.sql` provisions the bucket (50 MB/file cap, public read, authenticated write scoped to owner's folder)
- `media_clips` INSERT policy from migration 002 already requires `user_id = auth.uid()`, so no policy changes needed on the table
- No video transcoding, trimming, or thumbnail selection in v1 — deferred

---

### FW-84: Auto-create user profile on signup
**Type:** Bug · **Points:** 2 · **Priority:** High
**Assignee:** Backend Dev
**Epic:** FW-E1 Foundation & Auth

**Description:**
Nothing in the codebase creates a `public.users` row when a user signs up via Supabase auth. The auth record exists in `auth.users` but `public.users` (where display name, home city, avatar, onboarded_at, etc. live) is empty. Any feature that joins on `public.users` — profile, my-teams, my-clips, creator-stats, create-clip — crashes with "profile not found" until the row is provisioned. Surfaced when posting a clip failed for a brand-new account.

**Acceptance Criteria:**
- [ ] Postgres trigger on `auth.users` INSERT creates a `public.users` row with `auth_id = NEW.id`
- [ ] Trigger function is `SECURITY DEFINER` so it can write regardless of session RLS
- [ ] `display_name` seeded from `raw_user_meta_data.display_name`, falls back to email local-part, then to `'Fan'`
- [ ] `ON CONFLICT (auth_id) DO NOTHING` so re-running the migration is idempotent
- [ ] Back-fill: any existing `auth.users` without a matching `public.users` row gets one on migration apply
- [ ] `create-clip.tsx` self-heal path stays as a belt-and-suspenders fallback for pre-trigger accounts and edge cases

**Technical Notes:**
- Migration: `022_user_profile_trigger.sql`
- Trigger name: `on_auth_user_created`
- Follow-up: consider extending the trigger to seed `onboarded_at` from `raw_user_meta_data` if the signup flow starts collecting it up front

---

# Phase 7: Monetization Launch (Sprints 16-18)

> **Driver:** World Cup 2026 kickoff June 11. Premium subscription ($9.99/mo or $107.88/yr 10%-off annual) with mandatory 7-day free trial, plus separate $19.99 WC Pass. Trial captures card-on-file via Apple IAP / Google Play. Post-trial cancellation = read-only with carve-outs (watch parties hidden as ghost cards to prevent free-riders showing up uninvited).

## EPIC: FW-E16 — Monetization Foundation (Premium + WC Pass)
**Sprint 16-17 · 62 Points**

---

### FW-85: Entitlements Schema & RLS Functions
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Create the database tables and SQL functions that track Premium subscription and WC Pass entitlements. Source of truth for who has access to what; written only by the RevenueCat webhook (service_role).

**Acceptance Criteria:**
- [ ] Migration `032_entitlements.sql` created
- [ ] `users.subscription_status TEXT DEFAULT 'none'` — values: `none | trial | active | cancelled | expired`
- [ ] `users.premium_active_until TIMESTAMPTZ`
- [ ] `users.wc_pass_active_until TIMESTAMPTZ`
- [ ] `entitlements` table: `id, user_id, product_id, status, original_transaction_id UNIQUE, expires_at, raw_payload JSONB, created_at, updated_at`
- [ ] `purchase_events` table: `id, event_id UNIQUE, user_id, event_type, payload JSONB, processed BOOL, created_at` — supports webhook idempotency
- [ ] RLS: users SELECT own entitlements; INSERT/UPDATE/DELETE service_role only
- [ ] SQL fn `public.has_premium_access(uid UUID) RETURNS BOOLEAN` (STABLE) — true when `subscription_status IN ('trial','active')` AND `premium_active_until > now()`
- [ ] SQL fn `public.has_wc_access(uid UUID) RETURNS BOOLEAN` (STABLE) — true during trial OR when `wc_pass_active_until > now()`
- [ ] Migration applied to remote via `supabase db push`

---

### FW-86: Paywall RLS Policies on Writes
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Layer entitlement checks on existing INSERT/UPDATE policies for the write surfaces that should be paid-only. Defence-in-depth: even if a client bypass exists, the database rejects.

**Acceptance Criteria:**
- [ ] Migration `033_paywall_policies.sql` created
- [ ] `watch_parties` INSERT: requires `has_premium_access(auth.uid())`; additionally `has_wc_access` when `event_id` = WC event
- [ ] `watch_party_rsvps` INSERT: requires `has_premium_access`; requires `has_wc_access` if linked party is WC
- [ ] `chat_rooms` INSERT: requires `has_premium_access`; requires `has_wc_access` if `group_type = 'worldcup'`
- [ ] `chat_room_members` INSERT: same constraint as parent room
- [ ] `user_team_follows` INSERT: requires `has_premium_access`; requires `has_wc_access` when team.league_id = WC league
- [ ] `match_moments` INSERT: requires `has_premium_access`; requires `has_wc_access` when parent chat_room is WC
- [ ] `media_clips` INSERT: requires `has_premium_access`
- [ ] `messages` INSERT: requires `has_premium_access` (gates chat for cancelled users)
- [ ] Negative test query proves each policy denies a `none`-status user
- [ ] Migration applied to remote

---

### FW-87: RevenueCat Webhook Edge Function
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Build the Supabase Edge Function that receives RevenueCat webhooks and writes entitlements. Idempotent on `event_id`; signature-verified; returns 200 fast.

**Acceptance Criteria:**
- [ ] `supabase/functions/revenuecat-webhook/index.ts` created (model on `supabase/functions/process-notification-queue/index.ts`)
- [ ] Verifies RevenueCat signature header against Vault secret `fan_wave_revenuecat_webhook_secret`
- [ ] Vault secret created via `vault.create_secret()` (one-time, documented in deploy notes)
- [ ] Idempotency check: insert into `purchase_events` first with `ON CONFLICT (event_id) DO NOTHING`; if already exists, return 200 without re-processing
- [ ] Handles event types: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `NON_RENEWING_PURCHASE` (WC pass), `REFUND`, `BILLING_ISSUE`
- [ ] Upserts `entitlements` row keyed on `original_transaction_id`
- [ ] Denormalizes to `users.subscription_status`, `users.premium_active_until`, `users.wc_pass_active_until`
- [ ] Returns HTTP 200 within 500ms (no blocking work after the upsert)
- [ ] Deployed with `--no-verify-jwt` (RevenueCat sends signature header, not JWT)
- [ ] Unit test fires sample payload for each event type and asserts correct DB state

---

### FW-88: App Store / Play Store Product Setup
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Product Owner + Backend Dev

**Description:**
Configure the three IAP products in App Store Connect and Google Play Console, with the 7-day free trial intro offer on the auto-renewable subscriptions.

**Acceptance Criteria:**
- [ ] App Store Connect:
  - [ ] `premium_monthly_999` auto-renewable subscription, $9.99/mo, 7-day free trial intro
  - [ ] `premium_annual_10788` auto-renewable subscription, $107.88/yr, 7-day free trial intro
  - [ ] `wc_pass_2026` non-consumable, $19.99 (no trial)
- [ ] Google Play Console: same three products mirrored with equivalent pricing/trial
- [ ] Apple Small Business Program enrollment submitted (15% fee — Fan Sphere qualifies under $1M annual)
- [ ] Banking + Tax & Agreements signed in App Store Connect
- [ ] Sandbox testers configured (Apple) + license testers (Google)
- [ ] Products visible in TestFlight / Internal Testing build

---

### FW-89: RevenueCat Dashboard Configuration
**Type:** Story · **Points:** 2 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Wire RevenueCat's entitlements and webhook destination to the products created in FW-88.

**Acceptance Criteria:**
- [ ] RevenueCat project created for Fan Sphere
- [ ] Entitlement `premium` linked to both `premium_monthly_999` and `premium_annual_10788`
- [ ] Entitlement `wc_pass` linked to `wc_pass_2026`
- [ ] Webhook URL points to Supabase Edge Function from FW-87
- [ ] Shared secret stored both in RevenueCat dashboard and in Supabase Vault (matched)
- [ ] App Store Connect + Play Console credentials uploaded to RevenueCat for receipt validation
- [ ] Test event fired from RevenueCat dashboard → verified end-to-end in Supabase logs

---

### FW-90: Entitlements Client Hooks
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Build the React hooks that the rest of the app uses to check entitlement state. Live-updating via Supabase Realtime so post-webhook entitlement changes propagate without app restart.

**Acceptance Criteria:**
- [ ] `lib/entitlements.ts` created
- [ ] `useHasPremium()` returns boolean from current user's `subscription_status` + `premium_active_until`
- [ ] `useHasWCAccess()` returns boolean from `wc_pass_active_until` OR active premium during trial
- [ ] `useSubscriptionState()` returns object: `{ status, premiumUntil, wcUntil, isTrial, isCancelled }`
- [ ] Subscribes to Realtime UPDATE on `users` table filtered to current user.id — entitlement flips live after webhook
- [ ] Cached via React Query with 30s stale time
- [ ] `react-native-purchases` SDK installed and configured in `app/_layout.tsx` with `Purchases.logIn(user.id)` on auth
- [ ] Tests cover: trial → expired transition, cancellation, pass active vs expired

---

### FW-91: Premium Paywall Sheet
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Bottom-sheet paywall component that presents the Premium subscription with the 7-day free trial offer. Required UX elements per Apple/Google review guidelines.

**Acceptance Criteria:**
- [ ] `components/paywall/PremiumPaywall.tsx` created
- [ ] Monthly/Annual segment toggle (annual shows "Save 10%" badge)
- [ ] "Start 7-Day Free Trial" CTA button (loads Apple/Google native purchase dialog)
- [ ] Feature bullet list of what Premium unlocks (creator features, ad-free, unlimited groups, etc.)
- [ ] "Restore Purchases" button (calls `Purchases.restorePurchases()`)
- [ ] Footer copy: "Subscriptions auto-renew unless cancelled in App Store / Play Store"
- [ ] Terms of Service + Privacy Policy links
- [ ] Three states: pre-purchase, loading, success
- [ ] Renders correctly with safe-area insets on Android 3-button nav
- [ ] Dismiss on tap-outside or X button

---

### FW-92: WC Pass Paywall Sheet
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Bottom-sheet for the one-time $19.99 WC Pass purchase. Triggered when a user without WC access taps a WC-tab CTA.

**Acceptance Criteria:**
- [ ] `components/paywall/WCPassPaywall.tsx` created
- [ ] Title: "World Cup 2026 Pass"
- [ ] Price: $19.99 one-time, "Valid June 1 – July 31, 2026"
- [ ] Feature bullet list (join WC groups, RSVP WC parties, follow national teams, post WC moments)
- [ ] "Buy Pass" CTA (one-time IAP via RevenueCat)
- [ ] Restore Purchases button
- [ ] Safe-area inset compliant

---

### FW-93: Choose Plan Onboarding Screen
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
First screen after account creation. User selects Monthly or Annual Premium, triggers the system trial flow.

**Acceptance Criteria:**
- [ ] Route `app/(auth)/choose-plan.tsx` created
- [ ] Two large cards: "Premium Monthly $9.99/mo" and "Premium Annual $107.88/yr (Save 10%)"
- [ ] Both cards lead with "7-day Free Trial" badge
- [ ] Selecting either triggers RevenueCat purchase flow (system dialog handles card capture)
- [ ] Required disclosure copy below CTAs: trial length, auto-renew terms, cancel anywhere in App Store / Play Store
- [ ] No "Skip" option — choosing a plan is mandatory to enter the app
- [ ] On successful purchase, navigates to `wc-pass-offer` screen
- [ ] On user-initiated cancel of the system dialog, returns to this screen (no auto-progression)

---

### FW-94: Optional WC Pass Add-On Screen
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
Post-Premium-trial-start screen offering the WC Pass as an optional add-on. Skippable.

**Acceptance Criteria:**
- [ ] Route `app/(auth)/wc-pass-offer.tsx` created
- [ ] Hero copy: "Get the World Cup 2026 Pass — $19.99"
- [ ] Feature list mirroring FW-92
- [ ] "Add WC Pass" button (triggers IAP)
- [ ] "Skip — Maybe Later" button (proceeds to tabs without purchase)
- [ ] On successful purchase, navigates to `(tabs)` with success toast
- [ ] On skip, navigates to `(tabs)` directly — user can buy later from Settings

---

### FW-95: NavigationGuard Subscription Routing
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Extend the existing NavigationGuard in `app/_layout.tsx` to route signed-in users based on their subscription state. Two routing branches: no plan chosen → Choose Plan; cancelled/expired → Resubscribe landing screen (no main-app access).

**Acceptance Criteria:**
- [ ] `app/_layout.tsx` NavigationGuard updated
- [ ] When `session` is present and `subscription_status === 'none'` → redirect to `/(auth)/choose-plan`
- [ ] When `subscription_status === 'trial' | 'active'` → allow full app access
- [ ] When `subscription_status === 'cancelled' | 'expired'` → redirect to `/(auth)/resubscribe` (FW-113); main app routes refuse to render
- [ ] Loading state during entitlement fetch — no paywall flash before data arrives
- [ ] No infinite redirect loop (test edge cases: session + still-loading entitlements)
- [ ] Push notifications still fire for cancelled users (re-engagement hook outside the app); tapping a notification lands them on the Resubscribe screen, not the app

---

### FW-96: PaywallGate Wrapper
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Reusable wrapper that gates any CTA behind an entitlement check. Triggers the appropriate paywall sheet when an unentitled user taps a wrapped element. (Originally included a GhostCard component for cancelled-user read-only states; that's no longer needed since cancelled users are routed straight to the Resubscribe screen and never see app surfaces.)

**Acceptance Criteria:**
- [ ] `components/paywall/PaywallGate.tsx` — props: `{ require: 'premium' | 'wc_pass', children }`
- [ ] If `require='premium'` and `useHasPremium()` is false → tapping child triggers PremiumPaywall sheet
- [ ] If `require='wc_pass'` and `useHasWCAccess()` is false → tapping triggers WCPassPaywall sheet
- [ ] If entitled, renders child untouched (passes-through props)
- [ ] Supports both single-element wrapping and a `disabled-overlay` style for whole sections

---

### FW-97: Apply Premium Gates Across App
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Wrap every Premium-only CTA with PaywallGate. Trial-paying and active-paying users see everything; cancelled users never reach these surfaces (they're stuck on the Resubscribe screen per FW-95). The remaining wrap-with-paywall scope handles the WC Pass case for paying-but-no-pass users and trial users hitting Premium-gated upgrade surfaces.

**Acceptance Criteria:**
- [ ] Post clip CTA in `app/create-clip.tsx` — wrapped (premium)
- [ ] Post moment CTA in `components/MomentsFeed.tsx` — wrapped (premium)
- [ ] Message send in `app/fan-group/[id].tsx:handleSend` — gate at function entry (premium); show paywall on attempt
- [ ] RSVP buttons in watch party detail screens — wrapped (premium)
- [ ] Create watch party / create group flows — wrapped at entry (premium)
- [ ] Follow team CTA in `WCTeamFollowModal` and team follow surfaces — wrapped (premium)
- [ ] All gates tested against `subscription_status='cancelled'` user manually (should never see them — confirms FW-95 routes correctly)

---

### FW-98: Apply WC Pass Gates to World Cup Tab
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Gate the engagement actions on the World Cup tab behind the WC Pass entitlement. Browsing schedule stays open to all Premium users so they see the value before paying.

**Acceptance Criteria:**
- [ ] `app/(tabs)/world-cup.tsx` — schedule view remains visible to all Premium users
- [ ] RSVP/create CTAs in `WCWatchParties` — wrapped (wc_pass)
- [ ] Join/create CTAs in `WCFanGroups` — wrapped (wc_pass)
- [ ] Follow action in `WCTeamFollowModal` — wrapped (wc_pass) when team is WC team
- [ ] Post Moment button in WC fan group highlights — wrapped (wc_pass)
- [ ] During the 7-day trial: WC tab fully unlocked (trial grants both premium AND wc_access)
- [ ] After trial conversion (no Pass purchased): WC engagement triggers WCPassPaywall
- [ ] WC tab hidden entirely for cancelled-status users (not just gated)

---

### FW-99: Settings — Subscription Screen
**Type:** Story · **Points:** 3 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
A subscription management screen accessible from Profile / Settings. Shows current state and provides Restore + manage links per platform policy.

**Acceptance Criteria:**
- [ ] Route `app/subscription.tsx` (or under settings) created
- [ ] Displays: current subscription status, plan (monthly/annual), renewal date, WC Pass active until (if owned)
- [ ] "Restore Purchases" button — calls `Purchases.restorePurchases()`
- [ ] "Manage Subscription" deep-link button — opens App Store / Play Store subscription management (platform-specific URL)
- [ ] "Add WC Pass" button visible when no pass owned, during the WC window
- [ ] Disclosure copy meets Apple/Google requirements
- [ ] Accessible via Profile tab → settings → Subscription

---

### FW-112: "Trial Ending Tomorrow" Push Notification
**Type:** Story · **Points:** 1 · **Priority:** Highest
**Assignee:** Backend Dev

**Description:**
Send a push notification ~24 hours before a user's free trial converts to a paid subscription. Single most-effective lever to reduce refund requests, 1-star reviews, and customer-service load — without weakening the auto-charge model's conversion rate. Trial-aware users either cancel (legitimately) or convert with eyes open; the surprise-charge cohort disappears.

**Acceptance Criteria:**
- [ ] Migration `035_trial_reminder_cron.sql` created
- [ ] pg_cron job runs hourly: selects users where `subscription_status='trial'` AND `premium_active_until` falls in the next 23–25h window
- [ ] For each, enqueues a row in `notification_queue` (from migration 018) with `payload` containing title + body
- [ ] Title: "Your free trial ends tomorrow"
- [ ] Body: "Your 7-day Fan Sphere trial ends tomorrow. We'll automatically charge $9.99/mo. Cancel anytime in Settings → Subscription."
- [ ] Deduplication: each user only gets ONE trial-end reminder per trial cycle (idempotent — `purchase_events` or a dedicated `trial_reminders_sent` table tracks)
- [ ] `process-notification-queue` Edge Function (existing) picks up the row and delivers via Expo Push API
- [ ] Tap on notification opens Settings → Subscription screen (FW-99)
- [ ] Tested with sandbox tester: starts trial, advances clock to T-24h, verifies push fires once

---

### FW-113: Resubscribe Landing Screen for Cancelled Users
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Single landing screen shown to users whose subscription has been cancelled or expired. Replaces "read-only main app" — cancelled users do not see app surfaces. Page acts as re-conversion landing: value-prop hero, Resubscribe CTA, optional teaser of what they're missing.

**Acceptance Criteria:**
- [ ] Route `app/(auth)/resubscribe.tsx` created
- [ ] Hero copy: "Welcome back to Fan Sphere — your subscription has ended"
- [ ] Status line: shows when subscription was cancelled / expired
- [ ] Feature bullet list reminding what Premium unlocks (top 4 features only)
- [ ] Optional teaser block: "Your 3 followed teams have games this week" — static text, not a tap target
- [ ] Primary CTA "Resubscribe ($9.99/mo)" — opens PremiumPaywall sheet (FW-91)
- [ ] Secondary CTA "Manage in App Store / Play Store" — deep-links to platform settings
- [ ] No way to bypass to the main app from this screen (NavigationGuard from FW-95 enforces)
- [ ] Sign Out button at the bottom (so cancelled user can switch accounts)
- [ ] Successful re-subscribe → entitlement updates via Realtime → user is routed to main app automatically

---

## EPIC: FW-E17 — Storage Hardening for WC Scale
**Sprint 17 · 22 Points**

---

### FW-100: Client-Side Pre-Upload Validation
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Frontend Dev

**Description:**
Reject oversized clips and overlong videos on the client before they touch Supabase Storage. Currently uploads bigger than the 50MB bucket cap fail after the upload attempt, wasting bandwidth and user trust.

**Acceptance Criteria:**
- [ ] `app/create-clip.tsx` validates: video duration ≤ 30 seconds AND file size ≤ 25 MB before calling `uploadAsync`
- [ ] `components/MomentsFeed.tsx` same validation on `pickClip` + `recordClip`
- [ ] On rejection, show friendly Alert: "Clip too long" or "Clip too large — please trim to 30s and try again"
- [ ] File size obtained via `expo-file-system`'s `getInfoAsync`
- [ ] Duration obtained from `ImagePicker.launchImageLibraryAsync` asset metadata
- [ ] Loading indicator shows during upload (replaces silent wait)

---

### FW-101: Unify Clip Duration to 30s
**Type:** Story · **Points:** 1 · **Priority:** High
**Assignee:** Frontend Dev

**Description:**
The Clips tab currently allows 60s recordings but moment clips are capped at 30s. Standardize on 30s everywhere for storage/bandwidth efficiency.

**Acceptance Criteria:**
- [ ] `app/(tabs)/clips.tsx` — `videoMaxDuration` set to 30
- [ ] No mention of 60s anywhere in clip-recording flows
- [ ] DB CHECK constraint or trigger optionally enforces clip duration ≤ 30s

---

### FW-102: Wire `check_rate_limit()` RPC Into Mutating Flows
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** Backend Dev + Frontend Dev

**Description:**
The `check_rate_limit()` Postgres function was added in migration 018 but is never called from app code. Wire it up to gate the high-volume mutating flows so abuse or runaway clients don't degrade the database.

**Acceptance Criteria:**
- [ ] Clip post in `app/create-clip.tsx` calls `check_rate_limit(user.id, 'clip_post', 5, 3600)` before upload — 5 per hour
- [ ] Moment post in `components/MomentsFeed.tsx` calls `check_rate_limit(user.id, 'moment_post', 10, 3600)` — 10 per hour per user
- [ ] Chat message send in `app/fan-group/[id].tsx:handleSend` calls `check_rate_limit(user.id, 'message_send', 60, 60)` — 60 per minute
- [ ] RSVP in watch party detail calls `check_rate_limit(user.id, 'rsvp', 20, 86400)` — 20 per day
- [ ] On rate-limit hit, show friendly toast: "Slow down — you're posting too quickly. Try again in a moment."
- [ ] Smoke test: post 6 clips in an hour — 6th is rejected before reaching Storage

---

### FW-103: Lower Clips Bucket File Size Limit
**Type:** Story · **Points:** 1 · **Priority:** High
**Assignee:** Backend Dev

**Description:**
Tighten the server-side hard reject on clip upload size, in lockstep with the client validation from FW-100.

**Acceptance Criteria:**
- [ ] Migration `034_storage_limits.sql` created
- [ ] `clips` bucket `file_size_limit` set to 26214400 (25 MB) — was 52428800 (50 MB)
- [ ] Manual test: upload >25 MB file → server returns 413 Payload Too Large
- [ ] Migration applied to remote

---

### FW-104: Storage Provider Abstraction
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Backend Dev + Frontend Dev

**Description:**
Extract upload logic into a single function so the future Cloudinary migration (FW-E18) is a one-file swap instead of touching 3+ surfaces.

**Acceptance Criteria:**
- [ ] `lib/storage.ts` created
- [ ] Single function `uploadClip(uri: string, opts: { contentType: string; subpath: string }): Promise<{ publicUrl: string }>`
- [ ] Implementation reads `EXPO_PUBLIC_STORAGE_PROVIDER` env (default `supabase`)
- [ ] Provider-switch architecture: switch case in body; only Supabase path implemented now
- [ ] `app/create-clip.tsx` calls `uploadClip(...)` (replaces inline `uploadAsync`)
- [ ] `components/MomentsFeed.tsx` same replacement for moment-clip uploads
- [ ] Type-safe interface ready for Cloudinary provider in FW-109

---

### FW-105: Supabase Egress Bandwidth Alerts
**Type:** Story · **Points:** 1 · **Priority:** Medium
**Assignee:** DevOps / Backend Dev

**Description:**
Set up dashboard alerts so we have early warning before exhausting the Supabase plan's monthly bandwidth quota during WC.

**Acceptance Criteria:**
- [ ] Alert configured at 70% of monthly bandwidth → notify on-call
- [ ] Alert configured at 90% → notify on-call + product owner
- [ ] Runbook entry in `docs/runbooks.md` documenting the response (upgrade plan, or accelerate Cloudinary migration)

---

### FW-106: Payment Flow Integration & E2E Tests
**Type:** Story · **Points:** 5 · **Priority:** Highest
**Assignee:** QA + Backend Dev

**Description:**
End-to-end test the full lifecycle: trial start → active → cancellation → re-subscribe → refund → WC Pass purchase. Both happy and negative paths.

**Acceptance Criteria:**
- [ ] Sandbox tester (Apple) goes through: signup → choose plan → trial starts → full app access (incl. WC tab) → advance time 7 days → auto-charge → WC tab gates with paywall
- [ ] Buy WC Pass via sandbox → WC tab re-opens
- [ ] Cancel Premium in App Store Settings → on next "Renew" date, entitlement revoked → ghost cards appear on watch parties + suggested groups → post clip blocked client-side AND server-side
- [ ] Apple-side refund fires webhook → entitlement revoked within 1 minute
- [ ] Fresh install on same Apple ID → Restore Purchases re-grants entitlement
- [ ] Rate-limit smoke: 6 consecutive clip posts in an hour → 6th gets rejected
- [ ] Webhook idempotency: fire same event_id twice → only one entitlement update
- [ ] Each test logged and signed off before submission

---

### FW-107: App Store + Play Store Submission
**Type:** Story · **Points:** 3 · **Priority:** Highest
**Assignee:** Product Owner + Frontend Dev

**Description:**
Submit the WC Pass + Premium subscription build to both stores and clear review before kickoff.

**Acceptance Criteria:**
- [ ] App Store screenshots updated to show paywall + WC Pass
- [ ] App Store metadata updated: subscription pricing disclosed in description
- [ ] Play Store screenshots + metadata updated similarly
- [ ] Production EAS build submitted with version code increment
- [ ] App Review notes: explain subscription model, sandbox test account credentials for reviewers
- [ ] **Hard deadline: submit by June 4, 2026** (5 days before kickoff to absorb 3–5-day review)
- [ ] Live in production by June 6, 2026

---

## EPIC: FW-E18 — Cloudinary Media Migration (Post-WC, Deferred)
**Sprint 18+ (Post-WC) · 12 Points**

---

### FW-108: Cloudinary Account Setup
**Type:** Story · **Points:** 2 · **Priority:** Medium
**Assignee:** Product Owner + DevOps

**Description:**
Sign up for Cloudinary and scope the right paid tier based on actual WC traffic data.

**Acceptance Criteria:**
- [ ] Cloudinary account created
- [ ] Plan selected based on WC bandwidth metrics (likely Plus $89/mo or Advanced $224/mo)
- [ ] `cloud_name`, `api_key`, `api_secret` stored in Supabase Vault
- [ ] Upload preset configured (auto-transcode, HLS streaming, eager thumbnail)
- [ ] Billing alerts configured at 70% / 90% of plan quota

---

### FW-109: Cloudinary Provider Implementation
**Type:** Story · **Points:** 3 · **Priority:** Medium
**Assignee:** Backend Dev + Frontend Dev

**Description:**
Add a Cloudinary implementation to the `lib/storage.ts` abstraction built in FW-104.

**Acceptance Criteria:**
- [ ] Cloudinary upload path implemented in `lib/storage.ts` switch
- [ ] Signed upload URLs generated server-side via Edge Function (don't expose API secret to client)
- [ ] `uploadClip()` returns Cloudinary public CDN URL when provider is `cloudinary`
- [ ] Existing playback code works unchanged with Cloudinary URLs (just a different domain)
- [ ] Tested with sandbox account before flipping env var in production

---

### FW-110: Switch New Uploads to Cloudinary
**Type:** Story · **Points:** 2 · **Priority:** Medium
**Assignee:** DevOps

**Description:**
Flip the storage provider env var in production. New uploads route to Cloudinary; existing clips stay in Supabase Storage (no migration needed).

**Acceptance Criteria:**
- [ ] `EXPO_PUBLIC_STORAGE_PROVIDER=cloudinary` set on production EAS profile
- [ ] New EAS build cut and submitted
- [ ] Monitor egress on Supabase vs Cloudinary for 1 week post-launch
- [ ] Document rollback procedure (flip env var back to `supabase`)

---

### FW-111: (Optional) Backfill Existing Clips to Cloudinary
**Type:** Story · **Points:** 5 · **Priority:** Low
**Assignee:** Backend Dev

**Description:**
One-time migration script to move clips uploaded to Supabase Storage before the Cloudinary switch. Optional — Supabase Storage can keep serving them indefinitely.

**Acceptance Criteria:**
- [ ] Background script reads all `media_clips` rows with `media_url` matching the Supabase Storage pattern
- [ ] Downloads each clip, re-uploads to Cloudinary
- [ ] Updates `media_clips.media_url` with the new Cloudinary URL
- [ ] Rate-limited to avoid hammering either provider
- [ ] Run during a low-traffic window
- [ ] Verify playback continues working through the migration

---

## Updated Summary

| Phase | Epic | Sprint | Points | Key Deliverable |
|-------|------|--------|--------|----------------|
| Phase 1 | FW-E1 Foundation | Sprint 1 | 24 | Project setup, auth, base schema, data sync |
| Phase 1 | FW-E2 Groups & Chat | Sprint 2 | 26 | Fan groups, real-time chat, onboarding |
| Phase 1 | FW-E3 Watch Parties | Sprint 3 | 26 | Watch party CRUD, venue search, RSVP |
| Phase 1 | FW-E4 Discovery | Sprint 4 | 22 | Home screen, discover, push notifications |
| Phase 2 | FW-E5 Clips & Moments | Sprint 5 | 24 | Moments feed, highlights grid, reactions |
| Phase 2 | FW-E6 Clips Feed | Sprint 6 | 20 | Standalone clips tab, sharing, likes |
| Phase 2 | FW-E7 Engagement | Sprint 7 | 20 | Notifications, moderation, analytics |
| Phase 3 | FW-E8 WC Mode | Sprint 8 | 20 | WC data, schedule, team following, theme |
| Phase 3 | FW-E9 WC Features | Sprint 9 | 16 | WC watch parties, fan groups, QA |
| Phase 4 | FW-E10 Follow Tiers | Sprint 10 | 26 | Per-team follow tiers, filtered feeds, upsell |
| Phase 5 | FW-E11 Seed & Notifications | Sprint 11 | 21 | Seed data, push notification system |
| Phase 5 | FW-E12 Sharing & Creators | Sprint 12 | 24 | Social sharing, creator profiles, edit profile |
| Phase 6 | FW-E13 Gamification | Sprint 13 | 21 | Badges, streaks, trending, reusable components |
| Phase 6 | FW-E14 Accessibility | Sprint 14 | 18 | A11y labels, i18n, offline mode, contrast |
| Phase 6 | FW-E15 Brand & Growth | Sprint 15 | 20 | Welcome flow, invites, deep links, app store |
| **Phase 7** | **FW-E16 Monetization Foundation** | **Sprint 16-17** | **62** | **Entitlements, paywalls, choose-plan, RevenueCat webhook, trial reminder, resubscribe screen** |
| **Phase 7** | **FW-E17 Storage Hardening** | **Sprint 17** | **22** | **Upload validation, rate limiting, E2E payment tests, store submission** |
| **Phase 7** | **FW-E18 Cloudinary (Post-WC)** | **Sprint 18+** | **12** | **Storage provider migration after tournament** |
| **Grand Total** | **18 Epics** | **18 Sprints** | **424** | |
