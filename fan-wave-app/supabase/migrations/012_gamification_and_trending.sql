-- ============================================================
-- Migration 012: Gamification (Badges, Streaks) & Trending
--
-- 1. Badges & user_badges tables + seed badges
-- 2. Badge award trigger functions
-- 3. User streaks table + daily activity RPC
-- 4. Trending materialized views + cron refresh
-- ============================================================

-- =========================
-- 1. BADGES SYSTEM
-- =========================

CREATE TABLE IF NOT EXISTS badges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    icon        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('milestone', 'engagement', 'social', 'special'))
);

CREATE TABLE IF NOT EXISTS user_badges (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID NOT NULL,
    badge_id  UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY badges_select ON badges FOR SELECT USING (true);
CREATE POLICY user_badges_select ON user_badges FOR SELECT TO authenticated USING (true);
CREATE POLICY user_badges_insert ON user_badges FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Seed 15 badges
INSERT INTO badges (key, name, description, icon, category) VALUES
    ('first_group',       'First Crew',        'Joined your first fan group',                    '👥', 'milestone'),
    ('first_party',       'Party Starter',      'RSVPd to your first watch party',               '🎉', 'milestone'),
    ('first_clip',        'Highlight Reel',     'Posted your first clip',                         '🎬', 'milestone'),
    ('first_moment',      'Hot Take',           'Posted your first moment',                       '⚡', 'milestone'),
    ('groups_10',         'Community Builder',   'Joined 10 fan groups',                          '🏗️', 'engagement'),
    ('parties_5',         'Social Butterfly',    'Attended 5 watch parties',                      '🦋', 'engagement'),
    ('clips_trending',    'Viral Moment',        'Got 100+ likes on a single clip',               '🔥', 'engagement'),
    ('game_day_regular',  'Game Day Regular',    'RSVPd to 10+ watch parties',                    '🏟️', 'engagement'),
    ('all_in_fan',        'All-In Fan',          'Followed 3+ teams at All-In tier',              '💯', 'engagement'),
    ('sports_nut',        'Sports Nut',          'Following teams across 5+ sports',              '🏅', 'engagement'),
    ('city_explorer',     'City Explorer',       'Joined groups in 3+ different cities',          '🗺️', 'social'),
    ('super_host',        'Super Host',          'Created 5+ watch parties',                      '🏆', 'social'),
    ('social_butterfly',  'Fan Favorite',        'Gained 50+ followers',                          '⭐', 'social'),
    ('early_adopter',     'Early Adopter',       'Joined Fan Wave in the first wave',             '🌊', 'special'),
    ('world_cup_fan',     'World Cup Fan',       'Followed a World Cup team',                     '🏆', 'special')
ON CONFLICT (key) DO NOTHING;

-- =========================
-- 2. BADGE AWARD FUNCTIONS
-- =========================

-- Award a badge (idempotent)
CREATE OR REPLACE FUNCTION award_badge(p_user_id UUID, p_badge_key TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_badge_id UUID;
BEGIN
    SELECT id INTO v_badge_id FROM badges WHERE key = p_badge_key;
    IF v_badge_id IS NULL THEN RETURN; END IF;

    INSERT INTO user_badges (user_id, badge_id)
    VALUES (p_user_id, v_badge_id)
    ON CONFLICT (user_id, badge_id) DO NOTHING;
END;
$$;

-- Check badges after chat_room_members insert (first_group, groups_10, city_explorer)
CREATE OR REPLACE FUNCTION check_group_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_user UUID := NEW.user_id;
    v_count INT;
    v_city_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM chat_room_members WHERE user_id = v_user;

    IF v_count = 1 THEN
        PERFORM award_badge(v_user, 'first_group');
    END IF;
    IF v_count >= 10 THEN
        PERFORM award_badge(v_user, 'groups_10');
    END IF;

    SELECT COUNT(DISTINCT cr.city) INTO v_city_count
    FROM chat_room_members crm
    JOIN chat_rooms cr ON cr.id = crm.chat_room_id
    WHERE crm.user_id = v_user AND cr.city IS NOT NULL;

    IF v_city_count >= 3 THEN
        PERFORM award_badge(v_user, 'city_explorer');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_group_badges ON chat_room_members;
CREATE TRIGGER trg_check_group_badges
    AFTER INSERT ON chat_room_members
    FOR EACH ROW EXECUTE FUNCTION check_group_badges();

-- Check badges after watch_party_rsvps insert (first_party, parties_5, game_day_regular)
CREATE OR REPLACE FUNCTION check_party_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_user UUID := NEW.user_id;
    v_count INT;
BEGIN
    IF NEW.status != 'going' THEN RETURN NEW; END IF;

    SELECT COUNT(*) INTO v_count
    FROM watch_party_rsvps WHERE user_id = v_user AND status = 'going';

    IF v_count = 1 THEN
        PERFORM award_badge(v_user, 'first_party');
    END IF;
    IF v_count >= 5 THEN
        PERFORM award_badge(v_user, 'parties_5');
    END IF;
    IF v_count >= 10 THEN
        PERFORM award_badge(v_user, 'game_day_regular');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_party_badges ON watch_party_rsvps;
CREATE TRIGGER trg_check_party_badges
    AFTER INSERT OR UPDATE ON watch_party_rsvps
    FOR EACH ROW EXECUTE FUNCTION check_party_badges();

-- Check badges after media_clips insert (first_clip, clips_trending)
CREATE OR REPLACE FUNCTION check_clip_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_user UUID;
    v_count INT;
BEGIN
    -- On INSERT: check first_clip
    IF TG_OP = 'INSERT' THEN
        v_user := NEW.user_id;
        SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user;
        IF v_count = 1 THEN
            PERFORM award_badge(v_user, 'first_clip');
        END IF;
    END IF;

    -- On UPDATE: check trending (100+ likes)
    IF TG_OP = 'UPDATE' AND NEW.like_count >= 100 THEN
        PERFORM award_badge(NEW.user_id, 'clips_trending');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_clip_badges ON media_clips;
CREATE TRIGGER trg_check_clip_badges
    AFTER INSERT OR UPDATE ON media_clips
    FOR EACH ROW EXECUTE FUNCTION check_clip_badges();

-- Check badges after user_follows insert (social_butterfly at 50 followers)
CREATE OR REPLACE FUNCTION check_follower_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM user_follows WHERE following_id = NEW.following_id;
    IF v_count >= 50 THEN
        PERFORM award_badge(NEW.following_id, 'social_butterfly');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_follower_badges ON user_follows;
CREATE TRIGGER trg_check_follower_badges
    AFTER INSERT ON user_follows
    FOR EACH ROW EXECUTE FUNCTION check_follower_badges();

-- Check super_host badge after watch_parties insert
CREATE OR REPLACE FUNCTION check_host_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM watch_parties WHERE creator_id = NEW.creator_id;
    IF v_count >= 5 THEN
        PERFORM award_badge(NEW.creator_id, 'super_host');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_host_badges ON watch_parties;
CREATE TRIGGER trg_check_host_badges
    AFTER INSERT ON watch_parties
    FOR EACH ROW EXECUTE FUNCTION check_host_badges();

-- =========================
-- 3. ACTIVITY STREAKS
-- =========================

CREATE TABLE IF NOT EXISTS user_streaks (
    user_id         UUID PRIMARY KEY,
    current_streak  INT DEFAULT 0,
    longest_streak  INT DEFAULT 0,
    last_active_date DATE,
    grace_used_at   DATE
);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_streaks_select ON user_streaks
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION record_daily_activity()
RETURNS TABLE(current_streak INT, longest_streak INT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_today DATE := CURRENT_DATE;
    v_row user_streaks%ROWTYPE;
BEGIN
    -- Get or create streak record
    SELECT * INTO v_row FROM user_streaks WHERE user_id = v_user;

    IF NOT FOUND THEN
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date)
        VALUES (v_user, 1, 1, v_today);
        RETURN QUERY SELECT 1, 1;
        RETURN;
    END IF;

    -- Already active today
    IF v_row.last_active_date = v_today THEN
        RETURN QUERY SELECT v_row.current_streak, v_row.longest_streak;
        RETURN;
    END IF;

    -- Consecutive day
    IF v_row.last_active_date = v_today - 1 THEN
        UPDATE user_streaks
        SET current_streak = v_row.current_streak + 1,
            longest_streak = GREATEST(v_row.longest_streak, v_row.current_streak + 1),
            last_active_date = v_today
        WHERE user_id = v_user;
        RETURN QUERY SELECT v_row.current_streak + 1, GREATEST(v_row.longest_streak, v_row.current_streak + 1);
        RETURN;
    END IF;

    -- Missed 1 day — grace period (once per 30 days)
    IF v_row.last_active_date = v_today - 2
       AND (v_row.grace_used_at IS NULL OR v_row.grace_used_at < v_today - 30)
    THEN
        UPDATE user_streaks
        SET current_streak = v_row.current_streak + 1,
            longest_streak = GREATEST(v_row.longest_streak, v_row.current_streak + 1),
            last_active_date = v_today,
            grace_used_at = v_today
        WHERE user_id = v_user;
        RETURN QUERY SELECT v_row.current_streak + 1, GREATEST(v_row.longest_streak, v_row.current_streak + 1);
        RETURN;
    END IF;

    -- Streak broken
    UPDATE user_streaks
    SET current_streak = 1,
        last_active_date = v_today
    WHERE user_id = v_user;
    RETURN QUERY SELECT 1, v_row.longest_streak;
END;
$$;

-- =========================
-- 4. TRENDING MATERIALIZED VIEWS
-- =========================

-- Trending clips: weighted by likes + views, decayed by age
CREATE MATERIALIZED VIEW IF NOT EXISTS trending_clips AS
SELECT
    mc.id,
    mc.title,
    mc.user_id,
    mc.media_url,
    mc.media_type,
    mc.thumbnail_url,
    mc.duration_seconds,
    mc.view_count,
    mc.like_count,
    mc.created_at,
    u.display_name AS user_name,
    (mc.like_count * 3 + mc.view_count)::FLOAT /
        GREATEST(EXTRACT(EPOCH FROM (now() - mc.created_at)) / 3600, 1) AS score
FROM media_clips mc
LEFT JOIN users u ON u.auth_id = mc.user_id
WHERE mc.created_at > now() - interval '7 days'
ORDER BY score DESC
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trending_clips_id ON trending_clips(id);

-- Trending groups: by member count + recent message activity
CREATE MATERIALIZED VIEW IF NOT EXISTS trending_groups AS
SELECT
    cr.id,
    cr.name,
    cr.description,
    cr.icon,
    cr.sport_id,
    cr.city,
    cr.tags,
    cr.member_count,
    cr.visibility,
    COALESCE(msg_counts.msg_count_7d, 0) AS message_count_7d,
    cr.member_count + COALESCE(msg_counts.msg_count_7d, 0) * 2 AS score
FROM chat_rooms cr
LEFT JOIN (
    SELECT chat_room_id, COUNT(*) AS msg_count_7d
    FROM messages
    WHERE created_at > now() - interval '7 days'
    GROUP BY chat_room_id
) msg_counts ON msg_counts.chat_room_id = cr.id
WHERE cr.visibility = 'public'
ORDER BY score DESC
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trending_groups_id ON trending_groups(id);

-- Hot watch parties: by RSVP velocity in last 48h
CREATE MATERIALIZED VIEW IF NOT EXISTS hot_watch_parties AS
SELECT
    wp.id,
    wp.title,
    wp.venue_name,
    wp.venue_city,
    wp.sport_id,
    wp.starts_at,
    wp.capacity,
    wp.rsvp_count,
    wp.atmosphere,
    COALESCE(recent.recent_rsvps, 0) AS recent_rsvps,
    wp.rsvp_count + COALESCE(recent.recent_rsvps, 0) * 5 AS score
FROM watch_parties wp
LEFT JOIN (
    SELECT watch_party_id, COUNT(*) AS recent_rsvps
    FROM watch_party_rsvps
    WHERE created_at > now() - interval '48 hours'
      AND status = 'going'
    GROUP BY watch_party_id
) recent ON recent.watch_party_id = wp.id
WHERE wp.starts_at > now()
ORDER BY score DESC
LIMIT 50;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_parties_id ON hot_watch_parties(id);

-- Cron: refresh all materialized views every 15 minutes
SELECT cron.schedule(
    'refresh-trending-views',
    '*/15 * * * *',
    $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY trending_clips;
    REFRESH MATERIALIZED VIEW CONCURRENTLY trending_groups;
    REFRESH MATERIALIZED VIEW CONCURRENTLY hot_watch_parties;
    $$
);
