-- 106: indexes for current query shapes; duplicate index cleanup (P2.4, 2026-09-25)
--
-- STATUS: PREPARED, NOT APPLIED. Needs owner approval; apply via the
-- Management API query endpoint. Each ADD is justified by a query at HEAD
-- and should be confirmed with EXPLAIN ANALYZE on the real database
-- before applying (queries listed per index). DROPs remove exact
-- duplicates and are safe on their own.
--
-- The old report's suggestions were re-checked against HEAD:
--   * media_clips(like_count DESC, created_at): NOT added. Trending
--     filters created_at >= now()-7d and orders like_count DESC; the
--     existing created_at DESC index bounds the range and the 7-day set
--     is small enough to sort in memory. Revisit with EXPLAIN if the
--     7-day volume grows past ~50k rows.
--   * pg_trgm on chat_rooms.name: NOT added. Discover's ilike '%q%' runs
--     over ~57 rooms today; a GIN index costs more than it saves until
--     rooms number in the thousands.

-- ADD ---------------------------------------------------------------------
-- hooks/useData.ts useGames:
--   .or('status.eq.in, and(status.eq.scheduled,scheduled_at.gte.X), and(status.eq.post,scheduled_at.gte.Y)')
--   .order('status').order('scheduled_at')
-- EXPLAIN ANALYZE SELECT * FROM games WHERE status='in' OR (status='scheduled' AND scheduled_at>=now()-interval '4 hours') OR (status='post' AND scheduled_at>=now()-interval '24 hours') ORDER BY status, scheduled_at LIMIT 50;
CREATE INDEX IF NOT EXISTS idx_games_status_scheduled
  ON public.games (status, scheduled_at);

-- components/MomentsFeed.tsx: match_moments WHERE chat_room_id = $1 ORDER BY created_at DESC LIMIT 50
-- EXPLAIN ANALYZE SELECT * FROM match_moments WHERE chat_room_id = '<uuid>' ORDER BY created_at DESC LIMIT 50;
CREATE INDEX IF NOT EXISTS idx_match_moments_room_created
  ON public.match_moments (chat_room_id, created_at DESC);

-- app/game/[id].tsx: watch_parties WHERE game_id = $1 ORDER BY starts_at LIMIT 20
-- EXPLAIN ANALYZE SELECT * FROM watch_parties WHERE game_id = '<uuid>' ORDER BY starts_at LIMIT 20;
CREATE INDEX IF NOT EXISTS idx_watch_parties_game
  ON public.watch_parties (game_id, starts_at);

-- hooks/useData.ts useMyRsvps + app/rsvp-history.tsx: watch_party_rsvps WHERE user_id = $1
CREATE INDEX IF NOT EXISTS idx_watch_party_rsvps_user
  ON public.watch_party_rsvps (user_id);

-- DROP exact duplicates ------------------------------------------------------
-- idx_watch_parties_city_date (mig 008) == idx_watch_parties_city_starts (mig 002): both (venue_city, starts_at)
DROP INDEX IF EXISTS public.idx_watch_parties_city_date;
-- idx_messages_room_created_desc (mig 072) duplicates idx_messages_room_created (mig 002, ASC);
-- a btree is scanned backward for ORDER BY created_at DESC, so the ASC one serves both.
DROP INDEX IF EXISTS public.idx_messages_room_created_desc;
-- idx_clip_likes_clip (mig 004) is the leading column of UNIQUE (clip_id, user_id)
DROP INDEX IF EXISTS public.idx_clip_likes_clip;
-- idx_user_follows_follower (mig 011) is the leading column of UNIQUE (follower_id, following_id)
DROP INDEX IF EXISTS public.idx_user_follows_follower;

-- PRE-CHECK: confirm the duplicates exist under these names before applying:
--   SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'
--   AND indexname IN ('idx_watch_parties_city_date','idx_watch_parties_city_starts','idx_messages_room_created','idx_messages_room_created_desc','idx_clip_likes_clip','idx_user_follows_follower');
--
-- Reversal: DROP the four new indexes; re-create the dropped ones from
-- migrations 008, 072, 004 and 011.
