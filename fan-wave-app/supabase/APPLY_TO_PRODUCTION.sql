-- ============================================================
-- Fan Wave — Combined Production Migration Script
-- Run this ONCE in Supabase SQL Editor to apply all pending changes.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT throughout).
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. STORAGE BUCKET FOR AVATARS
-- ═══════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload avatars
DO $$ BEGIN
    CREATE POLICY "Users can upload avatars" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Anyone can view avatars" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can update own avatars" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════
-- 2. MIGRATION 007: SECURITY FIXES
-- ═══════════════════════════════════════════════════════════

-- 2a. Fix SECURITY DEFINER RPCs with auth.uid() checks
CREATE OR REPLACE FUNCTION rsvp_to_watch_party(p_party_id UUID, p_user_id UUID, p_status TEXT)
RETURNS watch_party_rsvps LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_capacity INT; v_rsvp_count INT; v_rsvp watch_party_rsvps;
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    IF p_status NOT IN ('going','interested','declined','none') THEN RAISE EXCEPTION 'invalid status'; END IF;
    IF p_status = 'going' THEN
        SELECT capacity, rsvp_count INTO v_capacity, v_rsvp_count FROM watch_parties WHERE id = p_party_id FOR UPDATE;
        IF v_rsvp_count >= v_capacity THEN RAISE EXCEPTION 'Watch party is at capacity'; END IF;
    END IF;
    INSERT INTO watch_party_rsvps (watch_party_id, user_id, status) VALUES (p_party_id, p_user_id, p_status)
    ON CONFLICT (watch_party_id, user_id) DO UPDATE SET status = EXCLUDED.status RETURNING * INTO v_rsvp;
    UPDATE watch_parties SET rsvp_count = (SELECT count(*) FROM watch_party_rsvps WHERE watch_party_id = p_party_id AND status = 'going') WHERE id = p_party_id;
    RETURN v_rsvp;
END; $$;

CREATE OR REPLACE FUNCTION flag_watch_party(p_party_id UUID, p_user_id UUID, p_reason TEXT, p_details TEXT DEFAULT '')
RETURNS watch_party_flags LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_flag watch_party_flags; v_flag_count INT;
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    IF p_reason NOT IN ('spam','inappropriate','misleading','safety','other') THEN RAISE EXCEPTION 'invalid reason'; END IF;
    INSERT INTO watch_party_flags (watch_party_id, flagger_id, reason, details) VALUES (p_party_id, p_user_id, p_reason, p_details) RETURNING * INTO v_flag;
    SELECT count(*) INTO v_flag_count FROM watch_party_flags WHERE watch_party_id = p_party_id;
    IF v_flag_count >= 5 THEN UPDATE watch_parties SET moderation_status = 'removed' WHERE id = p_party_id;
    ELSIF v_flag_count >= 3 THEN UPDATE watch_parties SET moderation_status = 'flagged' WHERE id = p_party_id; END IF;
    RETURN v_flag;
END; $$;

CREATE OR REPLACE FUNCTION toggle_moment_reaction(p_moment_id UUID, p_user_id UUID, p_emoji TEXT)
RETURNS SETOF moment_reactions LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_existing_id UUID;
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    SELECT id INTO v_existing_id FROM moment_reactions WHERE moment_id = p_moment_id AND user_id = p_user_id AND emoji = p_emoji;
    IF v_existing_id IS NOT NULL THEN DELETE FROM moment_reactions WHERE id = v_existing_id; RETURN;
    ELSE RETURN QUERY INSERT INTO moment_reactions (moment_id, user_id, emoji) VALUES (p_moment_id, p_user_id, p_emoji) RETURNING *; END IF;
END; $$;

