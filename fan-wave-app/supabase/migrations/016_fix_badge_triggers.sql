-- ============================================================
-- Migration 016: Fix Badge Trigger Recursion
--
-- The badge check triggers (from migration 012) cause infinite
-- recursion when they query chat_room_members during RLS
-- policy evaluation on the same table.
--
-- Fix: Remove database triggers for badge checks.
-- Badge awarding will be handled at the application level
-- via the existing award_badge() RPC function.
-- ============================================================

-- Remove triggers that cause recursion
DROP TRIGGER IF EXISTS trg_check_group_badges ON chat_room_members;
DROP TRIGGER IF EXISTS trg_check_party_badges ON watch_party_rsvps;
DROP TRIGGER IF EXISTS trg_check_clip_badges ON media_clips;
DROP TRIGGER IF EXISTS trg_check_follower_badges ON user_follows;
DROP TRIGGER IF EXISTS trg_check_host_badges ON watch_parties;

-- Create a single RPC that checks and awards all badges for a user.
-- Called from the app after key actions (join group, RSVP, post clip, etc.)
CREATE OR REPLACE FUNCTION check_and_award_badges()
RETURNS TABLE(badge_key TEXT, badge_name TEXT, badge_icon TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_count INT;
    v_city_count INT;
    v_sport_count INT;
    v_result RECORD;
BEGIN
    -- First group
    SELECT COUNT(*) INTO v_count FROM chat_room_members WHERE user_id = v_user;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_group'); END IF;
    IF v_count >= 10 THEN PERFORM award_badge(v_user, 'groups_10'); END IF;

    -- City explorer (3+ cities)
    SELECT COUNT(DISTINCT cr.city) INTO v_city_count
    FROM chat_room_members crm
    JOIN chat_rooms cr ON cr.id = crm.chat_room_id
    WHERE crm.user_id = v_user AND cr.city IS NOT NULL;
    IF v_city_count >= 3 THEN PERFORM award_badge(v_user, 'city_explorer'); END IF;

    -- First watch party & attendance badges
    SELECT COUNT(*) INTO v_count FROM watch_party_rsvps WHERE user_id = v_user AND status = 'going';
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_party'); END IF;
    IF v_count >= 5 THEN PERFORM award_badge(v_user, 'parties_5'); END IF;
    IF v_count >= 10 THEN PERFORM award_badge(v_user, 'game_day_regular'); END IF;

    -- First clip
    SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_clip'); END IF;

    -- Trending clip (100+ likes)
    SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user AND like_count >= 100;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'clips_trending'); END IF;

    -- Super host (5+ parties created)
    SELECT COUNT(*) INTO v_count FROM watch_parties WHERE creator_id = v_user;
    IF v_count >= 5 THEN PERFORM award_badge(v_user, 'super_host'); END IF;

    -- Fan favorite (50+ followers)
    SELECT COUNT(*) INTO v_count FROM user_follows WHERE following_id = v_user;
    IF v_count >= 50 THEN PERFORM award_badge(v_user, 'social_butterfly'); END IF;

    -- Sports nut (5+ sports followed)
    SELECT COUNT(DISTINCT s.id) INTO v_sport_count
    FROM user_team_follows utf
    JOIN teams t ON t.id = utf.team_id
    JOIN leagues l ON l.id = t.league_id
    JOIN sports s ON s.id = l.sport_id
    WHERE utf.user_id = v_user;
    IF v_sport_count >= 5 THEN PERFORM award_badge(v_user, 'sports_nut'); END IF;

    -- Return any newly awarded badges (earned in the last 5 seconds)
    RETURN QUERY
    SELECT b.key, b.name, b.icon
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = v_user
      AND ub.earned_at > now() - interval '5 seconds';
END;
$$;