CREATE OR REPLACE FUNCTION flag_content(p_type TEXT, p_content_id UUID, p_user_id UUID, p_reason TEXT, p_details TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_flag_id UUID; v_count INT;
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    IF p_type NOT IN ('watch_party','message','clip','moment') THEN RAISE EXCEPTION 'invalid content type'; END IF;
    IF p_reason NOT IN ('spam','inappropriate','misleading','safety','other') THEN RAISE EXCEPTION 'invalid reason'; END IF;
    INSERT INTO content_flags (content_type, content_id, flagger_id, reason, details) VALUES (p_type, p_content_id, p_user_id, p_reason, p_details) RETURNING id INTO v_flag_id;
    SELECT COUNT(*) INTO v_count FROM content_flags WHERE content_type = p_type AND content_id = p_content_id;
    IF v_count >= 3 THEN
        INSERT INTO moderation_log (action, content_type, content_id, performed_by, details) VALUES ('auto_flagged', p_type, p_content_id, p_user_id, jsonb_build_object('flag_count', v_count, 'trigger', 'threshold'));
        IF p_type = 'watch_party' THEN UPDATE watch_parties SET moderation_status = 'flagged' WHERE id = p_content_id; END IF;
    END IF;
    RETURN v_flag_id;
END; $$;

CREATE OR REPLACE FUNCTION toggle_clip_like(p_clip_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_existing_id UUID;
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    SELECT id INTO v_existing_id FROM clip_likes WHERE clip_id = p_clip_id AND user_id = p_user_id;
    IF v_existing_id IS NOT NULL THEN DELETE FROM clip_likes WHERE id = v_existing_id; RETURN false;
    ELSE INSERT INTO clip_likes (clip_id, user_id) VALUES (p_clip_id, p_user_id); RETURN true; END IF;
END; $$;

CREATE OR REPLACE FUNCTION follow_team(p_user_id UUID, p_team_id UUID, p_tier TEXT DEFAULT 'social')
RETURNS user_team_follows LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result user_team_follows;
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    IF p_tier NOT IN ('lite','social','all_in') THEN RAISE EXCEPTION 'invalid tier'; END IF;
    INSERT INTO user_team_follows (user_id, team_id, tier) VALUES (p_user_id, p_team_id, p_tier)
    ON CONFLICT (user_id, team_id) DO UPDATE SET tier = EXCLUDED.tier RETURNING * INTO result;
    RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION unfollow_team(p_user_id UUID, p_team_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    DELETE FROM user_team_follows WHERE user_id = p_user_id AND team_id = p_team_id;
END; $$;

CREATE OR REPLACE FUNCTION get_user_teams(p_user_id UUID)
RETURNS TABLE(id UUID, user_id UUID, team_id UUID, tier TEXT, followed_at TIMESTAMPTZ, team_name TEXT, team_code TEXT, team_city TEXT, team_logo_url TEXT, team_colors JSONB, league_name TEXT, sport_name TEXT, sport_icon TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
    RETURN QUERY SELECT utf.id, utf.user_id, utf.team_id, utf.tier, utf.followed_at, t.name, t.code, t.city, t.logo_url, t.colors, l.name, s.name, s.icon
    FROM user_team_follows utf JOIN teams t ON t.id = utf.team_id JOIN leagues l ON l.id = t.league_id JOIN sports s ON s.id = l.sport_id
    WHERE utf.user_id = p_user_id ORDER BY utf.followed_at DESC;
END; $$;

-- 2b. Missing UPDATE/DELETE policies
DO $$ BEGIN
    CREATE POLICY chat_rooms_update ON chat_rooms FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY chat_rooms_delete ON chat_rooms FOR DELETE TO authenticated USING (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY messages_update ON messages FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY messages_delete ON messages FOR DELETE TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY media_clips_update ON media_clips FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY media_clips_delete ON media_clips FOR DELETE TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY match_moments_delete ON match_moments FOR DELETE TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY watch_parties_delete ON watch_parties FOR DELETE TO authenticated USING (creator_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2c. Seed missing sports
INSERT INTO sports (id, name, icon, color) VALUES
    ('a0000000-0000-0000-0000-000000000007', 'College Football', '🏈', '#8B0000'),
    ('a0000000-0000-0000-0000-000000000008', 'College Basketball', '🏀', '#FF6600'),
    ('a0000000-0000-0000-0000-000000000009', 'UFC', '🥊', '#D20A0A')
ON CONFLICT (id) DO NOTHING;
INSERT INTO leagues (id, sport_id, name, country, icon) VALUES
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 'NCAA FBS', 'USA', '🏈'),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008', 'NCAA D1', 'USA', '🏀'),
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009', 'UFC', 'USA', '🥊')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- 3. MIGRATION 008: PERFORMANCE & INTEGRITY
-- ═══════════════════════════════════════════════════════════

-- FK Indexes
CREATE INDEX IF NOT EXISTS idx_games_event_id ON games(event_id);
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games(home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_away_team ON games(away_team_id);
CREATE INDEX IF NOT EXISTS idx_games_scheduled ON games(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(chat_room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_parties_sport ON watch_parties(sport_id);
CREATE INDEX IF NOT EXISTS idx_watch_parties_city_date ON watch_parties(venue_city, starts_at);
CREATE INDEX IF NOT EXISTS idx_media_clips_game ON media_clips(game_id);
CREATE INDEX IF NOT EXISTS idx_media_clips_user ON media_clips(user_id);
CREATE INDEX IF NOT EXISTS idx_match_moments_game ON match_moments(game_id);
CREATE INDEX IF NOT EXISTS idx_match_moments_room ON match_moments(chat_room_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_user_room ON chat_room_members(user_id, chat_room_id);

-- Fix counter triggers (COUNT instead of arithmetic)
CREATE OR REPLACE FUNCTION increment_member_count() RETURNS TRIGGER AS $$
BEGIN UPDATE chat_rooms SET member_count = (SELECT COUNT(*) FROM chat_room_members WHERE chat_room_id = NEW.chat_room_id) WHERE id = NEW.chat_room_id; RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_member_count() RETURNS TRIGGER AS $$
BEGIN UPDATE chat_rooms SET member_count = (SELECT COUNT(*) FROM chat_room_members WHERE chat_room_id = OLD.chat_room_id) WHERE id = OLD.chat_room_id; RETURN OLD; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_rsvp_count() RETURNS TRIGGER AS $$
BEGIN UPDATE watch_parties SET rsvp_count = (SELECT COUNT(*) FROM watch_party_rsvps WHERE watch_party_id = NEW.watch_party_id AND status = 'going') WHERE id = NEW.watch_party_id; RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_rsvp_count() RETURNS TRIGGER AS $$
BEGIN UPDATE watch_parties SET rsvp_count = (SELECT COUNT(*) FROM watch_party_rsvps WHERE watch_party_id = OLD.watch_party_id AND status = 'going') WHERE id = OLD.watch_party_id; RETURN OLD; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_clip_like_count() RETURNS TRIGGER AS $$
BEGIN UPDATE media_clips SET like_count = (SELECT COUNT(*) FROM clip_likes WHERE clip_id = NEW.clip_id) WHERE id = NEW.clip_id; RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_clip_like_count() RETURNS TRIGGER AS $$
BEGIN UPDATE media_clips SET like_count = (SELECT COUNT(*) FROM clip_likes WHERE clip_id = OLD.clip_id) WHERE id = OLD.clip_id; RETURN OLD; END; $$ LANGUAGE plpgsql;

-- Message length constraint
DO $$ BEGIN
    ALTER TABLE messages ADD CONSTRAINT ck_message_length CHECK (char_length(content) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users display_name default
ALTER TABLE users ALTER COLUMN display_name SET DEFAULT 'Fan Wave User';

-- ═══════════════════════════════════════════════════════════
-- 4. MIGRATION 009: PUSH NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"score_updates":true,"game_reminders":true,"watch_party_reminders":true,"group_activity":true,"moment_alerts":false,"clip_posted":false}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_users_push_token ON users(auth_id) WHERE push_token IS NOT NULL;

CREATE OR REPLACE FUNCTION register_push_token(p_token TEXT) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN UPDATE users SET push_token = p_token WHERE auth_id = auth.uid(); END; $$;

CREATE OR REPLACE FUNCTION clear_push_token() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN UPDATE users SET push_token = NULL WHERE auth_id = auth.uid(); END; $$;

CREATE OR REPLACE FUNCTION update_notification_preferences(p_preferences JSONB) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN UPDATE users SET notification_preferences = p_preferences WHERE auth_id = auth.uid(); END; $$;

-- ═══════════════════════════════════════════════════════════
-- 5. MIGRATION 010: NOTIFICATION TRIGGERS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_id UUID NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_ref_type ON notification_log(ref_id, type);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY notification_log_service ON notification_log FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
    WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════
-- 6. MIGRATION 011: CREATOR FOLLOWS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL,
    following_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(follower_id, following_id),
    CHECK (follower_id != following_id)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id);
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY user_follows_select ON user_follows FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY user_follows_insert ON user_follows FOR INSERT TO authenticated WITH CHECK (follower_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY user_follows_delete ON user_follows FOR DELETE TO authenticated USING (follower_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS follower_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';

CREATE OR REPLACE FUNCTION update_follow_counts_on_insert() RETURNS TRIGGER AS $$ BEGIN
    UPDATE users SET following_count = (SELECT COUNT(*) FROM user_follows WHERE follower_id = NEW.follower_id) WHERE auth_id = NEW.follower_id;
    UPDATE users SET follower_count = (SELECT COUNT(*) FROM user_follows WHERE following_id = NEW.following_id) WHERE auth_id = NEW.following_id;
    RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_follow_counts_on_delete() RETURNS TRIGGER AS $$ BEGIN
    UPDATE users SET following_count = (SELECT COUNT(*) FROM user_follows WHERE follower_id = OLD.follower_id) WHERE auth_id = OLD.follower_id;
    UPDATE users SET follower_count = (SELECT COUNT(*) FROM user_follows WHERE following_id = OLD.following_id) WHERE auth_id = OLD.following_id;
    RETURN OLD;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_user_follow_insert ON user_follows;
CREATE TRIGGER trg_user_follow_insert AFTER INSERT ON user_follows FOR EACH ROW EXECUTE FUNCTION update_follow_counts_on_insert();
DROP TRIGGER IF EXISTS trg_user_follow_delete ON user_follows;
CREATE TRIGGER trg_user_follow_delete AFTER DELETE ON user_follows FOR EACH ROW EXECUTE FUNCTION update_follow_counts_on_delete();

CREATE OR REPLACE FUNCTION follow_user(p_following_id UUID) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN IF p_following_id = auth.uid() THEN RAISE EXCEPTION 'cannot follow yourself'; END IF;
INSERT INTO user_follows (follower_id, following_id) VALUES (auth.uid(), p_following_id) ON CONFLICT DO NOTHING; END; $$;

CREATE OR REPLACE FUNCTION unfollow_user(p_following_id UUID) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN DELETE FROM user_follows WHERE follower_id = auth.uid() AND following_id = p_following_id; END; $$;

CREATE OR REPLACE FUNCTION is_following(p_user_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
SELECT EXISTS (SELECT 1 FROM user_follows WHERE follower_id = auth.uid() AND following_id = p_user_id); $$;

CREATE OR REPLACE FUNCTION get_followers(p_user_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(user_id UUID, display_name TEXT, avatar_url TEXT, follower_count INT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
SELECT u.auth_id, u.display_name, u.avatar_url, u.follower_count FROM user_follows uf JOIN users u ON u.auth_id = uf.follower_id WHERE uf.following_id = p_user_id ORDER BY uf.created_at DESC LIMIT p_limit OFFSET p_offset; $$;

CREATE OR REPLACE FUNCTION get_following(p_user_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(user_id UUID, display_name TEXT, avatar_url TEXT, follower_count INT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
SELECT u.auth_id, u.display_name, u.avatar_url, u.follower_count FROM user_follows uf JOIN users u ON u.auth_id = uf.following_id WHERE uf.follower_id = p_user_id ORDER BY uf.created_at DESC LIMIT p_limit OFFSET p_offset; $$;

-- ═══════════════════════════════════════════════════════════
-- 7. MIGRATION 012: GAMIFICATION & TRENDING (without triggers)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('milestone','engagement','social','special'))
);
CREATE TABLE IF NOT EXISTS user_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY badges_select ON badges FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY user_badges_select ON user_badges FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY user_badges_insert ON user_badges FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO badges (key, name, description, icon, category) VALUES
    ('first_group','First Crew','Joined your first fan group','👥','milestone'),
    ('first_party','Party Starter','RSVPd to your first watch party','🎉','milestone'),
    ('first_clip','Highlight Reel','Posted your first clip','🎬','milestone'),
    ('first_moment','Hot Take','Posted your first moment','⚡','milestone'),
    ('groups_10','Community Builder','Joined 10 fan groups','🏗️','engagement'),
    ('parties_5','Social Butterfly','Attended 5 watch parties','🦋','engagement'),
    ('clips_trending','Viral Moment','Got 100+ likes on a single clip','🔥','engagement'),
    ('game_day_regular','Game Day Regular','RSVPd to 10+ watch parties','🏟️','engagement'),
    ('all_in_fan','All-In Fan','Followed 3+ teams at All-In tier','💯','engagement'),
    ('sports_nut','Sports Nut','Following teams across 5+ sports','🏅','engagement'),
    ('city_explorer','City Explorer','Joined groups in 3+ different cities','🗺️','social'),
    ('super_host','Super Host','Created 5+ watch parties','🏆','social'),
    ('social_butterfly','Fan Favorite','Gained 50+ followers','⭐','social'),
    ('early_adopter','Early Adopter','Joined Fan Wave in the first wave','🌊','special'),
    ('world_cup_fan','World Cup Fan','Followed a World Cup team','🏆','special'),
    ('recruiter','Recruiter','Invited 3+ friends to Fan Wave','🎯','social')
ON CONFLICT (key) DO NOTHING;

-- Award badge helper
CREATE OR REPLACE FUNCTION award_badge(p_user_id UUID, p_badge_key TEXT) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_badge_id UUID;
BEGIN SELECT id INTO v_badge_id FROM badges WHERE key = p_badge_key; IF v_badge_id IS NULL THEN RETURN; END IF;
INSERT INTO user_badges (user_id, badge_id) VALUES (p_user_id, v_badge_id) ON CONFLICT (user_id, badge_id) DO NOTHING; END; $$;

-- Streaks
CREATE TABLE IF NOT EXISTS user_streaks (
    user_id UUID PRIMARY KEY,
    current_streak INT DEFAULT 0,
    longest_streak INT DEFAULT 0,
    last_active_date DATE,
    grace_used_at DATE
);
ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY user_streaks_select ON user_streaks FOR SELECT TO authenticated USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION record_daily_activity()
RETURNS TABLE(current_streak INT, longest_streak INT) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user UUID := auth.uid(); v_today DATE := CURRENT_DATE; v_row user_streaks%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM user_streaks WHERE user_id = v_user;
    IF NOT FOUND THEN INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date) VALUES (v_user, 1, 1, v_today); RETURN QUERY SELECT 1, 1; RETURN; END IF;
    IF v_row.last_active_date = v_today THEN RETURN QUERY SELECT v_row.current_streak, v_row.longest_streak; RETURN; END IF;
    IF v_row.last_active_date = v_today - 1 THEN
        UPDATE user_streaks SET current_streak = v_row.current_streak + 1, longest_streak = GREATEST(v_row.longest_streak, v_row.current_streak + 1), last_active_date = v_today WHERE user_id = v_user;
        RETURN QUERY SELECT v_row.current_streak + 1, GREATEST(v_row.longest_streak, v_row.current_streak + 1); RETURN;
    END IF;
    IF v_row.last_active_date = v_today - 2 AND (v_row.grace_used_at IS NULL OR v_row.grace_used_at < v_today - 30) THEN
        UPDATE user_streaks SET current_streak = v_row.current_streak + 1, longest_streak = GREATEST(v_row.longest_streak, v_row.current_streak + 1), last_active_date = v_today, grace_used_at = v_today WHERE user_id = v_user;
        RETURN QUERY SELECT v_row.current_streak + 1, GREATEST(v_row.longest_streak, v_row.current_streak + 1); RETURN;
    END IF;
    UPDATE user_streaks SET current_streak = 1, last_active_date = v_today WHERE user_id = v_user;
    RETURN QUERY SELECT 1, v_row.longest_streak;
END; $$;

-- App-level badge checker (replaces database triggers)
CREATE OR REPLACE FUNCTION check_and_award_badges()
RETURNS TABLE(badge_key TEXT, badge_name TEXT, badge_icon TEXT) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user UUID := auth.uid(); v_count INT; v_city_count INT; v_sport_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM chat_room_members WHERE user_id = v_user;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_group'); END IF;
    IF v_count >= 10 THEN PERFORM award_badge(v_user, 'groups_10'); END IF;
    SELECT COUNT(DISTINCT cr.city) INTO v_city_count FROM chat_room_members crm JOIN chat_rooms cr ON cr.id = crm.chat_room_id WHERE crm.user_id = v_user AND cr.city IS NOT NULL;
    IF v_city_count >= 3 THEN PERFORM award_badge(v_user, 'city_explorer'); END IF;
    SELECT COUNT(*) INTO v_count FROM watch_party_rsvps WHERE user_id = v_user AND status = 'going';
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_party'); END IF;
    IF v_count >= 5 THEN PERFORM award_badge(v_user, 'parties_5'); END IF;
    IF v_count >= 10 THEN PERFORM award_badge(v_user, 'game_day_regular'); END IF;
    SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_clip'); END IF;
    SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user AND like_count >= 100;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'clips_trending'); END IF;
    SELECT COUNT(*) INTO v_count FROM watch_parties WHERE creator_id = v_user;
    IF v_count >= 5 THEN PERFORM award_badge(v_user, 'super_host'); END IF;
    SELECT COUNT(*) INTO v_count FROM user_follows WHERE following_id = v_user;
    IF v_count >= 50 THEN PERFORM award_badge(v_user, 'social_butterfly'); END IF;
    RETURN QUERY SELECT b.key, b.name, b.icon FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = v_user AND ub.earned_at > now() - interval '5 seconds';
END; $$;

-- ═══════════════════════════════════════════════════════════
-- 8. MIGRATION 013: REFERRALS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INT DEFAULT 0;

CREATE OR REPLACE FUNCTION generate_referral_code() RETURNS TRIGGER AS $$
BEGIN IF NEW.referral_code IS NULL THEN NEW.referral_code := LOWER(SUBSTRING(MD5(NEW.auth_id::TEXT || NOW()::TEXT) FROM 1 FOR 8)); END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_generate_referral_code ON users;
CREATE TRIGGER trg_generate_referral_code BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

CREATE OR REPLACE FUNCTION apply_referral(p_referral_code TEXT) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_referrer_id UUID; v_count INT;
BEGIN
    SELECT auth_id INTO v_referrer_id FROM users WHERE referral_code = LOWER(p_referral_code);
    IF v_referrer_id IS NULL OR v_referrer_id = auth.uid() THEN RETURN; END IF;
    UPDATE users SET referred_by = v_referrer_id WHERE auth_id = auth.uid() AND referred_by IS NULL;
    UPDATE users SET referral_count = referral_count + 1 WHERE auth_id = v_referrer_id;
    SELECT referral_count INTO v_count FROM users WHERE auth_id = v_referrer_id;
    IF v_count >= 3 THEN PERFORM award_badge(v_referrer_id, 'recruiter'); END IF;
END; $$;

CREATE OR REPLACE FUNCTION get_my_referral_code() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
SELECT referral_code FROM users WHERE auth_id = auth.uid(); $$;

-- ═══════════════════════════════════════════════════════════
-- 9. MIGRATION 014: WATCH PARTY INVITES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS watch_party_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    watch_party_id UUID NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wp_invites_party ON watch_party_invites(watch_party_id);
ALTER TABLE watch_party_invites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY wp_invites_select ON watch_party_invites FOR SELECT TO authenticated
    USING (invited_by = auth.uid() OR watch_party_id IN (SELECT id FROM watch_parties WHERE creator_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY wp_invites_insert ON watch_party_invites FOR INSERT TO authenticated WITH CHECK (invited_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY wp_invites_delete ON watch_party_invites FOR DELETE TO authenticated USING (invited_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add visibility to watch_parties if not exists
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'watch_parties' AND column_name = 'visibility') THEN
        ALTER TABLE watch_parties ADD COLUMN visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public','private'));
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 10. FIX RLS RECURSION (already partially applied manually)
-- ═══════════════════════════════════════════════════════════

-- Ensure clean chat_room_members policies (no recursion)
DROP POLICY IF EXISTS chat_room_members_select ON chat_room_members;
DROP POLICY IF EXISTS chat_room_members_insert ON chat_room_members;
DROP POLICY IF EXISTS chat_room_members_delete ON chat_room_members;
CREATE POLICY chat_room_members_select ON chat_room_members FOR SELECT TO authenticated USING (true);
CREATE POLICY chat_room_members_insert ON chat_room_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY chat_room_members_delete ON chat_room_members FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Ensure clean messages policies (no cross-table reference)
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_select ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY messages_insert ON messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Ensure clean chat_rooms private policy
DROP POLICY IF EXISTS chat_rooms_select_private ON chat_rooms;
CREATE POLICY chat_rooms_select_private ON chat_rooms FOR SELECT TO authenticated
    USING (visibility = 'private' AND owner_id = auth.uid());

-- Ensure clean banned_members policies
DROP POLICY IF EXISTS banned_members_select ON banned_members;
DROP POLICY IF EXISTS banned_members_insert ON banned_members;
DROP POLICY IF EXISTS banned_members_delete ON banned_members;
CREATE POLICY banned_members_select ON banned_members FOR SELECT TO authenticated USING (true);
CREATE POLICY banned_members_insert ON banned_members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY banned_members_delete ON banned_members FOR DELETE TO authenticated USING (true);

-- Ensure clean moderation_log policy
DROP POLICY IF EXISTS moderation_log_select ON moderation_log;
CREATE POLICY moderation_log_select ON moderation_log FOR SELECT TO authenticated USING (true);

-- Drop all badge triggers (moved to app-level RPC)
DROP TRIGGER IF EXISTS trg_check_group_badges ON chat_room_members;
DROP TRIGGER IF EXISTS trg_check_party_badges ON watch_party_rsvps;
DROP TRIGGER IF EXISTS trg_check_clip_badges ON media_clips;

-- ═══════════════════════════════════════════════════════════
-- DONE! All migrations applied.
-- ═══════════════════════════════════════════════════════════
